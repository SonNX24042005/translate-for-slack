// Persistent storage for original Slack messages.

export const MESSAGE_STORE_VERSION = 3;
export const MESSAGE_STORE_INDEX_KEY = '__tfsMessageStoreIndexV3';
export const MESSAGE_STORE_KEY_PREFIX = '__tfsMessageStoreV3:';

export const DEFAULT_MESSAGE_STORE_LIMITS = Object.freeze({
  maxMessagesPerConversation: 1000,
  maxTotalMegabytes: 50
});

const MIN_MESSAGES_PER_CONVERSATION = 10;
const MAX_MESSAGES_PER_CONVERSATION = 10000;
const MIN_TOTAL_MEGABYTES = 1;
const MAX_TOTAL_MEGABYTES = 1000;
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

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function normalizeMessageStoreLimits(limits = {}) {
  return {
    maxMessagesPerConversation: clampInteger(
      limits.maxMessagesPerConversation ?? limits.messageStoreMaxPerConversation,
      DEFAULT_MESSAGE_STORE_LIMITS.maxMessagesPerConversation,
      MIN_MESSAGES_PER_CONVERSATION,
      MAX_MESSAGES_PER_CONVERSATION
    ),
    maxTotalMegabytes: clampInteger(
      limits.maxTotalMegabytes ?? limits.messageStoreMaxMegabytes,
      DEFAULT_MESSAGE_STORE_LIMITS.maxTotalMegabytes,
      MIN_TOTAL_MEGABYTES,
      MAX_TOTAL_MEGABYTES
    )
  };
}

function normalizeIdentifier(value, fallback = '') {
  return String(value || '').trim().slice(0, 300) || fallback;
}

function scopeId(scope, threadTs) {
  return scope === 'thread' && threadTs ? `thread:${threadTs}` : 'main';
}

function storageKeyFor(message) {
  return `${MESSAGE_STORE_KEY_PREFIX}${encodeURIComponent(message.workspaceId)}:${encodeURIComponent(message.conversationId)}:${encodeURIComponent(scopeId(message.conversationScope, message.threadTs))}`;
}

function indexIdFor(message) {
  return `${encodeURIComponent(message.workspaceId)}:${encodeURIComponent(message.conversationId)}:${encodeURIComponent(scopeId(message.conversationScope, message.threadTs))}`;
}

function byteLength(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return typeof TextEncoder === 'undefined'
    ? unescape(encodeURIComponent(serialized)).length
    : new TextEncoder().encode(serialized).byteLength;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeMessage(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const workspaceId = normalizeIdentifier(raw.workspaceId);
  const conversationId = normalizeIdentifier(raw.conversationId);
  const conversationScope = raw.conversationScope === 'thread' ? 'thread' : 'main';
  const threadTs = normalizeIdentifier(raw.threadTs);
  const messageId = normalizeIdentifier(raw.messageId);
  const sourceText = typeof raw.sourceText === 'string' ? raw.sourceText : '';
  const sourceHtml = typeof raw.sourceHtml === 'string' ? raw.sourceHtml : '';
  const sourceHash = normalizeIdentifier(raw.sourceHash);
  if (!workspaceId || !conversationId || !messageId || !sourceHash || (!sourceText && !sourceHtml)) return null;
  if (conversationScope === 'thread' && !threadTs) return null;

  return {
    messageId,
    workspaceId,
    conversationId,
    conversationType: raw.conversationType === 'dm' ? 'dm' : 'channel',
    conversationScope,
    ...(conversationScope === 'thread' ? { threadTs } : {}),
    messageTimestamp: normalizeIdentifier(raw.messageTimestamp),
    messageTime: normalizeIdentifier(raw.messageTime),
    messageTimestampMs: normalizeTimestamp(raw.messageTimestampMs, now),
    senderId: normalizeIdentifier(raw.senderId),
    senderName: normalizeIdentifier(raw.senderName),
    sourceText,
    sourceHtml,
    sourceHash,
    firstSeenAt: normalizeTimestamp(raw.firstSeenAt, now),
    updatedAt: normalizeTimestamp(raw.updatedAt, now),
    revision: Math.max(1, Number.parseInt(raw.revision, 10) || 1)
  };
}

function emptyIndex() {
  return { version: MESSAGE_STORE_VERSION, totalBytes: 0, messageCount: 0, updatedAt: 0, conversations: {} };
}

function normalizeIndex(value) {
  if (!value || value.version !== MESSAGE_STORE_VERSION) return emptyIndex();
  return { ...emptyIndex(), ...value, conversations: { ...(value.conversations || {}) } };
}

function normalizeRecord(value, metadata) {
  const messages = {};
  for (const [messageId, raw] of Object.entries(value?.messages || {})) {
    const message = normalizeMessage({
      ...raw,
      messageId,
      workspaceId: metadata.workspaceId,
      conversationId: metadata.conversationId,
      conversationType: metadata.conversationType,
      conversationScope: metadata.conversationScope,
      threadTs: metadata.threadTs
    });
    if (message) messages[messageId] = message;
  }
  return {
    version: MESSAGE_STORE_VERSION,
    workspaceId: metadata.workspaceId,
    conversationId: metadata.conversationId,
    conversationType: metadata.conversationType === 'dm' ? 'dm' : 'channel',
    conversationScope: metadata.conversationScope === 'thread' ? 'thread' : 'main',
    ...(metadata.conversationScope === 'thread' ? { threadTs: metadata.threadTs } : {}),
    updatedAt: normalizeTimestamp(value?.updatedAt, 0),
    messages
  };
}

function messageTime(message) {
  return Number(message?.messageTimestampMs || message?.updatedAt) || 0;
}

function trimRecord(record, maximum) {
  const messages = Object.values(record.messages);
  if (messages.length <= maximum) return;
  messages.sort((a, b) => messageTime(b) - messageTime(a));
  record.messages = Object.fromEntries(messages.slice(0, maximum).map((message) => [message.messageId, message]));
}

function updateIndexEntry(index, key, record) {
  const id = indexIdFor(record);
  const messages = Object.values(record.messages);
  if (messages.length === 0) {
    delete index.conversations[id];
    return;
  }
  const times = messages.map(messageTime);
  index.conversations[id] = {
    storageKey: key,
    workspaceId: record.workspaceId,
    conversationId: record.conversationId,
    conversationType: record.conversationType,
    conversationScope: record.conversationScope,
    ...(record.conversationScope === 'thread' ? { threadTs: record.threadTs } : {}),
    messageCount: messages.length,
    byteSize: byteLength(key) + byteLength(record),
    oldestMessageAt: Math.min(...times),
    newestMessageAt: Math.max(...times),
    updatedAt: record.updatedAt
  };
}

function refreshTotals(index) {
  const entries = Object.values(index.conversations);
  index.totalBytes = entries.reduce((sum, entry) => sum + (Number(entry.byteSize) || 0), 0);
  index.messageCount = entries.reduce((sum, entry) => sum + (Number(entry.messageCount) || 0), 0);
  index.updatedAt = Date.now();
}

async function pruneMessageStoreInternal(inputLimits = {}) {
  if (!hasChromeStorage()) return emptyIndex();
  const limits = normalizeMessageStoreLimits(inputLimits);
  const result = await storageGet(MESSAGE_STORE_INDEX_KEY);
  const index = normalizeIndex(result[MESSAGE_STORE_INDEX_KEY]);
  const entries = Object.values(index.conversations);
  const stored = await storageGet(entries.map((entry) => entry.storageKey));
  const records = [];
  for (const entry of entries) {
    const record = normalizeRecord(stored[entry.storageKey], entry);
    trimRecord(record, limits.maxMessagesPerConversation);
    records.push([entry.storageKey, record]);
    updateIndexEntry(index, entry.storageKey, record);
  }
  refreshTotals(index);
  const maximumBytes = limits.maxTotalMegabytes * 1024 * 1024;
  if (index.totalBytes > maximumBytes) {
    const candidates = records.flatMap(([key, record]) => Object.values(record.messages)
      .map((message) => ({ key, record, message })))
      .sort((a, b) => messageTime(a.message) - messageTime(b.message));
    for (const candidate of candidates) {
      if (index.totalBytes <= maximumBytes) break;
      delete candidate.record.messages[candidate.message.messageId];
      updateIndexEntry(index, candidate.key, candidate.record);
      refreshTotals(index);
    }
  }
  const writes = {};
  const removals = [];
  for (const [key, record] of records) {
    if (Object.keys(record.messages).length) writes[key] = record;
    else removals.push(key);
  }
  if (Object.keys(writes).length) await storageSet(writes);
  if (removals.length) await storageRemove(removals);
  refreshTotals(index);
  await storageSet({ [MESSAGE_STORE_INDEX_KEY]: index });
  return index;
}

export function upsertOriginalMessages(inputMessages, inputLimits = {}) {
  return enqueue(async () => {
    if (!hasChromeStorage() || !Array.isArray(inputMessages) || inputMessages.length === 0) {
      return { inserted: 0, updated: 0, unchanged: 0, conversationChanges: [] };
    }
    const limits = normalizeMessageStoreLimits(inputLimits);
    const now = Date.now();
    const grouped = new Map();
    for (const raw of inputMessages) {
      const message = normalizeMessage(raw, now);
      if (!message) continue;
      const key = storageKeyFor(message);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(message);
    }
    const storedIndex = await storageGet(MESSAGE_STORE_INDEX_KEY);
    const index = normalizeIndex(storedIndex[MESSAGE_STORE_INDEX_KEY]);
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let changedAnything = false;
    const conversationChanges = [];

    for (const [key, messages] of grouped) {
      const metadata = messages[0];
      const stored = await storageGet(key);
      const record = normalizeRecord(stored[key], metadata);
      const hadIndexEntry = Boolean(index.conversations[indexIdFor(metadata)]);
      const insertedMessageIds = [];
      const updatedMessageIds = [];
      for (const message of messages) {
        const previous = record.messages[message.messageId];
        if (previous?.sourceHash === message.sourceHash) {
          unchanged++;
          continue;
        }
        if (previous) {
          record.messages[message.messageId] = {
            ...message,
            firstSeenAt: previous.firstSeenAt,
            revision: previous.revision + 1
          };
          updated++;
          updatedMessageIds.push(message.messageId);
        } else {
          record.messages[message.messageId] = message;
          inserted++;
          insertedMessageIds.push(message.messageId);
        }
      }
      trimRecord(record, limits.maxMessagesPerConversation);
      if (insertedMessageIds.length || updatedMessageIds.length) {
        record.updatedAt = now;
        await storageSet({ [key]: record });
        changedAnything = true;
      }
      if (insertedMessageIds.length || updatedMessageIds.length || !hadIndexEntry) {
        updateIndexEntry(index, key, record);
        changedAnything = true;
      }
      if (insertedMessageIds.length || updatedMessageIds.length) {
        conversationChanges.push({
          workspaceId: record.workspaceId,
          conversationId: record.conversationId,
          conversationType: record.conversationType,
          conversationScope: record.conversationScope,
          ...(record.conversationScope === 'thread' ? { threadTs: record.threadTs } : {}),
          insertedMessageIds,
          updatedMessageIds
        });
      }
    }
    if (changedAnything) {
      refreshTotals(index);
      await storageSet({ [MESSAGE_STORE_INDEX_KEY]: index });
      await pruneMessageStoreInternal(limits);
    }
    return { inserted, updated, unchanged, conversationChanges };
  });
}

export async function getStoredConversationMessages(context = {}) {
  if (!hasChromeStorage()) return [];
  const normalized = {
    workspaceId: normalizeIdentifier(context.workspaceId),
    conversationId: normalizeIdentifier(context.conversationId),
    conversationType: context.conversationType === 'dm' ? 'dm' : 'channel',
    conversationScope: context.conversationScope === 'thread' ? 'thread' : 'main',
    threadTs: normalizeIdentifier(context.threadTs)
  };
  if (!normalized.workspaceId || !normalized.conversationId) return [];
  const key = storageKeyFor(normalized);
  const stored = await storageGet(key);
  const record = normalizeRecord(stored[key], normalized);
  return Object.values(record.messages).sort((a, b) => messageTime(a) - messageTime(b));
}

export async function getStoredConversationBundle(context = {}) {
  if (!hasChromeStorage()) return [];
  const workspaceId = normalizeIdentifier(context.workspaceId);
  const conversationId = normalizeIdentifier(context.conversationId);
  if (!workspaceId || !conversationId) return [];

  const storedIndex = await storageGet(MESSAGE_STORE_INDEX_KEY);
  const index = normalizeIndex(storedIndex[MESSAGE_STORE_INDEX_KEY]);
  const entries = Object.values(index.conversations).filter((entry) => {
    return entry.workspaceId === workspaceId && entry.conversationId === conversationId;
  });
  if (entries.length === 0) return [];

  const stored = await storageGet(entries.map((entry) => entry.storageKey));
  const messages = entries.flatMap((entry) => {
    return Object.values(normalizeRecord(stored[entry.storageKey], entry).messages);
  });
  return messages.sort((left, right) => {
    const timeDifference = messageTime(left) - messageTime(right);
    if (timeDifference) return timeDifference;
    if (left.conversationScope !== right.conversationScope) {
      return left.conversationScope === 'main' ? -1 : 1;
    }
    return String(left.threadTs || '').localeCompare(String(right.threadTs || ''))
      || left.messageId.localeCompare(right.messageId);
  });
}

export function pruneMessageStore(inputLimits = {}) {
  return enqueue(() => pruneMessageStoreInternal(inputLimits));
}

export async function getMessageStoreStats() {
  if (!hasChromeStorage()) return { messageCount: 0, conversationCount: 0, totalBytes: 0, totalMegabytes: 0 };
  const result = await storageGet(MESSAGE_STORE_INDEX_KEY);
  const index = normalizeIndex(result[MESSAGE_STORE_INDEX_KEY]);
  return {
    messageCount: index.messageCount,
    conversationCount: Object.keys(index.conversations).length,
    totalBytes: index.totalBytes,
    totalMegabytes: index.totalBytes / (1024 * 1024),
    updatedAt: index.updatedAt
  };
}

export function clearMessageStore() {
  return enqueue(async () => {
    if (!hasChromeStorage()) return;
    const result = await storageGet(MESSAGE_STORE_INDEX_KEY);
    const index = normalizeIndex(result[MESSAGE_STORE_INDEX_KEY]);
    await storageRemove([
      MESSAGE_STORE_INDEX_KEY,
      ...Object.values(index.conversations).map((entry) => entry.storageKey).filter(Boolean)
    ]);
  });
}

export function isMessageStoreStorageKey(key) {
  return key === MESSAGE_STORE_INDEX_KEY || String(key || '').startsWith(MESSAGE_STORE_KEY_PREFIX);
}
