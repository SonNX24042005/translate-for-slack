import { getConfig } from '../common/storage.js';
import { getGeminiModel } from '../common/gemini_models.js';
import { API_KEY_RPD_EXHAUSTED_CODE, markApiKeyRpdExhausted, reserveApiKey } from '../common/api_key_usage.js';
import { checkForUpdates, initializeUpdateChecks, UPDATE_ALARM_NAME } from './update_checker.js';

const TRANSLATE_MESSAGE_TYPE = 'tfs:translate-all-with-gemini';
const REQUEST_TIMEOUT_MS = 180000;

function responseText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.thought !== true && typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

async function readGeminiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The HTTP status is still available when Gemini returns a non-JSON body.
  }
  const message = payload?.error?.message || 'Không có chi tiết lỗi.';
  const error = new Error(`Gemini HTTP ${response.status}: ${message}`);
  const quotaDetails = `${message} ${JSON.stringify(payload?.error?.details || [])}`;
  if (response.status === 429 && /per[\s_-]?day|daily|\brpd\b/i.test(quotaDetails)) {
    error.code = API_KEY_RPD_EXHAUSTED_CODE;
  }
  return error;
}

async function requestWithApiKey(prompt, model, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 65536
        }
      }),
      signal: controller.signal
    });
    if (!response.ok) throw await readGeminiError(response);
    const payload = await response.json();
    const text = responseText(payload);
    if (!text) {
      const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || 'không rõ nguyên nhân';
      throw new Error(`Gemini không trả về nội dung (${reason}).`);
    }
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Gemini không phản hồi trong vòng 3 phút.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestGeminiTranslation(prompt, inputConfig = {}) {
  const config = { ...(await getConfig()), ...inputConfig };
  const keys = inputConfig.geminiApiKey
    ? [String(inputConfig.geminiApiKey).trim()]
    : config.geminiApiKeys;
  const model = String(config.geminiModel || '').trim();
  if (!keys?.length) throw new Error('Chưa có khóa API Gemini. Hãy thêm khóa trong popup.');
  if (!model) throw new Error('Chưa cấu hình model Gemini trong popup.');
  const modelEntry = getGeminiModel(model);
  if (!modelEntry) throw new Error('Model Gemini không được hỗ trợ. Hãy chọn model trong popup.');
  if (!prompt) throw new Error('Không có nội dung để gửi đến Gemini.');

  const remainingKeys = [...keys];
  while (remainingKeys.length > 0) {
    const apiKey = await reserveApiKey(remainingKeys, model);
    remainingKeys.splice(remainingKeys.indexOf(apiKey), 1);
    try {
      return await requestWithApiKey(prompt, model, apiKey);
    } catch (error) {
      if (error?.code !== API_KEY_RPD_EXHAUSTED_CODE) throw error;
      await markApiKeyRpdExhausted(apiKey, model);
    }
  }
  const error = new Error(`Đã dùng hết RPD của tất cả khóa API cho ${modelEntry.label} hôm nay.`);
  error.code = API_KEY_RPD_EXHAUSTED_CODE;
  throw error;
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'tfs:check-for-updates') {
      checkForUpdates({ force: message.force === true })
        .then(sendResponse)
        .catch(() => sendResponse({ error: 'Không thể kiểm tra phiên bản mới.' }));
      return true;
    }
    if (message?.type !== TRANSLATE_MESSAGE_TYPE) return false;
    requestGeminiTranslation(String(message.prompt || ''))
      .then((text) => sendResponse({ success: true, text }))
      .catch((error) => sendResponse({
        success: false,
        error: error?.message || 'Không thể gọi Gemini.',
        ...(error?.code ? { code: error.code } : {})
      }));
    return true;
  });
}

if (globalThis.chrome?.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM_NAME) void checkForUpdates();
  });
  chrome.runtime.onStartup?.addListener(() => { void initializeUpdateChecks(); });
  chrome.runtime.onInstalled?.addListener(() => { void initializeUpdateChecks(); });
  void initializeUpdateChecks();
}
