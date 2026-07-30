'use strict';

const {
  applyCors,
  applySecurityHeaders,
  isJsonRequest,
  parseJsonBody,
} = require('../lib/security');
const {
  applyRateLimitHeaders,
  checkRateLimit,
} = require('../lib/rate-limit');

const PRESET_GUIDES = {
  자유: '사용자의 요청에 가장 알맞은 형식으로 완성도 높은 한국어 글을 작성하세요.',
  블로그: '블로그 게시물 형식으로 작성하세요. 자연스러운 제목과 소제목을 사용하고 읽기 편한 문단으로 구성하세요.',
  유튜브: '유튜브 영상 대본 또는 영상 설명문에 적합하게 작성하세요. 첫 부분에서 관심을 끌고 전달력이 좋게 구성하세요.',
  마케팅: '과장된 허위 표현은 피하면서 장점과 행동 유도를 분명하게 전달하는 마케팅 글로 작성하세요.',
  자기소개서: '지원자의 강점과 경험이 구체적으로 드러나는 자기소개서 문체로 작성하세요. 확인되지 않은 경험은 만들어내지 마세요.',
  이메일: '받는 사람이 이해하기 쉬운 이메일 형식으로 작성하세요. 상황에 맞는 제목, 인사, 본문, 마무리를 포함하세요.',
};
const LENGTH_GUIDES = {
  short: '핵심만 담아 짧고 간결하게 작성하세요.',
  medium: '충분한 설명을 포함하되 지나치게 길지 않게 작성하세요.',
  long: '구체적인 설명과 예시를 포함해 충분히 자세하게 작성하세요.',
};
const TONE_GUIDES = {
  자연스럽게: '부자연스러운 번역투 없이 자연스럽게 작성하세요.',
  친근하게: '부담 없이 읽히는 친근하고 따뜻한 문체로 작성하세요.',
  전문적으로: '신뢰감 있고 정확한 전문 문체로 작성하세요.',
  '설득력 있게': '핵심 근거와 이점을 분명히 드러내 설득력 있게 작성하세요.',
  간결하게: '중복을 줄이고 짧고 명확한 문장으로 작성하세요.',
};
const VALID_MODES = new Set(['generate', 'revise']);
const MAX_REQUEST_CHARS = 2000;
const MAX_INSTRUCTION_CHARS = 500;
const MAX_PREVIOUS_TEXT_CHARS = 12000;

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function buildPrompt({ mode, preset, tone, length, request, previousText, instruction }) {
  if (mode === 'revise') {
    return [
      '아래 기존 글을 사용자의 수정 요청에 맞게 고쳐서 완성본만 출력하세요.',
      '원래 글의 핵심 내용은 유지하되 수정 요청을 우선 반영하세요.',
      TONE_GUIDES[tone],
      LENGTH_GUIDES[length],
      '',
      '[원래 요청]',
      request,
      '',
      '[기존 글]',
      previousText,
      '',
      '[수정 요청]',
      instruction,
    ].join('\n');
  }
  return [
    PRESET_GUIDES[preset],
    TONE_GUIDES[tone],
    LENGTH_GUIDES[length],
    '설명이나 작업 과정은 쓰지 말고 사용자가 바로 복사해 사용할 수 있는 완성된 글만 출력하세요.',
    '사용자가 제공하지 않은 사실, 사용 경험, 수치, 인물 정보는 임의로 만들어내지 마세요.',
    '',
    '[사용자 요청]',
    request,
  ].join('\n');
}

function validatePayload(body) {
  const {
    mode = 'generate',
    preset = '자유',
    tone = '자연스럽게',
    length = 'medium',
    request = '',
    previousText = '',
    instruction = '',
  } = body;

  if (![mode, preset, tone, length, request, previousText, instruction].every((value) => typeof value === 'string')) {
    return { ok: false, code: 'INVALID_FIELD_TYPE', error: '입력 형식이 올바르지 않습니다.' };
  }
  if (!VALID_MODES.has(mode) || !Object.hasOwn(PRESET_GUIDES, preset)
      || !Object.hasOwn(TONE_GUIDES, tone) || !Object.hasOwn(LENGTH_GUIDES, length)) {
    return { ok: false, code: 'INVALID_OPTION', error: '선택 항목이 올바르지 않습니다.' };
  }

  const normalized = {
    mode,
    preset,
    tone,
    length,
    request: request.trim(),
    previousText: previousText.trim(),
    instruction: instruction.trim(),
  };
  if (normalized.request.length < 4) {
    return { ok: false, code: 'EMPTY_REQUEST', error: '글쓰기 요청을 4자 이상 입력해 주세요.' };
  }
  if (request.length > MAX_REQUEST_CHARS
      || instruction.length > MAX_INSTRUCTION_CHARS
      || previousText.length > MAX_PREVIOUS_TEXT_CHARS) {
    return { ok: false, code: 'INPUT_TOO_LONG', error: '입력 가능한 글자 수를 초과했습니다.' };
  }
  if (mode === 'revise' && (!normalized.previousText || !normalized.instruction)) {
    return { ok: false, code: 'INVALID_REVISION', error: '수정할 글과 수정 요청이 필요합니다.' };
  }
  return { ok: true, value: normalized };
}

async function requestOpenAI({ apiKey, model, input }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: '당신은 한국어 글쓰기 전문 AI입니다. 명확하고 자연스러우며 실제 사용 가능한 글을 작성합니다.',
        input,
        max_output_tokens: 2200,
        store: false,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const rawText = await response.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = {};
    }
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

function providerFailure(status) {
  if (status === 429) {
    return {
      status: 503,
      code: 'AI_BUSY',
      error: 'AI 서비스 사용량이 많습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 503,
      code: 'AI_SERVICE_UNAVAILABLE',
      error: 'AI 서비스를 사용할 수 없습니다. 관리자에게 문의해 주세요.',
    };
  }
  return {
    status: 502,
    code: 'AI_UPSTREAM_ERROR',
    error: 'AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
  };
}

async function handler(req, res) {
  applySecurityHeaders(res);
  const cors = applyCors(req, res, ['POST', 'OPTIONS'], { requireOrigin: true });
  if (cors.handled) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
  }
  if (!isJsonRequest(req)) {
    return res.status(415).json({ error: 'JSON 형식의 요청만 지원합니다.', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }

  const parsed = parseJsonBody(req);
  if (!parsed.ok) {
    return res.status(parsed.status).json({ error: parsed.error, code: parsed.code });
  }
  const validated = validatePayload(parsed.body);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error, code: validated.code });
  }

  let rateLimit;
  try {
    rateLimit = await checkRateLimit(req);
  } catch (error) {
    console.error({ event: 'rate_limit_unavailable', code: error?.message || 'UNKNOWN' });
    return res.status(503).json({
      error: '안전한 사용량 제한 장치를 확인할 수 없어 요청을 처리하지 않았습니다.',
      code: 'RATE_LIMIT_UNAVAILABLE',
    });
  }
  applyRateLimitHeaders(res, rateLimit);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      code: 'RATE_LIMITED',
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI 서비스가 아직 준비되지 않았습니다.',
      code: 'AI_NOT_CONFIGURED',
    });
  }

  const input = buildPrompt(validated.value);
  const configured = process.env.OPENAI_MODEL?.trim();
  const models = [...new Set([configured, 'gpt-5-mini', 'gpt-4.1-mini'].filter(Boolean))];
  let lastFailure = null;

  try {
    for (const model of models) {
      const { response, data } = await requestOpenAI({ apiKey, model, input });
      if (response.ok) {
        const text = extractOutputText(data);
        if (!text) {
          lastFailure = { status: 502, model };
          continue;
        }
        return res.status(200).json({ text });
      }

      lastFailure = { status: response.status, model };
      const providerMessage = String(data?.error?.message || '').toLowerCase();
      const modelUnavailable = response.status === 404 && providerMessage.includes('model');
      console.error({ event: 'openai_error', status: response.status, model });
      if (modelUnavailable) continue;
      const failure = providerFailure(response.status);
      return res.status(failure.status).json({ error: failure.error, code: failure.code });
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({
        error: 'AI 응답 시간이 너무 길어 요청이 중단되었습니다. 다시 시도해 주세요.',
        code: 'TIMEOUT',
      });
    }
    console.error({ event: 'openai_request_failed', code: error?.name || 'UNKNOWN' });
    return res.status(502).json({
      error: 'AI 서버와 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      code: 'AI_CONNECTION_FAILED',
    });
  }

  console.error({ event: 'all_models_failed', status: lastFailure?.status, model: lastFailure?.model });
  return res.status(502).json({
    error: '현재 사용할 수 있는 AI 모델이 없습니다. 관리자에게 문의해 주세요.',
    code: 'MODEL_UNAVAILABLE',
  });
}

module.exports = handler;
module.exports._internals = {
  buildPrompt,
  extractOutputText,
  providerFailure,
  validatePayload,
};
