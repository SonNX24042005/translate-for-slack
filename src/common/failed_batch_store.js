// Translation batches that failed after every retry, kept per conversation so they can be resent later.

export const FAILED_BATCH_STORE_KEY_PREFIX = '__tfsFailedBatchesV1:';

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

function storageKey(context = {}) {
  const workspaceId = normalizeIdentifier(context.workspaceId);
  const conversationId = normalizeIdentifier(context.conversationId);
  if (!workspaceId || !conversationId) return '';
  return `${FAILED_BATCH_STORE_KEY_PREFIX}${encodeURIComponent(workspaceId)}:${encodeURIComponent(conversationId)}`;
}

function normalizeBatches(value) {
  const seen = new Set();
  const batches = [];
  for (const batch of Array.isArray(value) ? value : []) {
    const messageKeys = (Array.isArray(batch?.messageKeys) ? batch.messageKeys : [])
      .map((key) => String(key || '').trim())
      .filter((key) => key && !seen.has(key));
    if (messageKeys.length === 0) continue;
    messageKeys.forEach((key) => seen.add(key));
    batches.push({
      messageKeys,
      error: String(batch?.error || '').slice(0, 500),
      failedAt: Number(batch?.failedAt) || Date.now()
    });
  }
  return batches;
}

export async function getFailedBatches(context = {}) {
  const key = storageKey(context);
  if (!key || !hasChromeStorage()) return [];
  const stored = (await storageGet(key))[key];
  return stored?.version === 1 ? normalizeBatches(stored.batches) : [];
}

// Replaces the failed batches of one conversation; an empty list removes the record.
export function saveFailedBatches(context = {}, batches = []) {
  return enqueue(async () => {
    const key = storageKey(context);
    if (!key || !hasChromeStorage()) return [];
    const normalized = normalizeBatches(batches);
    if (normalized.length === 0) await storageRemove(key);
    else await storageSet({ [key]: { version: 1, batches: normalized, updatedAt: Date.now() } });
    return normalized;
  });
}

export function clearFailedBatchStore() {
  return enqueue(async () => {
    if (!hasChromeStorage()) return;
    const stored = await storageGet(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(FAILED_BATCH_STORE_KEY_PREFIX));
    if (keys.length > 0) await storageRemove(keys);
  });
}
