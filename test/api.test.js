'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const writeHandler = require('../api/write');
const healthHandler = require('../api/health');
const legacyWriteHandler = require('../write');
const legacyHealthHandler = require('../health');
const { resetMemoryBuckets } = require('../lib/rate-limit');

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CONSOLE_ERROR = console.error;

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function createRequest(overrides = {}) {
  const body = overrides.body || {
    mode: 'generate',
    preset: '자유',
    tone: '자연스럽게',
    length: 'medium',
    request: '테스트 글을 작성해 주세요',
  };
  return {
    method: 'POST',
    headers: {
      origin: 'https://myunghoon3847-maker.github.io',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...(overrides.headers || {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
    body,
    ...overrides,
    headers: {
      origin: 'https://myunghoon3847-maker.github.io',
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...(overrides.headers || {}),
    },
  };
}

function jsonFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

test.beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    RATE_LIMIT_DRIVER: 'memory',
    RATE_LIMIT_SALT: 'test-only-rate-limit-salt',
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_SECONDS: '60',
    OPENAI_API_KEY: 'test-openai-key',
  };
  global.fetch = ORIGINAL_FETCH;
  console.error = () => {};
  resetMemoryBuckets();
});

test.after(() => {
  process.env = ORIGINAL_ENV;
  global.fetch = ORIGINAL_FETCH;
  console.error = ORIGINAL_CONSOLE_ERROR;
});

test('허용 출처에는 정확한 CORS 헤더를 반환하고 와일드카드를 사용하지 않는다', async () => {
  global.fetch = async () => jsonFetchResponse(200, { output_text: '완성된 글' });
  const res = createResponse();
  await writeHandler(createRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'https://myunghoon3847-maker.github.io');
  assert.notEqual(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers.vary, 'Origin');
});

test('허용 출처의 사전 요청만 204로 승인한다', async () => {
  const allowed = createResponse();
  await writeHandler(createRequest({ method: 'OPTIONS' }), allowed);
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://myunghoon3847-maker.github.io');

  const denied = createResponse();
  await writeHandler(createRequest({
    method: 'OPTIONS',
    headers: { origin: 'https://attacker.example' },
  }), denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'ORIGIN_DENIED');
});

test('/api/write는 POST와 OPTIONS 이외의 메서드를 거부한다', async () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = createResponse();
    await writeHandler(createRequest({ method }), res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.body.code, 'METHOD_NOT_ALLOWED');
  }
});

test('허용하지 않은 Origin은 OpenAI 호출 전에 거부한다', async () => {
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return jsonFetchResponse(200, { output_text: '호출되면 안 됨' });
  };
  const res = createResponse();
  await writeHandler(createRequest({ headers: { origin: 'https://attacker.example' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ORIGIN_DENIED');
  assert.equal(fetchCalled, false);
});

test('운영 환경에서 Origin이 없는 쓰기 요청을 거부한다', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  const req = createRequest({ headers: { origin: undefined } });
  delete req.headers.origin;
  const res = createResponse();
  await writeHandler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ORIGIN_REQUIRED');
});

test('JSON 이외의 Content-Type을 거부한다', async () => {
  const res = createResponse();
  await writeHandler(createRequest({ headers: { 'content-type': 'text/plain' } }), res);
  assert.equal(res.statusCode, 415);
  assert.equal(res.body.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('48KB를 넘는 요청 본문을 거부한다', async () => {
  const oversizedBody = {
    mode: 'revise',
    preset: '자유',
    tone: '자연스럽게',
    length: 'medium',
    request: '테스트 요청',
    previousText: '가'.repeat(17_000),
    instruction: '다듬어 주세요',
  };
  const res = createResponse();
  await writeHandler(createRequest({ body: oversizedBody }), res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, 'BODY_TOO_LARGE');
});

test('12,000자의 한국어 기존 글은 48KB 본문 한도 안에서 수정할 수 있다', async () => {
  global.fetch = async () => jsonFetchResponse(200, { output_text: '수정된 글' });
  const res = createResponse();
  await writeHandler(createRequest({
    body: {
      mode: 'revise',
      preset: '자유',
      tone: '자연스럽게',
      length: 'medium',
      request: '기존 글을 다듬어 주세요',
      previousText: '가'.repeat(12_000),
      instruction: '더 간결하게 다듬어 주세요',
    },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { text: '수정된 글' });
});

test('필드별 글자 수 상한도 별도로 적용한다', async () => {
  const cases = [
    {
      mode: 'generate',
      preset: '자유',
      tone: '자연스럽게',
      length: 'medium',
      request: 'a'.repeat(2_001),
    },
    {
      mode: 'revise',
      preset: '자유',
      tone: '자연스럽게',
      length: 'medium',
      request: '기존 글을 다듬어 주세요',
      previousText: '기존 글',
      instruction: 'a'.repeat(501),
    },
    {
      mode: 'revise',
      preset: '자유',
      tone: '자연스럽게',
      length: 'medium',
      request: '기존 글을 다듬어 주세요',
      previousText: 'a'.repeat(12_001),
      instruction: '다듬어 주세요',
    },
  ];

  for (const body of cases) {
    const res = createResponse();
    await writeHandler(createRequest({ body }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INPUT_TOO_LONG');
  }
});

test('열거형 선택값 우회를 거부한다', async () => {
  const res = createResponse();
  await writeHandler(createRequest({
    body: {
      mode: 'generate',
      preset: '<img src=x onerror=alert(1)>',
      tone: '자연스럽게',
      length: 'medium',
      request: '안전한 테스트 요청',
    },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_OPTION');
});

test('공유 제한 횟수 초과 시 429와 Retry-After를 반환한다', async () => {
  process.env.RATE_LIMIT_MAX = '2';
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return jsonFetchResponse(200, { output_text: `완성된 글 ${calls}` });
  };

  const first = createResponse();
  const second = createResponse();
  const third = createResponse();
  await writeHandler(createRequest(), first);
  await writeHandler(createRequest(), second);
  await writeHandler(createRequest(), third);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(third.statusCode, 429);
  assert.equal(third.body.code, 'RATE_LIMITED');
  assert.match(String(third.headers['retry-after']), /^\d+$/);
  assert.equal(calls, 2);
});

test('운영 환경에서 공유 제한 저장소가 없으면 안전하게 차단한다', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.RATE_LIMIT_DRIVER = 'upstash';
  const res = createResponse();
  await writeHandler(createRequest(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'RATE_LIMIT_UNAVAILABLE');
});

test('운영 환경에서 salt가 없거나 메모리 드라이버를 요청하면 안전하게 차단한다', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-upstash-token';
  delete process.env.RATE_LIMIT_SALT;

  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return jsonFetchResponse(200, { result: [1, 60] });
  };

  const missingSalt = createResponse();
  await writeHandler(createRequest(), missingSalt);
  assert.equal(missingSalt.statusCode, 503);
  assert.equal(missingSalt.body.code, 'RATE_LIMIT_UNAVAILABLE');
  assert.equal(fetchCalled, false);

  process.env.RATE_LIMIT_SALT = 'test-only-rate-limit-salt';
  process.env.RATE_LIMIT_DRIVER = 'memory';
  const unsafeDriver = createResponse();
  await writeHandler(createRequest(), unsafeDriver);
  assert.equal(unsafeDriver.statusCode, 503);
  assert.equal(unsafeDriver.body.code, 'RATE_LIMIT_UNAVAILABLE');
  assert.equal(fetchCalled, false);
});

test('운영 환경 공유 제한은 Upstash EVAL을 사용하고 IP 원문을 보내지 않는다', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  process.env.RATE_LIMIT_DRIVER = 'upstash';
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-upstash-token';
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === 'https://example.upstash.io') {
      return jsonFetchResponse(200, { result: [1, 60] });
    }
    return jsonFetchResponse(200, { output_text: '완성된 글' });
  };

  const res = createResponse();
  await writeHandler(createRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 2);
  const command = JSON.parse(requests[0].options.body);
  assert.equal(command[0], 'EVAL');
  assert.equal(command[2], '1');
  assert.doesNotMatch(requests[0].options.body, /203\.0\.113\.10/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-upstash-token');
});

test('OpenAI 원문 오류를 클라이언트 응답에 노출하지 않는다', async () => {
  const providerSecret = 'provider-secret-debug-message';
  global.fetch = async () => jsonFetchResponse(401, { error: { message: providerSecret } });
  const res = createResponse();
  await writeHandler(createRequest(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'AI_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(providerSecret));
});

test('OpenAI 원문 오류와 사용자 입력을 로그에 기록하지 않는다', async () => {
  const providerSecret = 'provider-secret-debug-message';
  const userMarker = 'private-user-input-marker';
  const logs = [];
  console.error = (value) => logs.push(JSON.stringify(value));
  global.fetch = async () => jsonFetchResponse(500, { error: { message: providerSecret } });

  const res = createResponse();
  await writeHandler(createRequest({
    body: {
      mode: 'generate',
      preset: '자유',
      tone: '자연스럽게',
      length: 'medium',
      request: `테스트 요청 ${userMarker}`,
    },
  }), res);

  assert.equal(res.statusCode, 502);
  const joinedLogs = logs.join('\n');
  assert.doesNotMatch(joinedLogs, new RegExp(providerSecret));
  assert.doesNotMatch(joinedLogs, new RegExp(userMarker));
});

test('OpenAI 요청은 저장 비활성화 옵션을 사용한다', async () => {
  let sentBody;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return jsonFetchResponse(200, { output_text: '완성된 글' });
  };
  const res = createResponse();
  await writeHandler(createRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sentBody.store, false);
  assert.equal(sentBody.model, 'gpt-5-mini');
});

test('health 응답은 키·모델 설정 상태를 노출하지 않는다', () => {
  process.env.OPENAI_MODEL = 'private-model-name';
  const req = createRequest({ method: 'GET', body: undefined });
  const res = createResponse();
  healthHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, service: 'lumen-api' });
  assert.doesNotMatch(JSON.stringify(res.body), /apiKeyConfigured|private-model-name|model/);
});

test('레거시 진입점도 보안 API 핸들러를 그대로 사용한다', () => {
  assert.equal(legacyWriteHandler, writeHandler);
  assert.equal(legacyHealthHandler, healthHandler);
});

test('정적 앱은 사용자 데이터를 innerHTML로 렌더링하지 않고 상대 PWA 경로를 사용한다', () => {
  const root = path.resolve(__dirname, '..');
  for (const relativeRoot of ['', 'public']) {
    const appJs = fs.readFileSync(path.join(root, relativeRoot, 'app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, relativeRoot, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, relativeRoot, 'manifest.webmanifest'), 'utf8'));
    const serviceWorker = fs.readFileSync(path.join(root, relativeRoot, 'sw.js'), 'utf8');

    assert.doesNotMatch(appJs, /\.innerHTML\s*=/);
    assert.match(appJs, /window\.top !== window\.self/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
    assert.doesNotMatch(html, /unsafe-inline/);
    assert.match(html, /href="\.\/styles\.css"/);
    assert.match(html, /src="\.\/app\.js"/);
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
    assert.ok(manifest.icons.every((icon) => icon.src.startsWith('./')));
    assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
    assert.match(serviceWorker, /url\.pathname\.startsWith\(API_PATH\)/);
    assert.match(serviceWorker, /APP_ENTRY_PATHS\.has\(url\.pathname\)/);
    assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\)/);
    assert.equal((serviceWorker.match(/cache\.put\(/g) || []).length, 1);
  }
});
