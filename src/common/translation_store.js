// Persistent Gemini translations kept separately from original Slack messages.

export const TRANSLATION_STORE_INDEX_KEY = '__tfsTranslationStoreIndexV1';
export const TRANSLATION_STORE_KEY_PREFIX = '__tfsTranslationStoreV1:';

let writeQueue = Promise.resolve();

function enqueue(task) {
  const next = writeQueue.catch(() => {}).then(task);
  writeQueue = next.catch(() => {});
  return next;
}

function hasChromeStorage() {
  return Boolean(globalThis.chrome?.storage?.local?.get && globalThis.chrome?.storage?.local?.set);
}

function storageCall(method, value) {
  if (!hasChromeStorage() || typeof chrome.storage.local[method] !== 'function') {
    return Promise.resolve(method === 'get' ? {} : undefined);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result ?? (method === 'get' ? {} : undefined));
    };
    try {
      const pending = chrome.storage.local[method](value, done);
      if (pending?.then) pending.then(done, reject);
    } catch (error) {
      reject(error);
    }
  });
}

const storageGet = (keys) => storageCall('get', keys);
const storageSet = (items) => storageCall('set', items);
const storageRemove = (keys) => storageCall('remove', keys);

function normalizeIdentifier(value) {
  return String(value || '').trim().slice(0, 300);
}

function conversationStorageKey(workspaceId, conversationId) {
  return `${TRANSLATION_STORE_KEY_PREFIX}${encodeURIComponent(workspaceId)}:${encodeURIComponent(conversationId)}`;
}

export function translationIdentity(message = {}) {
  const scope = message.conversationScope === 'thread' ? 'thread' : 'main';
  return [scope, scope === 'thread' ? normalizeIdentifier(message.threadTs) : '', normalizeIdentifier(message.messageId)].join(':');
}

function normalizeTranslation(raw = {}) {
  const workspaceId = normalizeIdentifier(raw.workspaceId);
  const conversationId = normalizeIdentifier(raw.conversationId);
  const conversationScope = raw.conversationScope === 'thread' ? 'thread' : 'main';
  const threadTs = normalizeIdentifier(raw.threadTs);
  const messageId = normalizeIdentifier(raw.messageId);
  const sourceHash = normalizeIdentifier(raw.sourceHash);
  const translatedHtml = typeof raw.translatedHtml === 'string' ? raw.translatedHtml.trim() : '';
  if (!workspaceId || !conversationId || !messageId || !sourceHash || !translatedHtml) return null;
  if (conversationScope === 'thread' && !threadTs) return null;
  return {
    workspaceId,
    conversationId,
    conversationScope,
    ...(conversationScope === 'thread' ? { threadTs } : {}),
    messageId,
    sourceHash,
    translatedHtml,
    provider: 'gemini',
    model: normalizeIdentifier(raw.model),
    targetLanguageName: normalizeIdentifier(raw.targetLanguageName),
    targetLanguageCode: normalizeIdentifier(raw.targetLanguageCode),
    updatedAt: Number(raw.updatedAt) || Date.now()
  };
}

function normalizeRecord(value, workspaceId, conversationId) {
  const translations = {};
  for (const raw of Object.values(value?.translations || {})) {
    const translation = normalizeTranslation({ ...raw, workspaceId, conversationId });
    if (translation) translations[translationIdentity(translation)] = translation;
  }
  return { version: 1, workspaceId, conversationId, updatedAt: Number(value?.updatedAt) || 0, translations };
}

export function upsertTranslations(items = []) {
  return enqueue(async () => {
    if (!hasChromeStorage() || !Array.isArray(items) || items.length === 0) return { saved: 0 };
    const normalized = items.map(normalizeTranslation).filter(Boolean);
    if (normalized.length === 0) return { saved: 0 };
    const groups = new Map();
    for (const item of normalized) {
      const key = conversationStorageKey(item.workspaceId, item.conversationId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const indexResult = await storageGet(TRANSLATION_STORE_INDEX_KEY);
    const index = Array.isArray(indexResult[TRANSLATION_STORE_INDEX_KEY])
      ? new Set(indexResult[TRANSLATION_STORE_INDEX_KEY])
      : new Set();
    let saved = 0;
    for (const [key, group] of groups) {
      const stored = await storageGet(key);
      const record = normalizeRecord(stored[key], group[0].workspaceId, group[0].conversationId);
      for (const item of group) {
        record.translations[translationIdentity(item)] = item;
        saved++;
      }
      record.updatedAt = Date.now();
      index.add(key);
      await storageSet({ [key]: record });
    }
    await storageSet({ [TRANSLATION_STORE_INDEX_KEY]: Array.from(index) });
    return { saved };
  });
}

export async function getStoredTranslationsForConversation(context = {}) {
  if (!hasChromeStorage()) return [];
  const workspaceId = normalizeIdentifier(context.workspaceId);
  const conversationId = normalizeIdentifier(context.conversationId);
  if (!workspaceId || !conversationId) return [];
  const key = conversationStorageKey(workspaceId, conversationId);
  const stored = await storageGet(key);
  return Object.values(normalizeRecord(stored[key], workspaceId, conversationId).translations);
}

export function clearTranslationStore() {
  return enqueue(async () => {
    if (!hasChromeStorage()) return;
    const stored = await storageGet(TRANSLATION_STORE_INDEX_KEY);
    const keys = Array.isArray(stored[TRANSLATION_STORE_INDEX_KEY])
      ? stored[TRANSLATION_STORE_INDEX_KEY]
      : [];
    await storageRemove([TRANSLATION_STORE_INDEX_KEY, ...keys]);
  });
}
