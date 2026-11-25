import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { registerImageTranslation } from '../lib/image-capture';

export default defineBackground(() => {
  registerImageTranslation();

  const documentPath = '/offscreen.html' as const;
  const documentUrl = browser.runtime.getURL(documentPath);
  let creating: Promise<void> | undefined;

  async function ensureDocument() {
    creating ??= (async () => {
      const documents = await browser.runtime.getContexts({ documentUrls: [documentUrl] });
      if (documents.length === 0) {
        await browser.offscreen.createDocument({
          url: documentPath.slice(1),
          reasons: [browser.offscreen.Reason.WORKERS],
          justification: 'Run the bundled German-to-English model in a shared Web Worker.',
        });
      }
    })().finally(() => { creating = undefined; });
    await creating;
  }

  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'translate' || sender.id !== browser.runtime.id) return;
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 8_000 ||
        !['selection', 'document'].includes(message.priority)) {
      respond({ ok: false, error: 'Select up to 8,000 characters of text to translate.' });
      return;
    }

    void ensureDocument()
      .then(() => browser.runtime.sendMessage({
        type: 'translate-offscreen', text: message.text, priority: message.priority,
      }))
      .then(respond)
      .catch((error: unknown) => {
        console.error('Textbrücke could not start the translation worker', error);
        respond({ ok: false, error: 'The offline translator could not start. Try again.' });
      });
    return true;
  });
});
