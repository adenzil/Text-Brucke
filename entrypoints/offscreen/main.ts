import { browser } from 'wxt/browser';
import { createOfflineTranslator } from '../../lib/translation-engine';
import { createTranslationQueue } from '../../lib/translation-queue';

const translate = createTranslationQueue(createOfflineTranslator((path) => browser.runtime.getURL(path)));

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || sender.tab || message?.type !== 'translate-offscreen') return;
  if (typeof message.text !== 'string') {
    sendResponse({ ok: false, error: 'Translation requires text.' });
    return;
  }

  const priority = message.priority === 'document' ? 'document' : 'selection';
  void translate(message.text, priority).then(
    (text) => sendResponse({ ok: true, text }),
    (error: unknown) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Offline translation failed.',
    }),
  );
  return true;
});
