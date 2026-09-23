export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const GEMINI_MODELS = Object.freeze([
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', rpd: 500 },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', rpd: 20 },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', rpd: 500 },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', rpd: 20 },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', rpd: 20 },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', rpd: 20 }
]);

export function getGeminiModel(id) {
  return GEMINI_MODELS.find((model) => model.id === id) || null;
}

export function resolveGeminiModel(id) {
  return getGeminiModel(id) || getGeminiModel(DEFAULT_GEMINI_MODEL);
}
