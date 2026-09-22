// Manifest V3 content scripts are classic scripts, so load the collector as a module.
(async () => {
  try {
    await import(chrome.runtime.getURL('src/content/content.js'));
  } catch (error) {
    if (!/Extension context invalidated/i.test(error?.message || '')) {
      console.error('[translate-for-slack] Không thể tải bộ thu thập tin nhắn:', error);
    }
  }
})();
