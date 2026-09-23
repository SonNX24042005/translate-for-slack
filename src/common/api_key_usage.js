import { getGeminiModel } from './gemini_models.js';

export const API_KEY_USAGE_STORAGE_KEY = '__tfsGeminiRpdUsageV1';

let reservationQueue = Promise.resolve();
let memoryUsage = { day: '', counts: {} };

function enqueueReservation(task) {
  const next = reservationQueue.catch(() => {}).then(task);
  reservationQueue = next.catch(() => {});
  return next;
}

export function pacificDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function keyId(key) {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readUsage(day = pacificDay()) {
  const stored = globalThis.chrome?.storage?.local?.get
    ? (await chrome.storage.local.get(API_KEY_USAGE_STORAGE_KEY))[API_KEY_USAGE_STORAGE_KEY]
    : memoryUsage;
  return stored?.day === day && stored.counts && typeof stored.counts === 'object'
    ? { day, counts: stored.counts }
    : { day, counts: {} };
}

async function writeUsage(usage) {
  if (globalThis.chrome?.storage?.local?.set) {
    await chrome.storage.local.set({ [API_KEY_USAGE_STORAGE_KEY]: usage });
  } else {
    memoryUsage = usage;
  }
}

export async function getApiKeyUsage(keys, day = pacificDay()) {
  const usage = await readUsage(day);
  return Promise.all(keys.map(async (key) => ({
    key,
    counts: { ...(usage.counts[await keyId(key)] || {}) }
  })));
}

export function reserveApiKey(keys, modelId, day = null) {
  return enqueueReservation(async () => {
    const model = getGeminiModel(modelId);
    if (!model) throw new Error('Model Gemini không được hỗ trợ.');
    if (!keys.length) throw new Error('Chưa có khóa API Gemini. Hãy thêm khóa trong popup.');
    const usage = await readUsage(day || pacificDay());
    for (const key of keys) {
      const id = await keyId(key);
      const counts = usage.counts[id] || {};
      const used = Number(counts[modelId]) || 0;
      if (used >= model.rpd) continue;
      usage.counts[id] = { ...counts, [modelId]: used + 1 };
      await writeUsage(usage);
      return key;
    }
    throw new Error(`Đã dùng hết RPD cục bộ của tất cả khóa API cho ${model.label} hôm nay.`);
  });
}
