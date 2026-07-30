'use strict';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://myunghoon3847-maker.github.io',
];

const MAX_BODY_BYTES = 48 * 1024;

function isProduction() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (isProduction() && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins() {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  configured.forEach((origin) => origins.add(origin));

  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (!host) continue;
    const normalized = normalizeOrigin(host.includes('://') ? host : `https://${host}`);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function appendVary(res, value) {
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Vary') : undefined;
  const values = new Set(
    String(existing || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  res.setHeader('Vary', [...values].join(', '));
}

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
}

function applyCors(req, res, allowedMethods, { requireOrigin = true } = {}) {
  appendVary(res, 'Origin');
  const origin = normalizeOrigin(req.headers?.origin);
  const originAllowed = origin && getAllowedOrigins().has(origin);

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      res.status(403).json({ error: '허용되지 않은 요청 출처입니다.', code: 'ORIGIN_DENIED' });
      return { handled: true, allowed: false };
    }
    res.status(204).end();
    return { handled: true, allowed: true };
  }

  if (origin && !originAllowed) {
    res.status(403).json({ error: '허용되지 않은 요청 출처입니다.', code: 'ORIGIN_DENIED' });
    return { handled: true, allowed: false };
  }

  if (!origin && requireOrigin && isProduction()) {
    res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.', code: 'ORIGIN_REQUIRED' });
    return { handled: true, allowed: false };
  }

  return { handled: false, allowed: Boolean(originAllowed || !requireOrigin || !isProduction()) };
}

function isJsonRequest(req) {
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  return contentType.split(';', 1)[0].trim() === 'application/json';
}

function parseJsonBody(req) {
  const contentLength = Number(req.headers?.['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'BODY_TOO_LARGE', error: '요청 데이터가 너무 큽니다.' };
  }

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      return { ok: false, status: 413, code: 'BODY_TOO_LARGE', error: '요청 데이터가 너무 큽니다.' };
    }
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, status: 400, code: 'INVALID_JSON', error: '요청 형식이 올바르지 않습니다.' };
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'INVALID_BODY', error: '요청 형식이 올바르지 않습니다.' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return { ok: false, status: 400, code: 'INVALID_BODY', error: '요청 형식이 올바르지 않습니다.' };
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'BODY_TOO_LARGE', error: '요청 데이터가 너무 큽니다.' };
  }
  return { ok: true, body };
}

module.exports = {
  MAX_BODY_BYTES,
  applyCors,
  applySecurityHeaders,
  getAllowedOrigins,
  isJsonRequest,
  isProduction,
  normalizeOrigin,
  parseJsonBody,
};
