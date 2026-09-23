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
const UPDATE_COMMANDS = {
  windows: 'irm https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/update.ps1 | iex',
  linux: 'curl -fsSL https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/update.sh | bash',
  macos: 'curl -fsSL https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/update.sh | bash'
};
const UPDATE_TERMINAL_GUIDES = {
  windows: 'Nhấn phím Windows, gõ PowerShell rồi nhấn Enter để mở terminal.',
  linux: 'Mở Terminal từ menu ứng dụng (thường có thể nhấn Ctrl+Alt+T).',
  macos: 'Nhấn Command+Space, gõ Terminal rồi nhấn Enter.'
};

function detectUpdatePlatform(navigatorObject) {
  const platform = `${navigatorObject?.userAgentData?.platform || navigatorObject?.platform || navigatorObject?.userAgent || ''}`;
  if (/win/i.test(platform)) return 'windows';
  if (/mac/i.test(platform)) return 'macos';
  return 'linux';
}

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
  const toggleStorageDetailsButton = doc.getElementById('toggleStorageDetails');
  const storageDetails = doc.getElementById('storageDetails');
  const resetButton = doc.getElementById('resetButton');
  const feedback = doc.getElementById('saveFeedback');
  const status = doc.getElementById('statusAlert');
  const updateStatus = doc.getElementById('updateStatus');
  const updateNotice = doc.getElementById('updateNotice');
  const updateVersion = doc.getElementById('updateVersion');
  const checkForUpdatesButton = doc.getElementById('checkForUpdates');
  const updatePlatform = doc.getElementById('updatePlatform');
  const updateTerminalGuide = doc.getElementById('updateTerminalGuide');
  const updateCommand = doc.getElementById('updateCommand');
  const copyUpdateCommand = doc.getElementById('copyUpdateCommand');
  const languageChoices = createLanguageChoices('vi');
  let selectedLanguage = resolveLanguageOption();
  let filteredLanguages = languageChoices;
  let activeLanguageIndex = -1;
  let loading = true;
  let selectedApiKey = '';
  let apiKeyRefreshId = 0;

  function renderUpdateCommand() {
    const platform = updatePlatform?.value || detectUpdatePlatform(doc.defaultView?.navigator);
    if (updateTerminalGuide) updateTerminalGuide.textContent = UPDATE_TERMINAL_GUIDES[platform];
    if (updateCommand) updateCommand.textContent = UPDATE_COMMANDS[platform];
    if (copyUpdateCommand) copyUpdateCommand.textContent = 'Sao chép';
  }

  if (updatePlatform) {
    updatePlatform.value = detectUpdatePlatform(doc.defaultView?.navigator);
    updatePlatform.addEventListener('change', renderUpdateCommand);
  }
  renderUpdateCommand();
  copyUpdateCommand?.addEventListener('click', async () => {
    try {
      await doc.defaultView.navigator.clipboard.writeText(updateCommand.textContent);
      copyUpdateCommand.textContent = 'Đã sao chép';
    } catch {
      const selection = doc.defaultView?.getSelection();
      if (selection && updateCommand) {
        const range = doc.createRange();
        range.selectNodeContents(updateCommand);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      copyUpdateCommand.textContent = updatePlatform?.value === 'macos' ? 'Nhấn Command+C' : 'Nhấn Ctrl+C';
    }
  });

  async function refreshApiKeys() {
    const refreshId = ++apiKeyRefreshId;
    const keys = (await getConfig()).geminiApiKeys;
    if (apiKeyCount) apiKeyCount.textContent = keys.length ? `Đã lưu ${keys.length} khóa API` : 'Chưa có khóa API';
    if (showApiKeysButton) showApiKeysButton.disabled = keys.length === 0;
    if (keys.length === 0 && apiKeyDetails && !apiKeyDetails.hidden) {
      apiKeyDetails.hidden = true;
      showApiKeysButton.setAttribute('aria-expanded', 'false');
      showApiKeysButton.textContent = 'Xem chi tiết khóa API';
    }
    if (keys.length === 0) selectedApiKey = '';
    if (!apiKeyDetails || apiKeyDetails.hidden) return;
    const selectedIndex = Math.max(0, keys.indexOf(selectedApiKey));
    selectedApiKey = keys[selectedIndex];
    const key = selectedApiKey;
    const [usage] = await getApiKeyUsage([key]);
    if (refreshId !== apiKeyRefreshId || apiKeyDetails.hidden) return;
    const selectorField = doc.createElement('label');
    selectorField.className = 'api-key-select-field';
    selectorField.textContent = 'Chọn khóa API';
    const selector = doc.createElement('select');
    selector.id = 'apiKeySelect';
    keys.forEach((key, index) => {
      const option = doc.createElement('option');
      option.value = String(index);
      option.textContent = `Khóa ${index + 1} · ••••${key.slice(-4)}`;
      selector.append(option);
    });
    selector.value = String(selectedIndex);
    selector.addEventListener('change', () => {
      selectedApiKey = keys[Number(selector.value)] || keys[0];
      void refreshApiKeys();
    });
    selectorField.append(selector);
    const note = doc.createElement('p');
    note.className = 'api-key-note';
    note.textContent = `Lượt gửi ngày ${pacificDay()} theo giờ Thái Bình Dương trên trình duyệt này. Gemini áp hạn mức thực tế theo dự án.`;
    const card = doc.createElement('div');
    card.className = 'api-key-card';
    const cardHeader = doc.createElement('div');
    cardHeader.className = 'api-key-card-header';
    const header = doc.createElement('strong');
    header.textContent = `Khóa ${selectedIndex + 1} · ••••${key.slice(-4)}`;
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'api-key-remove';
    remove.textContent = 'Xóa';
    remove.setAttribute('aria-label', `Xóa khóa API ${selectedIndex + 1}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        const current = (await getConfig()).geminiApiKeys;
        await setConfig({ geminiApiKeys: current.filter((value) => value !== key), geminiApiKey: '' });
        selectedApiKey = '';
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
      const exhausted = usage.exhausted[modelEntry.id] === true;
      count.textContent = `${usage.counts[modelEntry.id] || 0}/${modelEntry.rpd} RPD${exhausted ? ' · Hết lượt' : ''}`;
      if (exhausted) {
        count.dataset.exhausted = 'true';
        count.title = 'Gemini báo khóa này đã hết RPD của model';
      }
      row.append(label, count);
      card.append(row);
    }
    apiKeyDetails.replaceChildren(selectorField, note, card);
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
    updateStatus.textContent = `v${installedVersion} · Đang kiểm tra…`;
    if (checkForUpdatesButton) checkForUpdatesButton.disabled = true;
    try {
      const state = await chrome.runtime.sendMessage({ type: 'tfs:check-for-updates', force });
      if (!state || state.error) {
        updateStatus.textContent = `v${installedVersion} · ${state?.error || 'Không thể kiểm tra bản mới.'}`;
      } else {
        updateStatus.textContent = `v${installedVersion}`;
      }
      const available = state?.updateAvailable === true;
      if (updateNotice) updateNotice.hidden = !available;
      if (available && updateVersion) updateVersion.textContent = `Bản mới: ${state.latestVersion}`;
    } catch {
      updateStatus.textContent = `v${installedVersion} · Không thể kiểm tra bản mới.`;
    } finally {
      updateStatus.title = updateStatus.textContent;
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
    const rect = languagePicker.getBoundingClientRect();
    const viewportHeight = doc.defaultView?.innerHeight || 0;
    if (rect.height > 0 && viewportHeight > 0) {
      const availableAbove = rect.top;
      const availableBelow = viewportHeight - rect.bottom;
      const placeAbove = availableBelow < 224 && availableAbove > availableBelow;
      languagePicker.dataset.placement = placeAbove ? 'above' : 'below';
      const availableSpace = placeAbove ? availableAbove : availableBelow;
      languageOptions.style.maxHeight = `${Math.min(220, Math.max(48, availableSpace - 8))}px`;
    }
    renderLanguageOptions(languageSearch.value === selectedLanguageLabel() ? '' : languageSearch.value);
    languageSearch.readOnly = false;
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
    languageSearch.readOnly = true;
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
  if (languageSearch) {
    languageSearch.value = selectedLanguageLabel();
    languageSearch.readOnly = true;
  }
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
  toggleStorageDetailsButton?.addEventListener('click', () => {
    if (!storageDetails) return;
    storageDetails.hidden = !storageDetails.hidden;
    toggleStorageDetailsButton.setAttribute('aria-expanded', String(!storageDetails.hidden));
    toggleStorageDetailsButton.textContent = storageDetails.hidden ? 'Xem chi tiết' : 'Ẩn chi tiết';
  });
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes?.[API_KEY_USAGE_STORAGE_KEY] && !apiKeyDetails?.hidden) {
      void refreshApiKeys();
    }
  });
  model?.addEventListener('change', () => save());
  languageSearch?.addEventListener('focus', () => {
    openLanguageOptions();
    languageSearch.select();
  });
  languageSearch?.addEventListener('click', () => {
    if (languageOptions?.hidden) {
      openLanguageOptions();
      languageSearch.select();
    }
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
    if (languagePicker && !languagePicker.contains(event.target) && !languageOptions?.hidden) closeLanguageOptions();
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
