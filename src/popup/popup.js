import { getConfig, resetConfig, setConfig } from '../common/storage.js';
import {
  clearMessageStore,
  getMessageStoreStats,
  normalizeMessageStoreLimits,
  pruneMessageStore
} from '../common/message_store.js';
import { clearTranslationStore } from '../common/translation_store.js';
import { clearChannelContextStore } from '../common/channel_context_store.js';
import { GEMINI_MODELS, resolveGeminiModel } from '../common/gemini_models.js';
import { API_KEY_USAGE_STORAGE_KEY, getApiKeyUsage, pacificDay } from '../common/api_key_usage.js';
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
  const addApiKeyButton = doc.getElementById('addApiKey');
  const showApiKeysButton = doc.getElementById('showApiKeys');
  const apiKeyCount = doc.getElementById('apiKeyCount');
  const apiKeyDetails = doc.getElementById('apiKeyDetails');
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
  const updateStatus = doc.getElementById('updateStatus');
  const updateNotice = doc.getElementById('updateNotice');
  const updateVersion = doc.getElementById('updateVersion');
  const checkForUpdatesButton = doc.getElementById('checkForUpdates');
  const languageChoices = createLanguageChoices('vi');
  let selectedLanguage = resolveLanguageOption();
  let filteredLanguages = languageChoices;
  let activeLanguageIndex = -1;
  let loading = true;

  async function refreshApiKeys() {
    const keys = (await getConfig()).geminiApiKeys;
    if (apiKeyCount) apiKeyCount.textContent = keys.length ? `Đã lưu ${keys.length} khóa API` : 'Chưa có khóa API';
    if (showApiKeysButton) showApiKeysButton.disabled = keys.length === 0;
    if (keys.length === 0 && apiKeyDetails && !apiKeyDetails.hidden) {
      apiKeyDetails.hidden = true;
      showApiKeysButton.setAttribute('aria-expanded', 'false');
      showApiKeysButton.textContent = 'Xem chi tiết khóa API';
    }
    if (!apiKeyDetails || apiKeyDetails.hidden) return;
    const usage = await getApiKeyUsage(keys);
    const note = doc.createElement('p');
    note.className = 'api-key-note';
    note.textContent = `Lượt gửi ngày ${pacificDay()} theo giờ Thái Bình Dương trên trình duyệt này. Gemini áp hạn mức thực tế theo dự án.`;
    const cards = usage.map(({ key, counts }, index) => {
      const card = doc.createElement('div');
      card.className = 'api-key-card';
      const cardHeader = doc.createElement('div');
      cardHeader.className = 'api-key-card-header';
      const header = doc.createElement('strong');
      header.textContent = `Khóa ${index + 1} · ••••${key.slice(-4)}`;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'api-key-remove';
      remove.textContent = 'Xóa';
      remove.setAttribute('aria-label', `Xóa khóa API ${index + 1}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const current = (await getConfig()).geminiApiKeys;
          await setConfig({ geminiApiKeys: current.filter((value) => value !== key), geminiApiKey: '' });
          await refreshApiKeys();
          showFeedback('✓ Đã xóa khóa API');
        } catch {
          remove.disabled = false;
          showStatus('Không thể xóa khóa API. Vui lòng thử lại.', 'error');
        }
      });
      cardHeader.append(header, remove);
      card.append(cardHeader);
      for (const modelEntry of GEMINI_MODELS) {
        const row = doc.createElement('div');
        row.className = 'api-key-usage-row';
        const label = doc.createElement('span');
        label.textContent = modelEntry.label;
        const count = doc.createElement('span');
        count.textContent = `${counts[modelEntry.id] || 0}/${modelEntry.rpd} RPD`;
        row.append(label, count);
        card.append(row);
      }
      return card;
    });
    apiKeyDetails.replaceChildren(note, ...cards);
  }

  if (model) {
    model.replaceChildren(...GEMINI_MODELS.map((entry) => {
      const option = doc.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      return option;
    }));
  }

  async function refreshUpdateStatus(force = false) {
    if (!updateStatus || !chrome.runtime?.getManifest || !chrome.runtime?.sendMessage) return;
    const installedVersion = chrome.runtime.getManifest().version;
    updateStatus.textContent = `Phiên bản hiện tại: ${installedVersion} · Đang kiểm tra…`;
    if (checkForUpdatesButton) checkForUpdatesButton.disabled = true;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'tfs:check-for-updates', force });
      if (!state || state.error) {
        updateStatus.textContent = `Phiên bản hiện tại: ${installedVersion} · ${state?.error || 'Không thể kiểm tra bản mới.'}`;
      } else {
        updateStatus.textContent = `Phiên bản hiện tại: ${installedVersion}`;
      }
      const available = state?.updateAvailable === true;
      if (updateNotice) updateNotice.hidden = !available;
      if (available && updateVersion) updateVersion.textContent = `Bản mới: ${state.latestVersion}`;
    } catch {
      updateStatus.textContent = `Phiên bản hiện tại: ${installedVersion} · Không thể kiểm tra bản mới.`;
    } finally {
      if (checkForUpdatesButton) checkForUpdatesButton.disabled = false;
    }
  }

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
      geminiModel: resolveGeminiModel(model?.value).id,
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
  if (apiKey) apiKey.value = '';
  if (model) model.value = resolveGeminiModel(config.geminiModel).id;
  selectedLanguage = resolveLanguageOption(config);
  if (languageSearch) languageSearch.value = selectedLanguageLabel();
  renderLanguageOptions();
  if (perConversation) perConversation.value = String(config.messageStoreMaxPerConversation || 1000);
  if (totalMegabytes) totalMegabytes.value = String(config.messageStoreMaxMegabytes || 50);
  updateDisabledState();
  await refreshUsage();
  loading = false;
  await refreshApiKeys();
  void refreshUpdateStatus();
  checkForUpdatesButton?.addEventListener('click', () => refreshUpdateStatus(true));

  enabled?.addEventListener('change', () => save());
  async function addApiKey() {
    const value = apiKey?.value.trim() || '';
    if (!value) {
      showStatus('Hãy nhập khóa API cần thêm.', 'error');
      return;
    }
    addApiKeyButton.disabled = true;
    try {
      const keys = (await getConfig()).geminiApiKeys;
      if (keys.includes(value)) {
        showStatus('Khóa API này đã được lưu.', 'error');
        return;
      }
      await setConfig({ geminiApiKeys: [...keys, value], geminiApiKey: '' });
      apiKey.value = '';
      if (status) status.hidden = true;
      await refreshApiKeys();
      showFeedback('✓ Đã thêm khóa API');
    } catch {
      showStatus('Không thể lưu khóa API. Vui lòng thử lại.', 'error');
    } finally {
      addApiKeyButton.disabled = false;
    }
  }

  addApiKeyButton?.addEventListener('click', addApiKey);
  apiKey?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addApiKey();
    }
  });
  showApiKeysButton?.addEventListener('click', () => {
    apiKeyDetails.hidden = !apiKeyDetails.hidden;
    showApiKeysButton.setAttribute('aria-expanded', String(!apiKeyDetails.hidden));
    showApiKeysButton.textContent = apiKeyDetails.hidden ? 'Xem chi tiết khóa API' : 'Ẩn chi tiết khóa API';
    void refreshApiKeys();
  });
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes?.[API_KEY_USAGE_STORAGE_KEY] && !apiKeyDetails?.hidden) {
      void refreshApiKeys();
    }
  });
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
    if (apiKey) apiKey.value = '';
    if (apiKeyDetails) apiKeyDetails.hidden = true;
    if (showApiKeysButton) {
      showApiKeysButton.setAttribute('aria-expanded', 'false');
      showApiKeysButton.textContent = 'Xem chi tiết khóa API';
    }
    if (model) model.value = defaults.geminiModel;
    selectedLanguage = resolveLanguageOption(defaults);
    if (languageSearch) languageSearch.value = selectedLanguageLabel();
    renderLanguageOptions();
    if (perConversation) perConversation.value = String(defaults.messageStoreMaxPerConversation);
    if (totalMegabytes) totalMegabytes.value = String(defaults.messageStoreMaxMegabytes);
    loading = false;
    updateDisabledState();
    await refreshApiKeys();
    showStatus('Đã đặt lại cấu hình và xóa các khóa API đã lưu.');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => initPopup(document));
}
