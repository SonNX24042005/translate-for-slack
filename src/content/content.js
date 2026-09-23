// Slack message collection, history loading, and conversation-wide Gemini translation.

import { getConfig, subscribeConfigChange } from '../common/storage.js';
import { getStoredConversationBundle, upsertOriginalMessages } from '../common/message_store.js';
import { getCachedChannelContext, saveCachedChannelContext } from '../common/channel_context_store.js';
import {
  getStoredTranslationsForConversation,
  translationIdentity,
  upsertTranslations
} from '../common/translation_store.js';
import {
  buildTranslationPrompt,
  parseAndValidateBatchHtml,
  restoreOriginalSlackHtml,
  wrapBatchHtml
} from '../translation/batch_prompt.js';
import {
  channelContextSourceFingerprint,
  generateChannelContext,
  normalizeChannelContext
} from '../translation/channel_context.js';

const MESSAGE_CONTAINER_SELECTOR = '[data-qa="message_container"], .c-message_kit__message, .c-message_kit__background';
const TRANSLATION_BATCH_SIZE = 3;
const TRANSLATION_CONCURRENCY = 3;
const TRANSLATION_MAX_ATTEMPTS = 5;
const TRANSLATION_RETRY_BASE_DELAY_MS = 1000;
const CONTROLS_COLLAPSED_STORAGE_KEY = '__tfsControlsCollapsedV1';
const MESSAGE_CONTENT_SELECTORS = [
  '[data-qa="message-text"]',
  '[data-qa="message_content"]',
  '.c-message__body',
  '.c-message_kit__blocks',
  '.c-message_kit__message__message_blocks'
];
const SCROLL_SELECTOR = [
  '[data-qa="slack_kit_scrollbar"]',
  '.p-message_pane__scrollbar',
  '.c-message_list .c-scrollbar__hider',
  '.c-virtual_list__scroll_container'
].join(', ');
const EXTENSION_UI_MUTATION_SELECTOR = '.tfs-history-control, .tfs-message-translation-toggle';
const THREAD_PANE_SELECTOR = '[data-qa="thread_view"], .p-threads_flexpane';
const THREAD_TS_ATTRIBUTES = [
  'data-thread-ts',
  'data-thread_ts',
  'data-thread-root-ts',
  'data-root-message-ts',
  'data-parent-message-ts'
];
const REMOVED_FROM_SNAPSHOT_SELECTOR = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  '[data-qa="message_actions"]',
  '.c-message_actions__container',
  '.slack-translate-result-card',
  '.slack-translate-in-place-header',
  '.slack-translate-action-btn',
  '.tfs-message-translation-toggle',
  '#tfs-message-history-control',
  '#tfs-translate-all-control',
  '#tfs-translate-new-control',
  '#tfs-controls-toggle',
  '#slack-translate-history-control'
].join(', ');

let currentConfig = {
  storeOriginalMessages: true,
  messageStoreMaxPerConversation: 1000,
  messageStoreMaxMegabytes: 50,
  geminiApiKey: '',
  geminiApiKeys: [],
  geminiModel: 'gemini-3.8-flash',
  targetLanguageName: 'Vietnamese',
  targetLanguageCode: 'vi'
};
let observer = null;
let storageTimer = null;
let messageButtonTimer = null;
let lastActiveScrollContainer = null;
let activeHistorySession = null;
const historyControlResetTimers = new WeakMap();
const messageTranslationButtonResetTimers = new WeakMap();
const threadHistoryControls = new Map();
let threadHistoryControlSequence = 0;
let translationControl = null;
let newTranslationControl = null;
let controlsToggle = null;
let translationApplyTimer = null;
let translationRunning = false;
let translationCacheConversation = '';
let translationCache = new Map();
const renderedMessageTranslations = new WeakMap();

function getRootLocation(rootNode) {
  return rootNode?.location
    || rootNode?.ownerDocument?.defaultView?.location
    || rootNode?.defaultView?.location
    || globalThis.window?.location
    || null;
}

function normalizeSlackTs(value) {
  const normalized = String(value || '').trim();
  return /^\d{9,}(?:\.\d+)?$/.test(normalized) ? normalized : '';
}

function readAttributeFromSelfOrDescendant(element, attributes) {
  if (!element) return '';
  for (const attribute of attributes) {
    const own = element.getAttribute?.(attribute);
    if (own) return own;
  }
  const selector = attributes.map((attribute) => `[${attribute}]`).join(', ');
  const descendant = element.querySelector?.(selector);
  for (const attribute of attributes) {
    const value = descendant?.getAttribute?.(attribute);
    if (value) return value;
  }
  return '';
}

function readMessageTs(element) {
  return normalizeSlackTs(readAttributeFromSelfOrDescendant(element, ['data-message-ts', 'data-ts']));
}

function readThreadTsAttribute(element) {
  if (!element) return '';
  for (const attribute of THREAD_TS_ATTRIBUTES) {
    const value = normalizeSlackTs(element.getAttribute?.(attribute));
    if (value) return value;
  }
  return '';
}

function readThreadTsFromUrl(element, rootNode) {
  const href = element?.getAttribute?.('href') || '';
  if (!href.includes('thread_ts=')) return '';
  try {
    return normalizeSlackTs(new URL(href, getRootLocation(rootNode)?.href || 'https://app.slack.com/').searchParams.get('thread_ts'));
  } catch {
    return normalizeSlackTs(href.match(/[?&]thread_ts=(\d{9,}(?:\.\d+)?)/)?.[1]);
  }
}

function explicitThreadTs(container, rootNode) {
  let current = container;
  while (current && current.nodeType === 1) {
    const value = readThreadTsAttribute(current);
    if (value) return value;
    current = current.parentElement;
  }
  return readThreadTsFromUrl(container?.querySelector?.('[href*="thread_ts="]'), rootNode);
}

function threadRootTs(threadPane, rootNode) {
  const paneValue = readThreadTsAttribute(threadPane);
  if (paneValue) return paneValue;
  const rootMessage = threadPane?.querySelector?.([
    '[data-qa="thread_root_message"]',
    '[data-qa="thread_root"]',
    '[data-thread-root="true"]',
    '.p-thread_view__root_message',
    MESSAGE_CONTAINER_SELECTOR
  ].join(', '));
  return readThreadTsAttribute(rootMessage)
    || explicitThreadTs(rootMessage, rootNode)
    || readMessageTs(rootMessage);
}

export function getSlackConversationContext(rootNode, container = null) {
  const match = (getRootLocation(rootNode)?.pathname || '').match(/\/client\/([^/]+)(?:\/([^/?#]+))?/i);
  const workspaceId = match?.[1] ? decodeURIComponent(match[1]) : '';
  const routeConversationId = match?.[2] ? decodeURIComponent(match[2]) : '';
  const messageConversationId = readAttributeFromSelfOrDescendant(container, ['data-message-channel']);
  const conversationId = messageConversationId || routeConversationId;
  if (!workspaceId || !conversationId || /^(?:unreads|threads|drafts|activity)$/i.test(conversationId)) return null;

  const pane = container?.closest?.(THREAD_PANE_SELECTOR) || null;
  const currentTs = readMessageTs(container);
  const explicit = explicitThreadTs(container, rootNode);
  const threadTs = pane
    ? (explicit || threadRootTs(pane, rootNode))
    : (explicit && explicit !== currentTs ? explicit : '');
  if (pane && !threadTs) return null;
  return {
    workspaceId,
    conversationId,
    conversationType: /^D[A-Z0-9]+$/i.test(conversationId) ? 'dm' : 'channel',
    conversationScope: threadTs ? 'thread' : 'main',
    ...(threadTs ? { threadTs } : {})
  };
}

function removeUnsafeSnapshotContent(clone) {
  clone.querySelectorAll?.(REMOVED_FROM_SNAPSHOT_SELECTOR).forEach((element) => element.remove());
  for (const element of [clone, ...(clone.querySelectorAll?.('*') || [])]) {
    for (const attribute of Array.from(element.attributes || [])) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  return clone;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function snapshotText(clone) {
  clone.querySelectorAll?.('br').forEach((element) => element.replaceWith('\n'));
  clone.querySelectorAll?.('p, div, li, blockquote, pre').forEach((element) => {
    element.append(element.ownerDocument.createTextNode('\n'));
  });
  return normalizeText(clone.textContent);
}

export function createSourceSnapshot(contentElement) {
  if (!contentElement?.cloneNode) return null;
  const rendered = renderedMessageTranslations.get(contentElement);
  if (rendered) {
    const currentHtml = contentElement.innerHTML.trim();
    const knownHtml = [rendered.originalHtml, rendered.translatedHtml].map((html) => String(html || '').trim());
    if (knownHtml.includes(currentHtml)) return { ...rendered.sourceSnapshot };
    renderedMessageTranslations.delete(contentElement);
  }
  const htmlClone = removeUnsafeSnapshotContent(contentElement.cloneNode(true));
  const textClone = htmlClone.cloneNode(true);
  const sourceHtml = htmlClone.innerHTML.trim();
  const sourceText = snapshotText(textClone);
  if (!sourceText && !sourceHtml) return null;
  const hashInput = `${sourceText}\n${sourceHtml}`;
  let hash = 2166136261;
  for (let index = 0; index < hashInput.length; index++) {
    hash ^= hashInput.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { sourceText, sourceHtml, sourceHash: `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}` };
}

function getMessageContent(container) {
  if (!container?.querySelector) return null;
  for (const selector of MESSAGE_CONTENT_SELECTORS) {
    const matches = Array.from(container.querySelectorAll(selector));
    const content = matches.find((element) => !matches.some((other) => other !== element && other.contains(element)));
    if (content) return content;
  }
  return null;
}

function canonicalContainer(element) {
  if (!element) return null;
  const candidates = [];
  let current = element.matches?.(MESSAGE_CONTAINER_SELECTOR) ? element : element.closest?.(MESSAGE_CONTAINER_SELECTOR);
  while (current) {
    candidates.push(current);
    current = current.parentElement?.closest?.(MESSAGE_CONTAINER_SELECTOR);
  }
  return candidates.find((candidate) => readMessageTs(candidate) || candidate.id) || candidates[0] || null;
}

export function findMessageContainers(rootNode = globalThis.document) {
  if (!rootNode?.querySelectorAll) return [];
  const containers = new Set();
  for (const match of rootNode.querySelectorAll(MESSAGE_CONTAINER_SELECTOR)) {
    const container = canonicalContainer(match);
    if (container && getMessageContent(container)) containers.add(container);
  }
  return Array.from(containers).map((containerElement) => ({
    containerElement,
    contentElement: getMessageContent(containerElement)
  }));
}

function getMessageMetadata(container, snapshot) {
  const timestampElement = container?.querySelector?.('[data-message-ts], [data-ts], time[datetime], [data-qa="message_timestamp"]');
  const timestamp = readMessageTs(container);
  const dateTime = timestampElement?.getAttribute?.('datetime') || '';
  const explicitId = readAttributeFromSelfOrDescendant(container, ['data-message-id']);
  const virtualItemId = container?.closest?.('.c-virtual_list__item')?.id || '';
  const elementId = container?.id && container.id !== 'message_container' ? container.id : '';
  const messageId = explicitId || timestamp || elementId || virtualItemId;
  if (!messageId) return null;
  let timestampMs = timestamp ? Math.round(Number(timestamp) * 1000) : Date.parse(dateTime);
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) timestampMs = Date.now();
  const sender = container.querySelector?.('[data-qa="message_sender"], [data-member-id], .c-message__sender');
  return {
    messageId,
    messageTimestamp: timestamp || dateTime,
    messageTime: dateTime || new Date(timestampMs).toISOString(),
    messageTimestampMs: timestampMs,
    senderId: sender?.getAttribute?.('data-member-id') || sender?.getAttribute?.('data-user-id') || '',
    senderName: normalizeText(sender?.textContent || ''),
    ...snapshot
  };
}

function recordIdentity(record) {
  return `${record.workspaceId}:${record.conversationId}:${record.conversationScope}:${record.threadTs || ''}:${record.messageId}`;
}

function baseConversationIdentity(context) {
  return context ? `${context.workspaceId}:${context.conversationId}` : '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function translationSourceHtml(message) {
  return String(message?.sourceHtml || '').trim() || escapeHtml(message?.sourceText || '');
}

function sourceSnapshotForItem(item) {
  const contentElement = item?.contentElement || getMessageContent(item?.containerElement);
  const renderedState = contentElement ? renderedMessageTranslations.get(contentElement) : null;
  if (renderedState) {
    const currentHtml = String(contentElement.innerHTML || '').trim();
    const knownHtml = [renderedState.originalHtml, renderedState.translatedHtml]
      .map((html) => String(html || '').trim());
    if (knownHtml.includes(currentHtml)) return renderedState.sourceSnapshot;
    renderedMessageTranslations.delete(contentElement);
  }
  return createSourceSnapshot(contentElement);
}

function visibleRecord(item, rootNode) {
  const context = getSlackConversationContext(rootNode, item.containerElement);
  const snapshot = sourceSnapshotForItem(item);
  const metadata = snapshot ? getMessageMetadata(item.containerElement, snapshot) : null;
  return context && metadata ? { ...context, ...metadata } : null;
}

function translationMatchesConfig(translation, record, config = currentConfig) {
  return translation
    && translation.sourceHash === record.sourceHash
    && translation.model === String(config.geminiModel || '').trim()
    && translation.targetLanguageName === String(config.targetLanguageName || '').trim()
    && translation.targetLanguageCode === String(config.targetLanguageCode || '').trim();
}

function placeMessageTranslationButton(item, button) {
  const contentElement = item?.contentElement;
  const parent = contentElement?.parentNode;
  if (!parent || !button) return;
  if (button.parentNode !== parent || button.previousSibling !== contentElement) {
    parent.insertBefore(button, contentElement.nextSibling);
  }
}

function ensureMessageToggle(item, state) {
  const escapedKey = globalThis.CSS?.escape ? globalThis.CSS.escape(state.key) : state.key.replace(/["\\]/g, '\\$&');
  let button = item.containerElement.querySelector?.(`.tfs-message-translation-toggle[data-tfs-message-key="${escapedKey}"]`);
  if (!button) {
    button = item.containerElement.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'tfs-message-translation-toggle';
    button.dataset.tfsMessageKey = state.key;
  }
  placeMessageTranslationButton(item, button);
  bindMessageTranslationButton(button, item, item.containerElement.ownerDocument, state.key);
  const label = state.showingTranslation ? 'Bản gốc' : 'Dịch';
  const title = state.showingTranslation ? 'Hiện nội dung gốc' : 'Hiện bản dịch';
  if (button.textContent !== label) button.textContent = label;
  if (button.title !== title) button.title = title;
  return button;
}

function restoreRenderedTranslations(rootNode = globalThis.document) {
  for (const item of findMessageContainers(rootNode)) {
    const state = renderedMessageTranslations.get(item.contentElement);
    if (state) {
      item.contentElement.innerHTML = state.originalHtml;
      renderedMessageTranslations.delete(item.contentElement);
    }
    delete item.contentElement.dataset.tfsTranslationView;
  }
  rootNode.querySelectorAll?.('.tfs-message-translation-toggle').forEach((element) => element.remove());
}

export async function applyStoredTranslations(rootNode = globalThis.document, options = {}) {
  const context = getSlackConversationContext(rootNode);
  const cacheIdentity = baseConversationIdentity(context);
  if (!cacheIdentity) return 0;
  if (options.reload || translationCacheConversation !== cacheIdentity) {
    const translations = await getStoredTranslationsForConversation(context);
    translationCache = new Map(translations.map((translation) => [translationIdentity(translation), translation]));
    translationCacheConversation = cacheIdentity;
  }

  let applied = 0;
  for (const item of findMessageContainers(rootNode)) {
    const record = visibleRecord(item, rootNode);
    if (!record || baseConversationIdentity(record) !== cacheIdentity) continue;
    const key = translationIdentity(record);
    const translation = translationCache.get(key);
    if (!translationMatchesConfig(translation, record)) continue;

    let state = renderedMessageTranslations.get(item.contentElement);
    if (state) {
      const currentHtml = item.contentElement.innerHTML.trim();
      if (![state.originalHtml, state.translatedHtml].map((html) => html.trim()).includes(currentHtml) || state.key !== key) {
        renderedMessageTranslations.delete(item.contentElement);
        state = null;
      }
    }
    if (!state) {
      const sourceSnapshot = createSourceSnapshot(item.contentElement);
      if (!sourceSnapshot || sourceSnapshot.sourceHash !== record.sourceHash) continue;
      state = {
        key,
        originalHtml: sourceSnapshot.sourceHtml,
        translatedHtml: translation.translatedHtml,
        sourceSnapshot,
        showingTranslation: true
      };
      renderedMessageTranslations.set(item.contentElement, state);
      item.contentElement.innerHTML = state.translatedHtml;
      item.contentElement.dataset.tfsTranslationView = 'translated';
    } else if (state.translatedHtml !== translation.translatedHtml) {
      state.translatedHtml = translation.translatedHtml;
      if (state.showingTranslation) item.contentElement.innerHTML = state.translatedHtml;
    }
    ensureMessageToggle(item, state);
    applied++;
  }
  return applied;
}

async function showStoredTranslationForKey(rootNode, messageKey) {
  translationCacheConversation = '';
  await applyStoredTranslations(rootNode, { reload: true });
  for (const item of findMessageContainers(rootNode)) {
    const record = visibleRecord(item, rootNode);
    if (!record || translationIdentity(record) !== messageKey) continue;
    const state = renderedMessageTranslations.get(item.contentElement);
    if (!state) return false;
    state.showingTranslation = true;
    item.contentElement.innerHTML = state.translatedHtml;
    item.contentElement.dataset.tfsTranslationView = 'translated';
    ensureMessageToggle(item, state);
    return true;
  }
  return false;
}

function scheduleTranslationDisplay(rootNode = globalThis.document, delay = 80) {
  clearTimeout(translationApplyTimer);
  translationApplyTimer = setTimeout(() => {
    translationApplyTimer = null;
    applyStoredTranslations(rootNode).catch((error) => {
      if (!/Extension context invalidated/i.test(error?.message || '')) {
        console.error('[translate-for-slack] Không thể hiển thị bản dịch đã lưu:', error);
      }
    });
  }, delay);
}

function mutationNodeBelongsToExtension(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return Boolean(element?.matches?.(EXTENSION_UI_MUTATION_SELECTOR)
    || element?.closest?.(EXTENSION_UI_MUTATION_SELECTOR));
}

function mutationsOnlyTouchExtensionUi(records = []) {
  return records.length > 0 && records.every((record) => {
    if (mutationNodeBelongsToExtension(record.target)) return true;
    if (record.type !== 'childList') return false;
    const changedNodes = [...record.addedNodes, ...record.removedNodes];
    return changedNodes.length > 0 && changedNodes.every(mutationNodeBelongsToExtension);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (response) => {
      if (settled) return;
      settled = true;
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    };
    try {
      const pending = chrome.runtime.sendMessage(message, done);
      if (pending?.then) pending.then(done, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function controlsStorageCall(method, value) {
  if (!globalThis.chrome?.storage?.local?.[method]) {
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

export function collectVisibleOriginalMessages(messageItems, rootNode = globalThis.document) {
  const records = new Map();
  for (const item of messageItems || []) {
    const context = getSlackConversationContext(rootNode, item.containerElement);
    const snapshot = sourceSnapshotForItem(item);
    const metadata = snapshot ? getMessageMetadata(item.containerElement, snapshot) : null;
    if (!context || !metadata) continue;
    const record = { ...context, ...metadata };
    records.set(recordIdentity(record), record);
  }
  return Array.from(records.values());
}

export async function persistVisibleOriginalMessages(messageItems, rootNode = globalThis.document, preparedRecords = null) {
  if (currentConfig.storeOriginalMessages === false) return null;
  const records = preparedRecords || collectVisibleOriginalMessages(messageItems, rootNode);
  if (!records.length) return { inserted: 0, updated: 0, unchanged: 0, conversationChanges: [] };
  try {
    return await upsertOriginalMessages(records, currentConfig);
  } catch (error) {
    if (!/Extension context invalidated/i.test(error?.message || '')) {
      console.error('[translate-for-slack] Không thể lưu tin nhắn gốc:', error);
    }
    return null;
  }
}

export async function storeVisibleMessages(rootNode = globalThis.document) {
  const items = findMessageContainers(rootNode);
  return persistVisibleOriginalMessages(items, rootNode);
}

function scheduleVisibleStorage(rootNode = globalThis.document, delay = 180) {
  if (currentConfig.storeOriginalMessages === false) return;
  clearTimeout(storageTimer);
  storageTimer = setTimeout(() => {
    storageTimer = null;
    storeVisibleMessages(rootNode);
  }, delay);
}

function scrollCandidates(rootNode) {
  const candidates = new Set();
  for (const element of rootNode?.querySelectorAll?.(SCROLL_SELECTOR) || []) {
    const normalized = element.matches?.('.c-virtual_list__scroll_container')
      ? (element.closest?.('[data-qa="slack_kit_scrollbar"], .p-message_pane__scrollbar, .c-scrollbar__hider') || element)
      : element;
    if (normalized.querySelector?.(MESSAGE_CONTAINER_SELECTOR)) candidates.add(normalized);
  }
  return Array.from(candidates);
}

function selectBestScrollContainer(candidates) {
  return Array.from(candidates || []).sort((left, right) => {
    const leftScore = left.querySelectorAll(MESSAGE_CONTAINER_SELECTOR).length * 100000
      + Math.max(0, left.scrollHeight - left.clientHeight);
    const rightScore = right.querySelectorAll(MESSAGE_CONTAINER_SELECTOR).length * 100000
      + Math.max(0, right.scrollHeight - right.clientHeight);
    return rightScore - leftScore;
  })[0] || null;
}

export function findMainMessageScrollContainer(rootNode = globalThis.document) {
  return selectBestScrollContainer(
    scrollCandidates(rootNode).filter((candidate) => !candidate.closest?.(THREAD_PANE_SELECTOR))
  );
}

export function findThreadMessageScrollContainer(threadPane) {
  if (!threadPane?.matches?.(THREAD_PANE_SELECTOR)) return null;
  return selectBestScrollContainer(
    scrollCandidates(threadPane).filter((candidate) => {
      return candidate.closest?.(THREAD_PANE_SELECTOR) === threadPane;
    })
  );
}

export function findMessageScrollContainer(rootNode = globalThis.document) {
  const candidates = scrollCandidates(rootNode);
  if (lastActiveScrollContainer?.isConnected && candidates.includes(lastActiveScrollContainer)) return lastActiveScrollContainer;
  return findMainMessageScrollContainer(rootNode) || selectBestScrollContainer(candidates);
}

function conversationIdentity(context) {
  return context
    ? `${context.workspaceId}:${context.conversationId}:${context.conversationScope}:${context.threadTs || ''}`
    : '';
}

function resolveScrollConversation(rootNode, scrollContainer) {
  const contexts = findMessageContainers(scrollContainer)
    .map((item) => getSlackConversationContext(rootNode, item.containerElement))
    .filter(Boolean);
  if (scrollContainer.closest?.(THREAD_PANE_SELECTOR)) {
    return contexts.find((context) => context.conversationScope === 'thread') || null;
  }
  return contexts.find((context) => context.conversationScope === 'main') || contexts[0] || null;
}

function itemsForConversation(rootNode, scrollContainer, identity) {
  return findMessageContainers(scrollContainer).filter((item) => {
    return conversationIdentity(getSlackConversationContext(rootNode, item.containerElement)) === identity;
  });
}

function setScrollTop(scrollContainer, value) {
  scrollContainer.scrollTop = Math.max(0, Number(value) || 0);
  const EventClass = scrollContainer.ownerDocument?.defaultView?.Event;
  if (EventClass) scrollContainer.dispatchEvent(new EventClass('scroll'));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));

export async function loadAndStoreAllMessages(rootNode = globalThis.document, options = {}) {
  if (currentConfig.storeOriginalMessages === false) {
    return { success: false, error: 'Hãy bật lưu tin nhắn trước.', visited: 0, stored: 0, steps: 0 };
  }
  const scrollContainer = options.scrollContainer || findMessageScrollContainer(rootNode);
  if (!scrollContainer) {
    return { success: false, error: 'Không tìm thấy vùng tin nhắn Slack.', visited: 0, stored: 0, steps: 0 };
  }
  const context = resolveScrollConversation(rootNode, scrollContainer);
  const identity = conversationIdentity(context);
  if (!identity) {
    return { success: false, error: 'Không xác định được channel, DM hoặc thread.', visited: 0, stored: 0, steps: 0 };
  }

  const cancelToken = options.cancelToken || { cancelled: false };
  const maxStepsPerDirection = Number.isFinite(options.maxStepsPerDirection)
    ? Math.max(1, options.maxStepsPerDirection)
    : (Number.isFinite(options.maxSteps) ? Math.max(1, options.maxSteps) : 500);
  const maxNoProgress = Number.isFinite(options.maxNoProgress) ? Math.max(1, options.maxNoProgress) : 3;
  const settleDelay = Number.isFinite(options.settleDelayMs) ? Math.max(0, options.settleDelayMs) : 350;
  const boundarySettleDelay = Number.isFinite(options.boundarySettleDelayMs)
    ? Math.max(0, options.boundarySettleDelayMs)
    : 700;
  const originalTop = Number(scrollContainer.scrollTop) || 0;
  const originalHeight = Number(scrollContainer.scrollHeight) || 0;
  const originalClientHeight = Number(scrollContainer.clientHeight) || 0;
  const distanceFromBottom = Math.max(0, originalHeight - originalClientHeight - originalTop);
  const visited = new Set();
  const hashes = new Map();
  let stored = 0;
  let steps = 0;
  let upwardSteps = 0;
  let downwardSteps = 0;
  let noProgress = 0;
  let reachedStart = false;
  let reachedEnd = false;
  let phase = 'up';

  async function collect() {
    const items = itemsForConversation(rootNode, scrollContainer, identity);
    const records = collectVisibleOriginalMessages(items, rootNode);
    const changed = records.filter((record) => {
      visited.add(record.messageId);
      const key = recordIdentity(record);
      if (hashes.get(key) === record.sourceHash) return false;
      hashes.set(key, record.sourceHash);
      return true;
    });
    if (changed.length) {
      const result = await persistVisibleOriginalMessages([], rootNode, changed);
      stored += (result?.inserted || 0) + (result?.updated || 0);
    }
    options.onProgress?.({
      phase,
      visited: visited.size,
      stored,
      steps,
      upwardSteps,
      downwardSteps,
      reachedStart,
      reachedEnd
    });
    return records.map((record) => `${record.messageId}:${record.sourceHash}`).join('|');
  }

  try {
    let previousSignature = await collect();
    while (!cancelToken.cancelled && upwardSteps < maxStepsPerDirection) {
      const previousHeight = Number(scrollContainer.scrollHeight) || 0;
      const previousTop = Number(scrollContainer.scrollTop) || 0;
      const previousVisitedCount = visited.size;
      setScrollTop(scrollContainer, Math.max(0, previousTop - Math.max(scrollContainer.clientHeight * 0.8, 400)));
      await wait(previousTop <= 4 ? boundarySettleDelay : settleDelay);
      steps++;
      upwardSteps++;
      const signature = await collect();
      const currentHeight = Number(scrollContainer.scrollHeight) || 0;
      const currentTop = Number(scrollContainer.scrollTop) || 0;
      const progressed = signature !== previousSignature
        || currentHeight !== previousHeight
        || visited.size > previousVisitedCount;
      noProgress = currentTop <= 4
        ? (progressed ? 0 : noProgress + 1)
        : 0;
      previousSignature = signature;
      if (currentTop <= 4 && noProgress >= maxNoProgress) {
        reachedStart = true;
        break;
      }
    }

    if (!cancelToken.cancelled) {
      phase = 'down';
      noProgress = 0;
      previousSignature = await collect();
      while (!cancelToken.cancelled && downwardSteps < maxStepsPerDirection) {
        const previousHeight = Number(scrollContainer.scrollHeight) || 0;
        const previousTop = Number(scrollContainer.scrollTop) || 0;
        const previousVisitedCount = visited.size;
        const viewportStep = Math.max(scrollContainer.clientHeight * 0.8, 400);
        const maximumTop = Math.max(0, previousHeight - (Number(scrollContainer.clientHeight) || 0));
        setScrollTop(scrollContainer, Math.min(maximumTop, previousTop + viewportStep));
        await wait(previousTop >= maximumTop - 4 ? boundarySettleDelay : settleDelay);
        steps++;
        downwardSteps++;
        const signature = await collect();
        const currentHeight = Number(scrollContainer.scrollHeight) || 0;
        const currentTop = Number(scrollContainer.scrollTop) || 0;
        const currentMaximumTop = Math.max(0, currentHeight - (Number(scrollContainer.clientHeight) || 0));
        const progressed = signature !== previousSignature
          || currentHeight !== previousHeight
          || visited.size > previousVisitedCount;
        noProgress = currentTop >= currentMaximumTop - 4
          ? (progressed ? 0 : noProgress + 1)
          : 0;
        previousSignature = signature;
        if (currentTop >= currentMaximumTop - 4 && noProgress >= maxNoProgress) {
          reachedEnd = true;
          break;
        }
      }
    }
  } finally {
    phase = 'restore';
    options.onProgress?.({
      phase,
      visited: visited.size,
      stored,
      steps,
      upwardSteps,
      downwardSteps,
      reachedStart,
      reachedEnd
    });
    const finalMaximumTop = Math.max(0, (Number(scrollContainer.scrollHeight) || 0) - (Number(scrollContainer.clientHeight) || originalClientHeight));
    setScrollTop(scrollContainer, Math.max(0, finalMaximumTop - distanceFromBottom));
    await wait(Number.isFinite(options.restoreDelayMs) ? options.restoreDelayMs : 120);
    await collect();
  }

  const incomplete = !cancelToken.cancelled && (!reachedStart || !reachedEnd);
  return {
    success: !cancelToken.cancelled && !incomplete,
    ...(incomplete ? { error: 'Chưa quét được toàn bộ từ đầu đến cuối hội thoại.' } : {}),
    cancelled: cancelToken.cancelled,
    visited: visited.size,
    stored,
    steps,
    upwardSteps,
    downwardSteps,
    reachedStart,
    reachedEnd,
    incomplete
  };
}

// Kept as a compatibility alias for callers from earlier collector builds.
export const loadAndStoreOlderMessages = loadAndStoreAllMessages;

function updateHistoryControl(control, state, label) {
  control.dataset.state = state;
  const button = control.querySelector('button');
  const text = control.querySelector('.tfs-history-label');
  if (text) text.textContent = label;
  if (button) button.setAttribute('aria-busy', state === 'running' ? 'true' : 'false');
}

function createHistoryControl(documentNode, options) {
  const control = documentNode.createElement('div');
  control.id = options.id;
  control.className = `tfs-history-control ${options.className || ''}`.trim();
  control.dataset.state = 'idle';
  control.dataset.scope = options.scope;
  const button = documentNode.createElement('button');
  button.type = 'button';
  button.className = 'tfs-history-button';
  button.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-busy', 'false');
  button.title = options.title;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m0 0-5 5m5-5 5 5M5 21h14"/></svg><span class="tfs-history-label">${options.label}</span>`;
  control.appendChild(button);
  documentNode.body.appendChild(control);

  button.addEventListener('click', async () => {
    if (activeHistorySession) {
      activeHistorySession.cancelToken.cancelled = true;
      updateHistoryControl(activeHistorySession.control, 'running', 'Đang dừng…');
      return;
    }
    const oldResetTimer = historyControlResetTimers.get(control);
    if (oldResetTimer) clearTimeout(oldResetTimer);
    const scrollContainer = options.resolveScrollContainer();
    if (!scrollContainer) {
      updateHistoryControl(control, 'error', options.missingTargetMessage);
      const timer = setTimeout(() => updateHistoryControl(control, 'idle', options.label), 5000);
      historyControlResetTimers.set(control, timer);
      return;
    }
    const session = {
      cancelToken: { cancelled: false },
      control,
      threadPane: options.threadPane || null
    };
    activeHistorySession = session;
    updateHistoryControl(control, 'running', 'Đang tải và lưu…');
    try {
      const result = await loadAndStoreAllMessages(documentNode, {
        scrollContainer,
        cancelToken: session.cancelToken,
        onProgress: (progress) => {
          const phaseLabel = progress.phase === 'down'
            ? 'Đang quét xuống cuối'
            : progress.phase === 'restore'
              ? 'Đang trở về vị trí cũ'
              : 'Đang quét lên đầu';
          updateHistoryControl(
            control,
            'running',
            `${phaseLabel}… ${progress.visited} tin nhắn`
          );
        }
      });
      if (result.cancelled) updateHistoryControl(control, 'idle', `Đã dừng • đã thấy ${result.visited} tin nhắn`);
      else if (!result.success) updateHistoryControl(control, 'error', result.error || 'Không thể lưu lịch sử');
      else updateHistoryControl(control, 'success', `Đã lưu • đã thấy ${result.visited} tin nhắn`);
    } catch (error) {
      updateHistoryControl(control, 'error', error?.message || 'Không thể lưu lịch sử');
    } finally {
      if (activeHistorySession === session) activeHistorySession = null;
      const timer = setTimeout(() => {
        if (control.isConnected) updateHistoryControl(control, 'idle', options.label);
      }, 5000);
      historyControlResetTimers.set(control, timer);
    }
  });
  return control;
}

function applyControlsCollapsed(documentNode, collapsed) {
  if (!documentNode?.body) return;
  documentNode.body.dataset.tfsControlsCollapsed = collapsed ? 'true' : 'false';
  const button = controlsToggle?.querySelector('button');
  const path = button?.querySelector('path');
  const label = collapsed ? 'Mở rộng các nút extension' : 'Thu gọn các nút extension';
  if (button) {
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  if (path) path.setAttribute('d', collapsed ? 'm7 15 5-5 5 5' : 'm7 9 5 5 5-5');
}

export async function ensureControlsToggle(rootNode = globalThis.document) {
  const documentNode = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
  if (!documentNode?.body) return null;
  const existing = documentNode.getElementById('tfs-controls-toggle');
  if (existing) {
    controlsToggle = existing;
    return existing;
  }

  let collapsed = false;
  try {
    const stored = await controlsStorageCall('get', CONTROLS_COLLAPSED_STORAGE_KEY);
    collapsed = stored[CONTROLS_COLLAPSED_STORAGE_KEY] === true;
  } catch (error) {
    console.warn('[translate-for-slack] Không thể đọc trạng thái thu gọn:', error);
  }

  const control = documentNode.createElement('div');
  control.id = 'tfs-controls-toggle';
  control.className = 'tfs-history-control tfs-controls-toggle';
  const button = documentNode.createElement('button');
  button.type = 'button';
  button.className = 'tfs-history-button tfs-controls-toggle-button';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg>';
  control.appendChild(button);
  documentNode.body.appendChild(control);
  controlsToggle = control;
  applyControlsCollapsed(documentNode, collapsed);

  button.addEventListener('click', async () => {
    const nextCollapsed = documentNode.body.dataset.tfsControlsCollapsed !== 'true';
    applyControlsCollapsed(documentNode, nextCollapsed);
    try {
      await controlsStorageCall('set', { [CONTROLS_COLLAPSED_STORAGE_KEY]: nextCollapsed });
    } catch (error) {
      console.warn('[translate-for-slack] Không thể lưu trạng thái thu gọn:', error);
    }
  });
  return control;
}

export function ensureHistoryControl(rootNode = globalThis.document) {
  const documentNode = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
  if (!documentNode?.body) return null;
  const existing = documentNode.getElementById('tfs-message-history-control');
  if (existing) return existing;
  documentNode.getElementById('slack-translate-history-control')?.remove();
  return createHistoryControl(documentNode, {
    id: 'tfs-message-history-control',
    className: 'tfs-main-history-control',
    scope: 'main',
    label: 'Tải và lưu toàn bộ tin nhắn',
    title: 'Tải và lưu toàn bộ tin nhắn của channel hoặc DM',
    missingTargetMessage: 'Không tìm thấy vùng channel hoặc DM',
    resolveScrollContainer: () => findMainMessageScrollContainer(documentNode)
  });
}

export function ensureThreadHistoryControls(rootNode = globalThis.document) {
  const documentNode = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
  if (!documentNode?.body) return [];

  for (const [threadPane, control] of threadHistoryControls) {
    if (threadPane.isConnected && documentNode.contains(threadPane)) continue;
    if (activeHistorySession?.threadPane === threadPane) {
      activeHistorySession.cancelToken.cancelled = true;
    }
    const timer = historyControlResetTimers.get(control);
    if (timer) clearTimeout(timer);
    control.remove();
    threadHistoryControls.delete(threadPane);
  }

  const panes = Array.from(documentNode.querySelectorAll(THREAD_PANE_SELECTOR));
  for (const threadPane of panes) {
    if (threadHistoryControls.has(threadPane)) continue;
    threadHistoryControlSequence++;
    const control = createHistoryControl(documentNode, {
      id: `tfs-thread-history-control-${threadHistoryControlSequence}`,
      className: 'tfs-thread-history-control',
      scope: 'thread',
      label: 'Tải và lưu toàn bộ thread',
      title: 'Tải và lưu toàn bộ tin nhắn trong thread đang mở',
      missingTargetMessage: 'Không tìm thấy vùng tin nhắn của thread',
      threadPane,
      resolveScrollContainer: () => findThreadMessageScrollContainer(threadPane)
    });
    threadHistoryControls.set(threadPane, control);
  }
  return Array.from(threadHistoryControls.values()).filter((control) => control.isConnected);
}

function updateTranslationControl(control, state, label) {
  if (!control) return;
  control.dataset.state = state;
  const button = control.querySelector('button');
  const text = control.querySelector('.tfs-translation-label');
  if (text) text.textContent = label;
  if (button) {
    button.disabled = state === 'running';
    button.setAttribute('aria-busy', state === 'running' ? 'true' : 'false');
  }
}

function setTranslationControlsDisabled(disabled) {
  for (const control of [translationControl, newTranslationControl]) {
    const button = control?.querySelector('button');
    if (button) button.disabled = disabled;
  }
}

export function buildTranslationBatches(messages = [], options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize) || TRANSLATION_BATCH_SIZE);
  const eligibleKeys = options.eligibleKeys instanceof Set ? options.eligibleKeys : null;
  const batches = [];
  let adjacentEligibleMessages = [];

  const flush = () => {
    for (let index = 0; index < adjacentEligibleMessages.length; index += batchSize) {
      batches.push(adjacentEligibleMessages.slice(index, index + batchSize));
    }
    adjacentEligibleMessages = [];
  };

  for (const message of messages) {
    if (!eligibleKeys || eligibleKeys.has(translationIdentity(message))) {
      adjacentEligibleMessages.push(message);
    } else {
      flush();
    }
  }
  flush();
  return batches;
}

export function selectMessageTranslationWindow(messages = [], eligibleKeys = new Set(), targetMessageKey = '') {
  const targetMessage = messages.find((message) => translationIdentity(message) === targetMessageKey);
  if (!targetMessage || !eligibleKeys.has(targetMessageKey)) return [];
  const targetScope = targetMessage.conversationScope === 'thread' ? 'thread' : 'main';
  const targetThreadTs = targetScope === 'thread' ? String(targetMessage.threadTs || '') : '';
  const scopedMessages = messages.filter((message) => {
    const scope = message.conversationScope === 'thread' ? 'thread' : 'main';
    return scope === targetScope && (scope !== 'thread' || String(message.threadTs || '') === targetThreadTs);
  });
  const targetIndex = scopedMessages.findIndex((message) => translationIdentity(message) === targetMessageKey);
  if (targetIndex < 0 || !eligibleKeys.has(targetMessageKey)) return [];
  const startIndex = targetIndex <= 1 ? 0 : targetIndex - 2;
  const endIndex = targetIndex <= 1
    ? Math.min(scopedMessages.length, TRANSLATION_BATCH_SIZE)
    : targetIndex + 1;
  return scopedMessages
    .slice(startIndex, endIndex)
    .filter((message) => eligibleKeys.has(translationIdentity(message)));
}

export async function translateStoredConversation(rootNode = globalThis.document, options = {}) {
  const context = getSlackConversationContext(rootNode);
  if (!context) throw new Error('Không xác định được channel hoặc DM hiện tại.');
  const config = { ...currentConfig, ...(options.config || {}) };
  if (!String(config.geminiModel || '').trim()) throw new Error('Hãy chọn model Gemini trong popup.');
  if (!String(config.targetLanguageName || '').trim() || !String(config.targetLanguageCode || '').trim()) {
    throw new Error('Hãy nhập tên và mã ngôn ngữ đích trong popup.');
  }

  await storeVisibleMessages(rootNode);
  const messages = await getStoredConversationBundle(context);
  if (messages.length === 0) throw new Error('Chưa có tin nhắn đã lưu trong channel hoặc DM này.');
  const targetMessageKey = String(options.targetMessageKey || '').trim();
  let eligibleKeys = null;
  let messageBatches = [];
  if (options.onlyUntranslated || targetMessageKey) {
    const storedTranslations = await getStoredTranslationsForConversation(context);
    const translationsByKey = new Map(storedTranslations.map((translation) => [
      translationIdentity(translation),
      translation
    ]));
    eligibleKeys = new Set(messages
      .filter((message) => !translationMatchesConfig(
        translationsByKey.get(translationIdentity(message)),
        message,
        config
      ))
      .map((message) => translationIdentity(message)));
  }

  if (targetMessageKey) {
    const targetMessage = messages.find((message) => translationIdentity(message) === targetMessageKey);
    if (!targetMessage) throw new Error('Không tìm thấy tin nhắn được chọn trong bộ nhớ.');
    if (!eligibleKeys.has(targetMessageKey)) {
      const displayed = await showStoredTranslationForKey(rootNode, targetMessageKey);
      return {
        translated: 0,
        existing: true,
        failed: 0,
        total: 0,
        applied: displayed ? 1 : 0,
        failedBatches: [],
        channelContextUsed: false,
        channelContextCached: false,
        channelContextWarning: '',
        skipped: messages.length
      };
    }
    const selectedMessages = selectMessageTranslationWindow(messages, eligibleKeys, targetMessageKey);
    if (selectedMessages.length > 0) messageBatches.push(selectedMessages);
  } else {
    messageBatches = buildTranslationBatches(messages, { eligibleKeys });
  }
  const messagesToTranslate = messageBatches.flat();
  if (messagesToTranslate.length === 0) {
    return {
      translated: 0,
      failed: 0,
      total: 0,
      applied: 0,
      failedBatches: [],
      channelContextUsed: false,
      channelContextCached: false,
      channelContextWarning: '',
      skipped: messages.length
    };
  }
  if (!config.geminiApiKeys?.length && !String(config.geminiApiKey || '').trim()) {
    throw new Error('Hãy thêm khóa API Gemini trong popup.');
  }
  const documentNode = rootNode?.nodeType === 9 ? rootNode : (rootNode?.ownerDocument || globalThis.document);
  const configuredRetryDelay = Number(options.retryBaseDelayMs);
  const retryBaseDelayMs = Number.isFinite(configuredRetryDelay) && configuredRetryDelay >= 0
    ? configuredRetryDelay
    : TRANSLATION_RETRY_BASE_DELAY_MS;
  let channelContext = null;
  let channelContextCached = false;
  let channelContextWarning = '';

  if (options.channelContext) {
    channelContext = normalizeChannelContext(options.channelContext);
  } else {
    const sourceFingerprint = await channelContextSourceFingerprint(messages);
    const cacheIdentity = {
      workspaceId: context.workspaceId,
      conversationId: context.conversationId,
      model: config.geminiModel,
      targetLanguageName: config.targetLanguageName,
      targetLanguageCode: config.targetLanguageCode,
      sourceFingerprint
    };
    try {
      options.onContextStatus?.({ phase: 'cache' });
      const cached = await getCachedChannelContext(cacheIdentity);
      if (cached) {
        channelContext = normalizeChannelContext(cached.context);
        channelContextCached = true;
        options.onContextStatus?.({ phase: 'ready', cached: true });
      }
    } catch (error) {
      channelContextWarning = `Không thể đọc cache context chung: ${error?.message || 'lỗi không xác định'}`;
    }

    if (!channelContext) {
      try {
        options.onContextStatus?.({ phase: 'generating', cached: false });
        channelContext = await generateChannelContext(messages, {
          targetLanguageName: config.targetLanguageName,
          targetLanguageCode: config.targetLanguageCode,
          maximumSourceChars: options.contextMaximumSourceChars,
          retryBaseDelayMs: options.contextRetryBaseDelayMs ?? retryBaseDelayMs,
          request: async (prompt) => {
            const response = await sendRuntimeMessage({ type: 'tfs:translate-all-with-gemini', prompt });
            if (!response?.success) throw new Error(response?.error || 'Không thể tạo context chung bằng Gemini.');
            return response.text;
          },
          onRequest: (status) => options.onContextRequest?.(status),
          onRetry: (status) => options.onContextRetry?.(status)
        });
        channelContextWarning = '';
        try {
          await saveCachedChannelContext({ ...cacheIdentity, context: channelContext });
        } catch (error) {
          channelContextWarning = `Đã tạo context nhưng không thể lưu cache: ${error?.message || 'lỗi không xác định'}`;
        }
        options.onContextStatus?.({ phase: 'ready', cached: false });
      } catch (error) {
        channelContext = null;
        channelContextWarning = `Không thể tạo context chung sau 5 lần thử: ${error?.message || 'lỗi không xác định'}`;
        options.onContextStatus?.({ phase: 'failed', error: channelContextWarning });
      }
    }
  }
  let nextBatchIndex = 0;
  let completedBatches = 0;
  const successfulTranslations = [];
  const failedBatches = [];
  const persistenceTasks = [];
  const displayErrors = [];
  let displayQueue = Promise.resolve();
  let displayedBatches = 0;
  let applied = 0;

  const translateBatch = async (batchMessages, batchIndex, attempt) => {
    const batchItems = batchMessages.map((message) => ({
      key: translationIdentity(message),
      scope: message.conversationScope,
      threadTs: message.threadTs || '',
      html: translationSourceHtml(message)
    }));
    const prompt = buildTranslationPrompt(wrapBatchHtml(batchItems, documentNode), {
      targetLanguageName: config.targetLanguageName,
      targetLanguageCode: config.targetLanguageCode,
      channelContext,
      contextItems: options.contextItems || []
    });
    options.onRequest?.({
      batchIndex,
      batchCount: messageBatches.length,
      messageCount: batchMessages.length,
      totalMessageCount: messagesToTranslate.length,
      completedBatches,
      attempt,
      maxAttempts: TRANSLATION_MAX_ATTEMPTS,
      promptLength: prompt.length
    });

    const response = await sendRuntimeMessage({ type: 'tfs:translate-all-with-gemini', prompt });
    if (!response?.success) throw new Error(response?.error || 'Không thể dịch bằng Gemini.');
    const validated = parseAndValidateBatchHtml(response.text, batchItems, documentNode);
    if (!validated.success) throw new Error(validated.error);

    return batchMessages.map((message, index) => ({
      ...message,
      translatedHtml: restoreOriginalSlackHtml(
        translationSourceHtml(message),
        validated.items[index],
        documentNode
      ),
      provider: 'gemini',
      model: config.geminiModel,
      targetLanguageName: config.targetLanguageName,
      targetLanguageCode: config.targetLanguageCode,
      updatedAt: Date.now()
    }));
  };

  const worker = async () => {
    while (nextBatchIndex < messageBatches.length) {
      const batchIndex = nextBatchIndex++;
      const batchMessages = messageBatches[batchIndex];
      let translations = null;
      let lastError = null;
      let attempts = 0;
      for (let attempt = 1; attempt <= TRANSLATION_MAX_ATTEMPTS; attempt++) {
        attempts = attempt;
        try {
          translations = await translateBatch(batchMessages, batchIndex, attempt);
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= TRANSLATION_MAX_ATTEMPTS) break;
          const delayMs = retryBaseDelayMs * (2 ** (attempt - 1));
          options.onRetry?.({
            batchIndex,
            batchCount: messageBatches.length,
            messageCount: batchMessages.length,
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts: TRANSLATION_MAX_ATTEMPTS,
            delayMs,
            error: error?.message || 'Không thể dịch bằng Gemini.'
          });
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (translations) {
        successfulTranslations.push(...translations);
        // Queue persistence without delaying this worker from starting its next request.
        const persistenceTask = upsertTranslations(translations);
        persistenceTask.catch(() => {});
        persistenceTasks.push(persistenceTask);
        const displayTask = displayQueue.then(async () => {
          await persistenceTask;
          translationCacheConversation = '';
          applied = await applyStoredTranslations(rootNode, { reload: true });
          displayedBatches++;
          options.onBatchDisplayed?.({
            batchIndex,
            batchCount: messageBatches.length,
            messageCount: translations.length,
            displayedBatches,
            applied,
            totalMessageCount: messagesToTranslate.length
          });
        });
        displayQueue = displayTask.catch((error) => {
          displayErrors.push(error);
        });
      } else {
        failedBatches.push({
          batchIndex,
          messageCount: batchMessages.length,
          attempts,
          error: lastError?.message || 'Không thể dịch bằng Gemini.'
        });
      }
      completedBatches++;
      options.onProgress?.({
        completedBatches,
        batchCount: messageBatches.length,
        translated: successfulTranslations.length,
        failed: failedBatches.reduce((total, batch) => total + batch.messageCount, 0),
        totalMessageCount: messagesToTranslate.length
      });
    }
  };

  const workerCount = Math.min(TRANSLATION_CONCURRENCY, messageBatches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await Promise.all(persistenceTasks);
  await displayQueue;
  if (displayErrors.length > 0) throw displayErrors[0];
  if (successfulTranslations.length === 0 && failedBatches.length > 0) {
    throw new Error(failedBatches[0].error);
  }

  return {
    translated: successfulTranslations.length,
    failed: failedBatches.reduce((total, batch) => total + batch.messageCount, 0),
    total: messagesToTranslate.length,
    skipped: messages.length - messagesToTranslate.length,
    applied,
    failedBatches,
    channelContextUsed: Boolean(channelContext),
    channelContextCached,
    channelContextWarning
  };
}

function setMessageTranslationButtonsDisabled(rootNode, disabled) {
  rootNode.querySelectorAll?.('.tfs-message-translation-toggle').forEach((button) => {
    button.disabled = disabled;
  });
}

function syncMessageTranslationButton(button, item) {
  if (!button?.isConnected) return;
  const state = renderedMessageTranslations.get(item.contentElement);
  const label = state?.showingTranslation ? 'Bản gốc' : 'Dịch';
  const title = state?.showingTranslation ? 'Hiện nội dung gốc' : 'Dịch tin nhắn này';
  if (button.dataset.state !== 'idle') button.dataset.state = 'idle';
  if (button.textContent !== label) button.textContent = label;
  if (button.title !== title) button.title = title;
}

function bindMessageTranslationButton(button, initialItem, rootNode, initialMessageKey) {
  if (button.dataset.tfsTranslationBound === 'true') return;
  button.dataset.tfsTranslationBound = 'true';
  button.addEventListener('click', async () => {
    const item = findMessageContainers(rootNode)
      .find((candidate) => candidate.containerElement === button.parentElement || candidate.containerElement.contains(button))
      || initialItem;
    const record = visibleRecord(item, rootNode);
    const messageKey = record ? translationIdentity(record) : initialMessageKey;
    if (button.dataset.tfsMessageKey !== messageKey) return;
    const renderedState = renderedMessageTranslations.get(item.contentElement);
    if (renderedState?.showingTranslation) {
      renderedState.showingTranslation = false;
      item.contentElement.innerHTML = renderedState.originalHtml;
      item.contentElement.dataset.tfsTranslationView = 'original';
      syncMessageTranslationButton(button, item);
      return;
    }
    if (renderedState) {
      renderedState.showingTranslation = true;
      item.contentElement.innerHTML = renderedState.translatedHtml;
      item.contentElement.dataset.tfsTranslationView = 'translated';
      syncMessageTranslationButton(button, item);
      return;
    }
    if (translationRunning) return;
    const previousTimer = messageTranslationButtonResetTimers.get(button);
    if (previousTimer) clearTimeout(previousTimer);
    translationRunning = true;
    button.dataset.state = 'running';
    button.textContent = 'Đang dịch…';
    button.title = 'Đang dịch tin nhắn';
    setTranslationControlsDisabled(true);
    setMessageTranslationButtonsDisabled(rootNode, true);
    try {
      await translateStoredConversation(rootNode, {
        targetMessageKey: messageKey,
        onContextStatus: ({ phase }) => {
          if (phase === 'cache') button.textContent = 'Đang kiểm tra context…';
          if (phase === 'generating') button.textContent = 'Đang cập nhật context…';
        },
        onRetry: ({ nextAttempt, maxAttempts }) => {
          button.textContent = `Thử lại ${nextAttempt}/${maxAttempts}…`;
        }
      });
      syncMessageTranslationButton(button, item);
    } catch (error) {
      button.dataset.state = 'error';
      button.textContent = 'Dịch lỗi';
      button.title = error?.message || 'Không thể dịch tin nhắn';
      const timer = setTimeout(() => syncMessageTranslationButton(button, item), 5000);
      timer.unref?.();
      messageTranslationButtonResetTimers.set(button, timer);
    } finally {
      translationRunning = false;
      setTranslationControlsDisabled(false);
      setMessageTranslationButtonsDisabled(rootNode, false);
    }
  });
}

export function ensureMessageTranslationButtons(rootNode = globalThis.document) {
  const buttons = [];
  for (const item of findMessageContainers(rootNode)) {
    const record = visibleRecord(item, rootNode);
    if (!record) continue;
    const messageKey = translationIdentity(record);
    item.containerElement.querySelectorAll?.('.tfs-message-translate-button').forEach((element) => element.remove());
    let button = item.containerElement.querySelector?.('.tfs-message-translation-toggle');
    if (button && button.dataset.tfsMessageKey !== messageKey) {
      const timer = messageTranslationButtonResetTimers.get(button);
      if (timer) clearTimeout(timer);
      button.remove();
      button = null;
    }
    if (!button) {
      button = item.containerElement.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'tfs-message-translation-toggle';
      button.dataset.tfsMessageKey = messageKey;
    }
    placeMessageTranslationButton(item, button);
    bindMessageTranslationButton(button, item, rootNode, messageKey);
    if (!['running', 'error'].includes(button.dataset.state)) syncMessageTranslationButton(button, item);
    buttons.push(button);
  }
  return buttons;
}

function scheduleMessageTranslationButtons(rootNode = globalThis.document, delay = 80) {
  clearTimeout(messageButtonTimer);
  messageButtonTimer = setTimeout(() => {
    messageButtonTimer = null;
    ensureMessageTranslationButtons(rootNode);
  }, Math.max(0, delay));
}

function bindTranslationControl(control, documentNode, options = {}) {
  const button = control.querySelector('button');
  const idleLabel = options.idleLabel || 'Dịch toàn bộ đã lưu';
  button.addEventListener('click', async () => {
    if (translationRunning) return;
    translationRunning = true;
    updateTranslationControl(control, 'running', 'Đang chuẩn bị tin nhắn…');
    setTranslationControlsDisabled(true);
    setMessageTranslationButtonsDisabled(documentNode, true);
    try {
      const result = await translateStoredConversation(documentNode, {
        onlyUntranslated: options.onlyUntranslated === true,
        onContextStatus: ({ phase, cached }) => {
          if (phase === 'cache') updateTranslationControl(control, 'running', 'Đang kiểm tra context chung…');
          if (phase === 'generating') updateTranslationControl(control, 'running', 'Đang cập nhật context chung…');
          if (phase === 'ready') {
            updateTranslationControl(
              control,
              'running',
              cached ? 'Đã dùng context chung trong cache…' : 'Đã cập nhật context chung…'
            );
          }
        },
        onContextRetry: ({ nextAttempt, maxAttempts }) => {
          updateTranslationControl(control, 'running', `Context lỗi, thử lại ${nextAttempt}/${maxAttempts}…`);
        },
        onRequest: ({ batchCount, totalMessageCount }) => {
          updateTranslationControl(control, 'running', `Gemini đang dịch ${totalMessageCount} tin nhắn trong ${batchCount} lô…`);
        },
        onProgress: ({ completedBatches, batchCount }) => {
          updateTranslationControl(control, 'running', `Đã xử lý ${completedBatches}/${batchCount} lô…`);
        },
        onRetry: ({ batchIndex, nextAttempt, maxAttempts }) => {
          updateTranslationControl(control, 'running', `Lô ${batchIndex + 1} lỗi, thử lại ${nextAttempt}/${maxAttempts}…`);
        },
        onBatchDisplayed: ({ displayedBatches, batchCount }) => {
          updateTranslationControl(control, 'running', `Đã hiển thị ${displayedBatches}/${batchCount} lô…`);
        }
      });
      if (options.onlyUntranslated && result.total === 0) {
        updateTranslationControl(control, 'success', 'Không có tin nhắn mới cần dịch');
      } else if (result.failed > 0) {
        updateTranslationControl(control, 'error', `Đã dịch ${result.translated}/${result.total} tin nhắn; ${result.failedBatches.length} lô lỗi`);
      } else if (result.channelContextWarning) {
        updateTranslationControl(control, 'warning', `Đã dịch ${result.translated} tin nhắn; không dùng được context chung`);
      } else {
        updateTranslationControl(control, 'success', `Đã dịch ${result.translated} tin nhắn`);
      }
    } catch (error) {
      updateTranslationControl(control, 'error', error?.message || 'Không thể dịch tin nhắn');
    } finally {
      translationRunning = false;
      setTranslationControlsDisabled(false);
      setMessageTranslationButtonsDisabled(documentNode, false);
      setTimeout(() => {
        if (control.isConnected && control.dataset.state !== 'running') {
          updateTranslationControl(control, 'idle', idleLabel);
        }
      }, 8000);
    }
  });
}

function createTranslationControl(documentNode, options) {
  const control = documentNode.createElement('div');
  control.id = options.id;
  control.className = `tfs-history-control ${options.className}`;
  control.dataset.state = 'idle';
  const button = documentNode.createElement('button');
  button.type = 'button';
  button.className = 'tfs-history-button';
  button.title = options.title;
  button.setAttribute('aria-live', 'polite');
  button.setAttribute('aria-busy', 'false');
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${options.iconPath}"/></svg><span class="tfs-translation-label">${options.label}</span>`;
  control.appendChild(button);
  documentNode.body.appendChild(control);
  bindTranslationControl(control, documentNode, {
    idleLabel: options.label,
    onlyUntranslated: options.onlyUntranslated
  });
  return control;
}

export function ensureTranslationControl(rootNode = globalThis.document) {
  const documentNode = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
  if (!documentNode?.body) return null;
  const existing = documentNode.getElementById('tfs-translate-all-control');
  if (existing) {
    translationControl = existing;
    return existing;
  }
  translationControl = createTranslationControl(documentNode, {
    id: 'tfs-translate-all-control',
    className: 'tfs-translation-control',
    label: 'Dịch toàn bộ đã lưu',
    title: 'Dịch lại toàn bộ tin nhắn đã lưu theo lô 3 tin, tối đa 3 yêu cầu Gemini đồng thời',
    iconPath: 'M4 5h10M9 3v2m-3 4c1.5 3 3.5 5 6 6m1-6c-1.3 3-3.6 5.7-7 8m9-4h5m-2.5-2.5V16m-3 4 3-7 3 7'
  });
  return translationControl;
}

export function ensureNewTranslationControl(rootNode = globalThis.document) {
  const documentNode = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
  if (!documentNode?.body) return null;
  const existing = documentNode.getElementById('tfs-translate-new-control');
  if (existing) {
    newTranslationControl = existing;
    return existing;
  }
  newTranslationControl = createTranslationControl(documentNode, {
    id: 'tfs-translate-new-control',
    className: 'tfs-translate-new-control',
    label: 'Dịch tin nhắn mới',
    title: 'Chỉ dịch các tin nhắn chưa có bản dịch phù hợp, từ cũ đến mới',
    onlyUntranslated: true,
    iconPath: 'M12 5v14m-7-7h14'
  });
  return newTranslationControl;
}

function restoreAndRemoveOldTranslationUi(rootNode) {
  for (const content of rootNode.querySelectorAll?.('[data-translate-replaced="true"]') || []) {
    if (content.dataset.originalHtml) content.innerHTML = content.dataset.originalHtml;
    delete content.dataset.translateReplaced;
    delete content.dataset.translateActive;
    delete content.dataset.originalHtml;
  }
  rootNode.querySelectorAll?.([
    '.slack-translate-result-card',
    '[data-qa="slack_translate_card"]',
    '.slack-translate-action-btn',
    '[data-qa="translate_message_action"]',
    '#slack-translate-history-control'
  ].join(', ')).forEach((element) => element.remove());
  rootNode.querySelectorAll?.('[data-translate-injected]').forEach((element) => {
    delete element.dataset.translateInjected;
  });
}

export async function initMessageCollector(rootNode = globalThis.document) {
  if (!rootNode?.body) return;
  clearTimeout(messageButtonTimer);
  messageButtonTimer = null;
  restoreAndRemoveOldTranslationUi(rootNode);
  currentConfig = { ...currentConfig, ...(await getConfig()) };
  ensureHistoryControl(rootNode);
  ensureThreadHistoryControls(rootNode);
  ensureTranslationControl(rootNode);
  ensureNewTranslationControl(rootNode);
  await ensureControlsToggle(rootNode);
  await storeVisibleMessages(rootNode);
  ensureMessageTranslationButtons(rootNode);
  await applyStoredTranslations(rootNode, { reload: true });

  observer?.disconnect();
  observer = new MutationObserver((records) => {
    if (mutationsOnlyTouchExtensionUi(records)) return;
    ensureThreadHistoryControls(rootNode);
    scheduleMessageTranslationButtons(rootNode);
    scheduleVisibleStorage(rootNode);
    scheduleTranslationDisplay(rootNode);
  });
  observer.observe(rootNode.body, { childList: true, subtree: true, characterData: true });
  rootNode.addEventListener('scroll', (event) => {
    let candidate = event.target?.matches?.(SCROLL_SELECTOR)
      ? event.target
      : event.target?.closest?.(SCROLL_SELECTOR);
    if (candidate?.matches?.('.c-virtual_list__scroll_container')) {
      candidate = candidate.closest?.('[data-qa="slack_kit_scrollbar"], .p-message_pane__scrollbar, .c-scrollbar__hider') || candidate;
    }
    if (candidate?.querySelector?.(MESSAGE_CONTAINER_SELECTOR)) lastActiveScrollContainer = candidate;
    scheduleMessageTranslationButtons(rootNode, 100);
    scheduleVisibleStorage(rootNode, 220);
  }, true);

  subscribeConfigChange((config) => {
    const translationSettingsChanged = ['geminiModel', 'targetLanguageName', 'targetLanguageCode']
      .some((key) => currentConfig[key] !== config[key]);
    currentConfig = { ...currentConfig, ...config };
    if (translationSettingsChanged) {
      restoreRenderedTranslations(rootNode);
      translationCacheConversation = '';
    }
    scheduleVisibleStorage(rootNode, 0);
    scheduleTranslationDisplay(rootNode, 0);
  });
}

export function _setCurrentConfigForTesting(config = {}) {
  currentConfig = { ...currentConfig, ...config };
}

if (globalThis.chrome?.runtime?.id && globalThis.document?.body) {
  initMessageCollector(globalThis.document).catch((error) => {
    console.error('[translate-for-slack] Không thể khởi tạo bộ thu thập tin nhắn:', error);
  });
}
