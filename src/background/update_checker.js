const UPDATE_STATE_KEY = '__tfsUpdateState';
const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/manifest.json';
export const UPDATE_ALARM_NAME = 'tfs:check-for-updates';
export const UPDATE_CHECK_INTERVAL_MINUTES = 24 * 60;
const UPDATE_CHECK_INTERVAL_MS = UPDATE_CHECK_INTERVAL_MINUTES * 60 * 1000;

function versionParts(version) {
  if (typeof version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(version)) return null;
  return version.split('.').map(Number);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function installedVersion() {
  return chrome.runtime.getManifest().version;
}

export async function getUpdateState() {
  const currentVersion = installedVersion();
  const stored = (await chrome.storage.local.get(UPDATE_STATE_KEY))[UPDATE_STATE_KEY];
  if (stored?.installedVersion === currentVersion && versionParts(stored.latestVersion)) {
    return {
      installedVersion: currentVersion,
      latestVersion: stored.latestVersion,
      checkedAt: Number(stored.checkedAt) || 0,
      updateAvailable: compareVersions(stored.latestVersion, currentVersion) > 0
    };
  }
  return { installedVersion: currentVersion, latestVersion: '', checkedAt: 0, updateAvailable: false };
}

export async function syncUpdateBadge(state) {
  if (!chrome.action?.setBadgeText) return;
  const currentState = state || await getUpdateState();
  await chrome.action.setBadgeText({ text: currentState.updateAvailable ? '1' : '' });
  if (currentState.updateAvailable) {
    await chrome.action.setBadgeBackgroundColor({ color: '#b4152b' });
  }
}

export async function checkForUpdates({ force = false } = {}) {
  const previous = await getUpdateState();
  const age = Date.now() - previous.checkedAt;
  if (!force && age >= 0 && age < UPDATE_CHECK_INTERVAL_MS) {
    await syncUpdateBadge(previous);
    return previous;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(UPDATE_MANIFEST_URL, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (!versionParts(manifest?.version)) throw new Error('Invalid version');
    const state = {
      installedVersion: previous.installedVersion,
      latestVersion: manifest.version,
      checkedAt: Date.now(),
      updateAvailable: compareVersions(manifest.version, previous.installedVersion) > 0
    };
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
    await syncUpdateBadge(state);
    return state;
  } catch {
    await syncUpdateBadge(previous);
    return { ...previous, error: 'Không thể kiểm tra phiên bản mới. Vui lòng thử lại sau.' };
  }
}

export async function initializeUpdateChecks() {
  if (!chrome.alarms?.get || !chrome.alarms?.create) return;
  const alarm = await chrome.alarms.get(UPDATE_ALARM_NAME);
  if (!alarm) {
    await chrome.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES });
  }
  await checkForUpdates();
}
