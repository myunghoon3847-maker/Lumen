'use strict';

if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Framing is not allowed.');
}

const $ = (id) => document.getElementById(id);
const requestEl = $('request');
const requestCountEl = $('requestCount');
const writeButton = $('writeButton');
const retryButton = $('retryButton');
const copyButton = $('copyButton');
const downloadButton = $('downloadButton');
const restoreButton = $('restoreButton');
const resultEl = $('result');
const resultMeta = $('resultMeta');
const statusEl = $('status');
const resultStatusEl = $('resultStatus');
const editArea = $('editArea');
const editRequestEl = $('editRequest');
const editButton = $('editButton');
const newButton = $('newButton');
const inputCard = $('inputCard');
const resultCard = $('resultCard');
const toneEl = $('tone');
const lengthEl = $('length');
const installButton = $('installButton');
const historyButton = $('historyButton');
const historyDrawer = $('historyDrawer');
const drawerBackdrop = $('drawerBackdrop');
const closeHistory = $('closeHistory');
const historyList = $('historyList');
const clearHistory = $('clearHistory');
const presetButtons = [...document.querySelectorAll('.preset')];
const quickButtons = [...document.querySelectorAll('.quick')];

const HISTORY_KEY = 'lumenHistoryV2';
const LEGACY_HISTORY_KEY = 'lumenHistoryV1';
const DRAFT_KEY = 'lumenDraftV2';
const LEGACY_DRAFT_KEY = 'lumenDraft';
const PRESET_KEY = 'lumenPreset';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 50;
const PRESETS = new Set(['자유', '블로그', '유튜브', '마케팅', '자기소개서', '이메일']);
const TONES = new Set(['자연스럽게', '친근하게', '전문적으로', '설득력 있게', '간결하게']);
const LENGTHS = new Set(['short', 'medium', 'long']);
const VERCEL_API_ORIGINS = [
  'https://lumen-git-main-hoony2.vercel.app',
  'https://lumen-blxbzzpaz-hoony2.vercel.app',
];

const storedPreset = safeStorageGet(PRESET_KEY);
let selectedPreset = PRESETS.has(storedPreset) ? storedPreset : '자유';
let lastResult = '';
let originalResult = '';
let activeHistoryId = null;
let installPrompt = null;
let isLoading = false;

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private or restricted browser contexts.
  }
}

function boundedString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizeHistoryItem(item, cutoff) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const timestamp = Date.parse(item.updatedAt || item.createdAt || '');
  if (!Number.isFinite(timestamp) || timestamp < cutoff || timestamp > Date.now() + 60_000) return null;
  const parsedCreatedAt = Date.parse(item.createdAt || '');
  const createdTimestamp = Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : timestamp;
  const preset = PRESETS.has(item.preset) ? item.preset : '자유';
  const tone = TONES.has(item.tone) ? item.tone : '자연스럽게';
  const length = LENGTHS.has(item.length) ? item.length : 'medium';
  const text = boundedString(item.text, 12_000);
  if (!text) return null;
  return {
    id: boundedString(item.id, 80) || `h_${timestamp}`,
    title: boundedString(item.title, 80),
    request: boundedString(item.request, 2_000),
    text,
    preset,
    tone,
    length,
    createdAt: new Date(createdTimestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
  };
}

function setHistory(items) {
  const cutoff = Date.now() - RETENTION_MS;
  const safeItems = items
    .map((item) => normalizeHistoryItem(item, cutoff))
    .filter(Boolean)
    .slice(0, MAX_HISTORY_ITEMS);
  safeStorageSet(HISTORY_KEY, JSON.stringify(safeItems));
}

function getHistory() {
  const raw = safeStorageGet(HISTORY_KEY) || safeStorageGet(LEGACY_HISTORY_KEY) || '[]';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  const items = Array.isArray(parsed) ? parsed : [];
  const cutoff = Date.now() - RETENTION_MS;
  const safeItems = items
    .map((item) => normalizeHistoryItem(item, cutoff))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_HISTORY_ITEMS);
  setHistory(safeItems);
  safeStorageRemove(LEGACY_HISTORY_KEY);
  return safeItems;
}

getHistory();

function loadDraft() {
  const raw = safeStorageGet(DRAFT_KEY);
  if (raw) {
    try {
      const draft = JSON.parse(raw);
      const updatedAt = Date.parse(draft?.updatedAt || '');
      if (typeof draft?.value === 'string' && updatedAt >= Date.now() - RETENTION_MS) {
        return draft.value.slice(0, 2_000);
      }
    } catch {
      // Invalid drafts are discarded below.
    }
    safeStorageRemove(DRAFT_KEY);
  }
  safeStorageRemove(LEGACY_DRAFT_KEY);
  return '';
}

function saveDraft(value) {
  safeStorageSet(DRAFT_KEY, JSON.stringify({
    value: value.slice(0, 2_000),
    updatedAt: new Date().toISOString(),
  }));
}

function makeTitle(request) {
  return (request || '제목 없는 글').replace(/\s+/g, ' ').trim().slice(0, 42);
}

function updateCount({ persist = true } = {}) {
  requestCountEl.textContent = String(requestEl.value.length);
  if (persist) saveDraft(requestEl.value);
}

requestEl.value = loadDraft();
updateCount();
requestEl.addEventListener('input', updateCount);

presetButtons.forEach((button) => {
  button.classList.toggle('active', button.dataset.preset === selectedPreset);
  button.addEventListener('click', () => {
    if (!PRESETS.has(button.dataset.preset)) return;
    selectedPreset = button.dataset.preset;
    safeStorageSet(PRESET_KEY, selectedPreset);
    presetButtons.forEach((item) => item.classList.toggle('active', item === button));
    requestEl.focus();
  });
});

document.querySelectorAll('.example').forEach((button) => {
  button.addEventListener('click', () => {
    requestEl.value = boundedString(button.dataset.example, 2_000);
    updateCount();
    requestEl.focus();
  });
});

function showInputScreen() {
  resultCard.classList.add('hidden');
  inputCard.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  requestEl.focus();
}

function showResultScreen() {
  inputCard.classList.add('hidden');
  resultCard.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setLoading(value) {
  isLoading = value;
  writeButton.disabled = value;
  retryButton.disabled = value || !lastResult;
  editButton.disabled = value;
  quickButtons.forEach((button) => {
    button.disabled = value || !lastResult;
  });
}

function setResultActions(enabled) {
  copyButton.disabled = !enabled;
  retryButton.disabled = !enabled;
  downloadButton.disabled = !enabled;
  restoreButton.disabled = !enabled;
  editArea.classList.toggle('hidden', !enabled);
}

function showLoadingScreen(message) {
  showResultScreen();
  resultStatusEl.textContent = '';
  resultStatusEl.classList.remove('error-message');
  resultEl.className = 'loading-box';
  resultEl.value = '';
  resultEl.placeholder = message;
  resultEl.disabled = true;
  resultMeta.textContent = '';
  setResultActions(false);
}

function updateMeta() {
  const text = resultEl.value;
  const chars = text.replace(/\s/g, '').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  resultMeta.textContent = `약 ${words}단어 · ${chars}자`;
  lastResult = text;
}

function saveHistory(text) {
  const items = getHistory();
  const now = new Date().toISOString();
  if (activeHistoryId) {
    const index = items.findIndex((item) => item.id === activeHistoryId);
    if (index >= 0) {
      items[index] = {
        ...items[index],
        text,
        request: requestEl.value.trim(),
        preset: selectedPreset,
        tone: toneEl.value,
        length: lengthEl.value,
        updatedAt: now,
      };
      setHistory(items);
      return;
    }
  }
  const item = {
    id: `h_${Date.now()}_${makeLocalIdSuffix()}`,
    title: makeTitle(requestEl.value),
    request: requestEl.value.trim(),
    text,
    preset: selectedPreset,
    tone: toneEl.value,
    length: lengthEl.value,
    createdAt: now,
    updatedAt: now,
  };
  activeHistoryId = item.id;
  setHistory([item, ...items]);
}

function makeLocalIdSuffix() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
  }
  return Math.random().toString(16).slice(2, 10);
}

function showResult(text, { save = true, asOriginal = true } = {}) {
  resultEl.disabled = false;
  resultEl.className = 'result-editor';
  resultEl.placeholder = '';
  resultEl.value = boundedString(text, 12_000);
  resultStatusEl.textContent = '';
  resultStatusEl.classList.remove('error-message');
  lastResult = resultEl.value;
  if (asOriginal) originalResult = resultEl.value;
  updateMeta();
  setResultActions(Boolean(lastResult));
  if (save && lastResult) saveHistory(lastResult);
}

function showFailure(message, previousText = '') {
  showResultScreen();
  resultStatusEl.textContent = boundedString(message, 300) || '요청을 처리하지 못했습니다.';
  resultStatusEl.classList.add('error-message');
  resultEl.disabled = false;
  resultEl.className = 'result-editor';
  resultEl.placeholder = '';
  resultEl.value = boundedString(previousText, 12_000);
  lastResult = resultEl.value;
  if (lastResult) updateMeta();
  else resultMeta.textContent = '';
  setResultActions(Boolean(lastResult));
}

resultEl.addEventListener('input', () => {
  if (isLoading) return;
  updateMeta();
  if (activeHistoryId) {
    clearTimeout(resultEl._saveTimer);
    resultEl._saveTimer = setTimeout(() => saveHistory(resultEl.value), 500);
  }
});

function getApiUrls() {
  if (location.hostname.endsWith('.vercel.app')) return ['./api/write'];
  return VERCEL_API_ORIGINS.map((origin) => `${origin}/api/write`);
}

async function fetchWithTimeout(url, options, timeoutMs = 58_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function callApi(payload) {
  if (!navigator.onLine) throw new Error('인터넷 연결을 확인해 주세요.');
  for (const url of getApiUrls()) {
    let response;
    try {
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      if ([404, 405].includes(response.status)) continue;
      throw new Error('AI 서버 응답 형식을 확인할 수 없습니다.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) continue;
      throw new Error(typeof data.error === 'string' ? data.error : '글 작성에 실패했습니다.');
    }
    if (typeof data.text !== 'string' || !data.text.trim()) {
      throw new Error('AI 결과가 비어 있습니다. 다시 시도해 주세요.');
    }
    return data.text.trim();
  }
  throw new Error('AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

async function generate() {
  const request = requestEl.value.trim();
  if (request.length < 4) {
    requestEl.focus();
    statusEl.textContent = '요청 내용을 4자 이상 입력해 주세요.';
    return;
  }
  const previousText = lastResult;
  statusEl.textContent = '';
  setLoading(true);
  showLoadingScreen('AI가 글을 작성하고 있습니다.');
  try {
    const text = await callApi({
      mode: 'generate',
      preset: selectedPreset,
      tone: toneEl.value,
      length: lengthEl.value,
      request,
    });
    activeHistoryId = null;
    showResult(text);
  } catch (error) {
    showFailure(error?.message || '글 작성에 실패했습니다.', previousText);
  } finally {
    setLoading(false);
  }
}

async function revise(instructionOverride = '') {
  const instruction = (instructionOverride || editRequestEl.value).trim();
  if (!lastResult || !instruction) return;
  const previousText = lastResult;
  setLoading(true);
  showLoadingScreen('요청에 맞게 글을 수정하고 있습니다.');
  try {
    const text = await callApi({
      mode: 'revise',
      preset: selectedPreset,
      tone: toneEl.value,
      length: lengthEl.value,
      request: requestEl.value.trim(),
      previousText,
      instruction,
    });
    showResult(text, { save: true, asOriginal: false });
    editRequestEl.value = '';
  } catch (error) {
    showFailure(error?.message || '글 수정에 실패했습니다.', previousText);
  } finally {
    setLoading(false);
  }
}

writeButton.addEventListener('click', generate);
retryButton.addEventListener('click', generate);
editButton.addEventListener('click', () => revise());
quickButtons.forEach((button) => button.addEventListener('click', () => revise(button.dataset.instruction)));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    resultCard.classList.contains('hidden') ? generate() : revise();
  }
});

newButton.addEventListener('click', () => {
  lastResult = '';
  originalResult = '';
  activeHistoryId = null;
  resultEl.className = 'result-editor';
  resultEl.value = '';
  resultEl.placeholder = '';
  resultMeta.textContent = '';
  resultStatusEl.textContent = '';
  editRequestEl.value = '';
  setResultActions(false);
  showInputScreen();
});

restoreButton.addEventListener('click', () => {
  if (!originalResult) return;
  resultEl.value = originalResult;
  updateMeta();
  saveHistory(resultEl.value);
});

copyButton.addEventListener('click', async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(lastResult);
  } catch {
    resultEl.select();
    document.execCommand('copy');
  }
  copyButton.textContent = '복사 완료';
  setTimeout(() => {
    copyButton.textContent = '복사';
  }, 1400);
});

downloadButton.addEventListener('click', () => {
  if (!lastResult) return;
  const blob = new Blob([lastResult], { type: 'text/plain;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'lumen-ai-result.txt';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
});

function createButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function renderHistory() {
  const items = getHistory();
  historyList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '아직 저장된 작성 결과가 없습니다.';
    historyList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const article = document.createElement('article');
    article.className = 'history-item';
    const title = document.createElement('h3');
    title.textContent = item.title || makeTitle(item.request);
    const meta = document.createElement('p');
    const date = new Date(item.updatedAt || item.createdAt);
    meta.textContent = `${item.preset} · ${date.toLocaleString('ko-KR')}`;
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    actions.append(
      createButton('열기', () => openHistoryItem(item)),
      createButton('삭제', () => {
        setHistory(getHistory().filter((stored) => stored.id !== item.id));
        renderHistory();
      }),
    );
    article.append(title, meta, actions);
    historyList.appendChild(article);
  });
}

function openHistory() {
  renderHistory();
  historyDrawer.classList.remove('hidden');
  drawerBackdrop.classList.remove('hidden');
}

function closeHistoryDrawer() {
  historyDrawer.classList.add('hidden');
  drawerBackdrop.classList.add('hidden');
}

function openHistoryItem(item) {
  selectedPreset = PRESETS.has(item.preset) ? item.preset : '자유';
  presetButtons.forEach((button) => button.classList.toggle('active', button.dataset.preset === selectedPreset));
  toneEl.value = TONES.has(item.tone) ? item.tone : '자연스럽게';
  lengthEl.value = LENGTHS.has(item.length) ? item.length : 'medium';
  requestEl.value = boundedString(item.request, 2_000);
  updateCount();
  activeHistoryId = item.id;
  originalResult = boundedString(item.text, 12_000);
  showResult(item.text, { save: false, asOriginal: false });
  showResultScreen();
  closeHistoryDrawer();
}

historyButton.addEventListener('click', openHistory);
closeHistory.addEventListener('click', closeHistoryDrawer);
drawerBackdrop.addEventListener('click', closeHistoryDrawer);
clearHistory.addEventListener('click', () => {
  if (window.confirm('저장된 작성 이력을 모두 삭제할까요?')) {
    setHistory([]);
    renderHistory();
    activeHistoryId = null;
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.classList.remove('hidden');
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.classList.add('hidden');
});
window.addEventListener('appinstalled', () => installButton.classList.add('hidden'));
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}
