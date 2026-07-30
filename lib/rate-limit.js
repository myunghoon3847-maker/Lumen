'use strict';

const crypto = require('node:crypto');
const { isProduction } = require('./security');

const memoryBuckets = new Map();
const LUA_FIXED_WINDOW = [
  'local current = redis.call("INCR", KEYS[1])',
  'if current == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end',
  'local ttl = redis.call("TTL", KEYS[1])',
  'return {current, ttl}',
].join('\n');

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getRateLimitConfig() {
  return {
    max: boundedInteger(process.env.RATE_LIMIT_MAX, 10, 1, 1000),
    windowSeconds: boundedInteger(process.env.RATE_LIMIT_WINDOW_SECONDS, 60, 10, 3600),
  };
}

function getHeader(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function getClientAddress(req) {
  const vercelForwarded = getHeader(req, 'x-vercel-forwarded-for');
  const standardForwarded = getHeader(req, 'x-forwarded-for');
  const forwarded = vercelForwarded || standardForwarded;
  const address = String(forwarded || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 128);
  return address || 'unknown';
}

function makeBucketKey(req) {
  const salt = process.env.RATE_LIMIT_SALT || (isProduction() ? '' : 'lumen-local-development');
  if (!salt) throw new Error('RATE_LIMIT_SALT_MISSING');
  const digest = crypto
    .createHmac('sha256', salt)
    .update(getClientAddress(req))
    .digest('hex');
  return `lumen:write:rate:${digest}`;
}

function memoryRateLimit(key, config) {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const current = memoryBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  memoryBuckets.set(key, bucket);

  if (memoryBuckets.size > 5000) {
    for (const [storedKey, stored] of memoryBuckets) {
      if (stored.resetAt <= now) memoryBuckets.delete(storedKey);
    }
  }

  return {
    allowed: bucket.count <= config.max,
    limit: config.max,
    remaining: Math.max(0, config.max - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    backend: 'memory',
  };
}

async function upstashRateLimit(key, config) {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('RATE_LIMIT_BACKEND_MISSING');
  const parsedUrl = new URL(url);
  if (isProduction() && parsedUrl.protocol !== 'https:') throw new Error('RATE_LIMIT_BACKEND_INSECURE');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        'EVAL',
        LUA_FIXED_WINDOW,
        '1',
        key,
        String(config.windowSeconds),
      ]),
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !Array.isArray(data.result)) {
      throw new Error('RATE_LIMIT_BACKEND_ERROR');
    }
    const count = Number(data.result[0]);
    const ttl = Number(data.result[1]);
    if (!Number.isFinite(count)) throw new Error('RATE_LIMIT_BACKEND_INVALID');
    return {
      allowed: count <= config.max,
      limit: config.max,
      remaining: Math.max(0, config.max - count),
      retryAfter: Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : config.windowSeconds,
      backend: 'upstash',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRateLimit(req) {
  const config = getRateLimitConfig();
  const key = makeBucketKey(req);
  const requestedDriver = String(process.env.RATE_LIMIT_DRIVER || '').toLowerCase();

  if (isProduction()) {
    if (requestedDriver && requestedDriver !== 'upstash') throw new Error('RATE_LIMIT_DRIVER_UNSAFE');
    return upstashRateLimit(key, config);
  }
  if (requestedDriver === 'upstash') return upstashRateLimit(key, config);
  return memoryRateLimit(key, config);
}

function applyRateLimitHeaders(res, result) {
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) res.setHeader('Retry-After', String(result.retryAfter));
}

function resetMemoryBuckets() {
  memoryBuckets.clear();
}

module.exports = {
  applyRateLimitHeaders,
  checkRateLimit,
  getRateLimitConfig,
  resetMemoryBuckets,
};
