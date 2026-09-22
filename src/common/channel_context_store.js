// Cached channel-wide translation briefs, isolated from source messages and translations.

export const CHANNEL_CONTEXT_STORE_KEY_PREFIX = '__tfsChannelContextV1:';

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

function cacheKey(value = {}) {
  return CHANNEL_CONTEXT_STORE_KEY_PREFIX + [
    encodeURIComponent(normalizeIdentifier(value.workspaceId)),
    encodeURIComponent(normalizeIdentifier(value.conversationId)),
    encodeURIComponent(normalizeIdentifier(value.model)),
    encodeURIComponent(normalizeIdentifier(value.targetLanguageName)),
    encodeURIComponent(normalizeIdentifier(value.targetLanguageCode))
  ].join(':');
}

function normalizedRecord(value = {}) {
  const record = {
    version: 1,
    workspaceId: normalizeIdentifier(value.workspaceId),
    conversationId: normalizeIdentifier(value.conversationId),
    model: normalizeIdentifier(value.model),
    targetLanguageName: normalizeIdentifier(value.targetLanguageName),
    targetLanguageCode: normalizeIdentifier(value.targetLanguageCode),
    sourceFingerprint: normalizeIdentifier(value.sourceFingerprint),
    context: value.context && typeof value.context === 'object' ? value.context : null,
    updatedAt: Number(value.updatedAt) || Date.now()
  };
  return record.workspaceId
    && record.conversationId
    && record.model
    && record.targetLanguageCode
    && record.sourceFingerprint
    && record.context
    ? record
    : null;
}

export async function getCachedChannelContext(identity = {}) {
  if (!hasChromeStorage()) return null;
  const stored = await storageGet(cacheKey(identity));
  const record = normalizedRecord(stored[cacheKey(identity)] || {});
  if (!record) return null;
  const matches = ['workspaceId', 'conversationId', 'model', 'targetLanguageName', 'targetLanguageCode', 'sourceFingerprint']
    .every((name) => record[name] === normalizeIdentifier(identity[name]));
  return matches ? record : null;
}

export function saveCachedChannelContext(value = {}) {
  return enqueue(async () => {
    if (!hasChromeStorage()) return null;
    const record = normalizedRecord({ ...value, updatedAt: Date.now() });
    if (!record) throw new Error('Không thể lưu context chung không hợp lệ.');
    await storageSet({ [cacheKey(record)]: record });
    return record;
  });
}

export function clearChannelContextStore() {
  return enqueue(async () => {
    if (!hasChromeStorage()) return;
    const stored = await storageGet(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(CHANNEL_CONTEXT_STORE_KEY_PREFIX));
    if (keys.length > 0) await storageRemove(keys);
  });
}
