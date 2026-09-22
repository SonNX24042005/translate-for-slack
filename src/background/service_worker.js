import { getConfig } from '../common/storage.js';

const TRANSLATE_MESSAGE_TYPE = 'tfs:translate-all-with-gemini';
const REQUEST_TIMEOUT_MS = 180000;

function responseText(payload) {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.thought !== true && typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || `Gemini trả về HTTP ${response.status}.`;
  } catch {
    return `Gemini trả về HTTP ${response.status}.`;
  }
}

export async function requestGeminiTranslation(prompt, inputConfig = {}) {
  const config = { ...(await getConfig()), ...inputConfig };
  const apiKey = String(config.geminiApiKey || '').trim();
  const model = String(config.geminiModel || '').trim();
  if (!apiKey) throw new Error('Chưa cấu hình khóa API Gemini trong popup.');
  if (!model) throw new Error('Chưa cấu hình model Gemini trong popup.');
  if (!prompt) throw new Error('Không có nội dung để gửi đến Gemini.');

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
    if (!response.ok) throw new Error(await readErrorMessage(response));
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

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== TRANSLATE_MESSAGE_TYPE) return false;
    requestGeminiTranslation(String(message.prompt || ''))
      .then((text) => sendResponse({ success: true, text }))
      .catch((error) => sendResponse({ success: false, error: error?.message || 'Không thể gọi Gemini.' }));
    return true;
  });
}
