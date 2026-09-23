// Storage abstraction for message collection settings.

import { DEFAULT_CONFIG } from './constants.js';
import { resolveGeminiModel } from './gemini_models.js';

// In-memory store used when chrome.storage.local is unavailable (e.g. in test environments).
let memoryStore = { ...DEFAULT_CONFIG };
const changeListeners = new Set();
const INTERNAL_STORAGE_KEY_PREFIX = '__tfs';

function isInternalStorageKey(key) {
  return String(key || '').startsWith(INTERNAL_STORAGE_KEY_PREFIX);
}

function pickSupportedConfig(value = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_CONFIG)
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]])
  );
}

function normalizeConfig(config) {
  const keys = Array.isArray(config.geminiApiKeys)
    ? config.geminiApiKeys.filter((key) => typeof key === 'string').map((key) => key.trim()).filter(Boolean)
    : [];
  const legacyKey = String(config.geminiApiKey || '').trim();
  return {
    ...config,
    geminiApiKeys: [...new Set(keys.length ? keys : (legacyKey ? [legacyKey] : []))],
    geminiModel: resolveGeminiModel(config.geminiModel).id
  };
}

// Write queue for serializing concurrent configuration mutations.
let writeQueue = Promise.resolve();
let pendingCount = 0;

/**
 * Enqueues a write operation to execute sequentially.
 * Guarantees error isolation and resets the chain when idle.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueue(task) {
  pendingCount++;
  const run = async () => {
    try {
      return await task();
    } finally {
      pendingCount--;
      if (pendingCount === 0) {
        writeQueue = Promise.resolve();
      }
    }
  };

  const next = writeQueue.catch(() => {}).then(run);
  writeQueue = next.catch(() => {});
  return next;
}

/**
 * Checks whether chrome.storage.local is available in the current environment.
 * @returns {boolean}
 */
export function isChromeStorageAvailable() {
  return Boolean(
    typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof chrome.storage.local.set === 'function'
  );
}

/**
 * Retrieves the current extension configuration, merging with defaults.
 * @returns {Promise<typeof DEFAULT_CONFIG>}
 */
export async function getConfig() {
  if (!isChromeStorageAvailable()) {
    return normalizeConfig({ ...DEFAULT_CONFIG, ...memoryStore });
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime?.lastError) {
        // Fallback to memory store or defaults if reading failed
        resolve(normalizeConfig({ ...DEFAULT_CONFIG, ...memoryStore }));
        return;
      }

      const stored = items || {};
      const storedConfig = Object.fromEntries(
        Object.entries(stored).filter(([key]) => !isInternalStorageKey(key))
      );
      // Support config stored either under a nested 'config' key or directly at top level
      const rootConfig = storedConfig.config && typeof storedConfig.config === 'object'
        ? storedConfig.config
        : {};
      const merged = {
        ...DEFAULT_CONFIG,
        ...pickSupportedConfig(rootConfig),
        ...pickSupportedConfig(storedConfig)
      };

      resolve(normalizeConfig(merged));
    });
  });
}

/**
 * Persists partial configuration updates to storage.
 * Serialized via internal write queue to prevent lost updates under concurrency.
 * @param {Partial<typeof DEFAULT_CONFIG>} partialConfig
 * @returns {Promise<void>}
 */
export async function setConfig(partialConfig) {
  if (!partialConfig || typeof partialConfig !== 'object' || Array.isArray(partialConfig)) {
    return;
  }

  return enqueue(async () => {
    if (Object.keys(partialConfig).length === 0) {
      return;
    }

    const current = await getConfig();
    const updated = normalizeConfig({
      ...current,
      ...pickSupportedConfig(partialConfig)
    });

    memoryStore = { ...updated };

    if (!isChromeStorageAvailable()) {
      changeListeners.forEach((listener) => {
        try {
          listener(updated);
        } catch (err) {
          console.error('Error in storage change listener:', err);
        }
      });
      return;
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.set(updated, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  });
}

/**
 * Resets storage back to default configuration.
 * Serialized on the write queue to prevent race conditions with setConfig.
 * @returns {Promise<typeof DEFAULT_CONFIG>}
 */
export async function resetConfig() {
  return enqueue(async () => {
    memoryStore = { ...DEFAULT_CONFIG };

    if (!isChromeStorageAvailable()) {
      changeListeners.forEach((listener) => {
        try {
          listener({ ...DEFAULT_CONFIG });
        } catch (err) {
          console.error('Error in storage change listener:', err);
        }
      });
      return { ...DEFAULT_CONFIG };
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (items) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const configKeys = Object.keys(items || {}).filter((key) => !isInternalStorageKey(key));
        const saveDefaults = () => {
          chrome.storage.local.set({ ...DEFAULT_CONFIG }, () => {
            if (chrome.runtime?.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve({ ...DEFAULT_CONFIG });
          });
        };

        if (configKeys.length === 0 || typeof chrome.storage.local.remove !== 'function') {
          saveDefaults();
          return;
        }

        chrome.storage.local.remove(configKeys, () => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          saveDefaults();
        });
      });
    });
  });
}

/**
 * Subscribes to configuration changes across all extension contexts.
 * @param {(newConfig: typeof DEFAULT_CONFIG) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribeConfigChange(callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }

  if (!isChromeStorageAvailable() || !chrome.storage.onChanged) {
    changeListeners.add(callback);
    return () => {
      changeListeners.delete(callback);
    };
  }

  const listener = (changes, areaName) => {
    if (areaName === 'local' && Object.keys(changes || {}).some((key) => !isInternalStorageKey(key))) {
      getConfig().then((newConfig) => {
        callback(newConfig);
      });
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Helper to reset in-memory test store and write queue state.
 */
export function _resetMemoryStoreForTesting() {
  memoryStore = { ...DEFAULT_CONFIG };
  changeListeners.clear();
  writeQueue = Promise.resolve();
  pendingCount = 0;
}
