// Extension configuration.

import { DEFAULT_GEMINI_MODEL } from './gemini_models.js';

export const DEFAULT_CONFIG = Object.freeze({
  storeOriginalMessages: true,
  messageStoreMaxPerConversation: 1000,
  messageStoreMaxMegabytes: 50,
  geminiApiKey: '',
  geminiApiKeys: [],
  geminiModel: DEFAULT_GEMINI_MODEL,
  targetLanguageName: 'Vietnamese',
  targetLanguageCode: 'vi'
});
