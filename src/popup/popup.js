import { getConfig, resetConfig, setConfig } from '../common/storage.js';
import {
  clearMessageStore,
  getMessageStoreStats,
  normalizeMessageStoreLimits,
  pruneMessageStore
} from '../common/message_store.js';
import { clearTranslationStore } from '../common/translation_store.js';
import { clearChannelContextStore } from '../common/channel_context_store.js';
import {
  createLanguageChoices,
  filterLanguageChoices,
  resolveLanguageOption
} from './languages.js';

let feedbackTimer = null;

export async function initPopup(doc = document) {
  if (!doc) return;
  const enabled = doc.getElementById('storeOriginalMessages');
  const apiKey = doc.getElementById('geminiApiKey');
  const model = doc.getElementById('geminiModel');
  const languagePicker = doc.getElementById('targetLanguagePicker');
  const languageSearch = doc.getElementById('targetLanguageSearch');
  const languageOptions = doc.getElementById('targetLanguageOptions');
  const perConversation = doc.getElementById('messageStoreMaxPerConversation');
  const totalMegabytes = doc.getElementById('messageStoreMaxMegabytes');
  const usage = doc.getElementById('messageStorageUsage');
  const clearButton = doc.getElementById('clearMessageStorage');
  const resetButton = doc.getElementById('resetButton');
  const feedback = doc.getElementById('saveFeedback');
  const status = doc.getElementById('statusAlert');
  const languageChoices = createLanguageChoices('vi');
  let selectedLanguage = resolveLanguageOption();
  let filteredLanguages = languageChoices;
  let activeLanguageIndex = -1;
  let loading = true;

  function selectedLanguageLabel() {
    return languageChoices.find((language) => language.code === selectedLanguage.code)?.label
      || selectedLanguage.name;
  }

  function setActiveLanguage(index) {
    const optionElements = Array.from(languageOptions?.querySelectorAll('.language-option') || []);
    activeLanguageIndex = optionElements.length
      ? Math.max(0, Math.min(index, optionElements.length - 1))
      : -1;
    optionElements.forEach((element, optionIndex) => {
      const active = optionIndex === activeLanguageIndex;
      element.dataset.active = String(active);
      if (active) {
        languageSearch?.setAttribute('aria-activedescendant', element.id);
        element.scrollIntoView?.({ block: 'nearest' });
      }
    });
    if (activeLanguageIndex < 0) languageSearch?.removeAttribute('aria-activedescendant');
  }

  function renderLanguageOptions(query = '') {
    if (!languageOptions) return;
    filteredLanguages = filterLanguageChoices(languageChoices, query);
    languageOptions.replaceChildren();
    if (filteredLanguages.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'language-empty';
      empty.textContent = 'Không tìm thấy ngôn ngữ';
      languageOptions.append(empty);
      setActiveLanguage(-1);
      return;
    }
    filteredLanguages.forEach((language, index) => {
      const option = doc.createElement('button');
      option.type = 'button';
      option.id = `target-language-option-${index}`;
      option.className = 'language-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(language.code === selectedLanguage.code));
      option.dataset.languageCode = language.code;
      const label = doc.createElement('span');
      label.textContent = language.label;
      option.append(label);
      if (language.code === selectedLanguage.code) {
        const check = doc.createElement('span');
        check.className = 'language-option-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        option.append(check);
      }
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => chooseLanguage(language));
      languageOptions.append(option);
    });
    setActiveLanguage(-1);
  }

  function openLanguageOptions() {
    if (!languagePicker || !languageOptions || !languageSearch) return;
    renderLanguageOptions(languageSearch.value === selectedLanguageLabel() ? '' : languageSearch.value);
    languageOptions.hidden = false;
    languagePicker.dataset.open = 'true';
    languageSearch.setAttribute('aria-expanded', 'true');
  }

  function closeLanguageOptions({ restore = true } = {}) {
    if (!languagePicker || !languageOptions || !languageSearch) return;
    languageOptions.hidden = true;
    languagePicker.dataset.open = 'false';
    languageSearch.setAttribute('aria-expanded', 'false');
    languageSearch.removeAttribute('aria-activedescendant');
    activeLanguageIndex = -1;
    if (restore) languageSearch.value = selectedLanguageLabel();
  }

  function chooseLanguage(language, options = {}) {
    selectedLanguage = { code: language.code, name: language.name };
    if (languageSearch) languageSearch.value = language.label || selectedLanguageLabel();
    closeLanguageOptions({ restore: false });
    if (options.save !== false) save();
  }

  function showFeedback(message) {
    if (!feedback) return;
    feedback.textContent = message;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 1800);
  }

  function showStatus(message, type = 'success') {
    if (!status) return;
    status.hidden = false;
    status.dataset.type = type;
    status.textContent = message;
  }

  function updateDisabledState() {
    const disabled = enabled?.checked === false;
    if (perConversation) perConversation.disabled = disabled;
    if (totalMegabytes) totalMegabytes.disabled = disabled;
  }

  async function refreshUsage() {
    const stats = await getMessageStoreStats();
    const size = stats.totalMegabytes < 0.01
      ? `${Math.round(stats.totalBytes / 1024)} KB`
      : `${stats.totalMegabytes.toFixed(2)} MB`;
    if (usage) usage.textContent = `${stats.messageCount.toLocaleString('vi-VN')} tin nhắn · ${stats.conversationCount.toLocaleString('vi-VN')} hội thoại · ${size}`;
    if (clearButton) clearButton.disabled = stats.messageCount === 0;
  }

  async function save(options = {}) {
    if (loading) return;
    const limits = normalizeMessageStoreLimits({
      messageStoreMaxPerConversation: perConversation?.value,
      messageStoreMaxMegabytes: totalMegabytes?.value
    });
    const config = {
      storeOriginalMessages: enabled?.checked !== false,
      messageStoreMaxPerConversation: limits.maxMessagesPerConversation,
      messageStoreMaxMegabytes: limits.maxTotalMegabytes,
      geminiApiKey: apiKey?.value.trim() || '',
      geminiModel: model?.value.trim() || '',
      targetLanguageName: selectedLanguage.name,
      targetLanguageCode: selectedLanguage.code
    };
    await setConfig(config);
    if (options.prune) await pruneMessageStore(config);
    updateDisabledState();
    await refreshUsage();
    showFeedback('✓ Đã lưu');
  }

  const config = await getConfig();
  if (enabled) enabled.checked = config.storeOriginalMessages !== false;
  if (apiKey) apiKey.value = config.geminiApiKey || '';
  if (model) model.value = config.geminiModel || '';
  selectedLanguage = resolveLanguageOption(config);
  if (languageSearch) languageSearch.value = selectedLanguageLabel();
  renderLanguageOptions();
  if (perConversation) perConversation.value = String(config.messageStoreMaxPerConversation || 1000);
  if (totalMegabytes) totalMegabytes.value = String(config.messageStoreMaxMegabytes || 50);
  updateDisabledState();
  await refreshUsage();
  loading = false;

  enabled?.addEventListener('change', () => save());
  apiKey?.addEventListener('change', () => save());
  model?.addEventListener('change', () => save());
  languageSearch?.addEventListener('focus', () => {
    languageSearch.select();
    openLanguageOptions();
  });
  languageSearch?.addEventListener('input', () => {
    openLanguageOptions();
  });
  languageSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (languageOptions?.hidden) openLanguageOptions();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const startingIndex = activeLanguageIndex < 0
        ? (direction > 0 ? -1 : filteredLanguages.length)
        : activeLanguageIndex;
      setActiveLanguage(startingIndex + direction);
      return;
    }
    if (event.key === 'Enter' && !languageOptions?.hidden && activeLanguageIndex >= 0) {
      event.preventDefault();
      chooseLanguage(filteredLanguages[activeLanguageIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLanguageOptions();
    }
  });
  doc.addEventListener('click', (event) => {
    if (languagePicker && !languagePicker.contains(event.target)) closeLanguageOptions();
  });
  perConversation?.addEventListener('change', () => save({ prune: true }));
  totalMegabytes?.addEventListener('change', () => save({ prune: true }));

  clearButton?.addEventListener('click', async () => {
    clearButton.disabled = true;
    await Promise.all([clearMessageStore(), clearTranslationStore(), clearChannelContextStore()]);
    await refreshUsage();
    showStatus('Đã xóa kho tin nhắn của phiên bản thu thập dữ liệu.');
  });

  resetButton?.addEventListener('click', async () => {
    const defaults = await resetConfig();
    loading = true;
    if (enabled) enabled.checked = defaults.storeOriginalMessages;
    if (apiKey) apiKey.value = defaults.geminiApiKey;
    if (model) model.value = defaults.geminiModel;
    selectedLanguage = resolveLanguageOption(defaults);
    if (languageSearch) languageSearch.value = selectedLanguageLabel();
    renderLanguageOptions();
    if (perConversation) perConversation.value = String(defaults.messageStoreMaxPerConversation);
    if (totalMegabytes) totalMegabytes.value = String(defaults.messageStoreMaxMegabytes);
    loading = false;
    updateDisabledState();
    showStatus('Đã đặt lại giới hạn lưu trữ.');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => initPopup(document));
}
