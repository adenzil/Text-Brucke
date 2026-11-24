import { browser } from 'wxt/browser';

export type TranslationPriority = 'selection' | 'document';

export type TranslationResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function translateText(
  text: string,
  priority: TranslationPriority = 'selection',
): Promise<string> {
  if (!text.trim()) return text;

  const result = await browser.runtime.sendMessage({ type: 'translate', text, priority }) as
    | TranslationResult
    | undefined;
  if (result?.ok && typeof result.text === 'string') return result.text;
  throw new Error(result?.ok === false ? result.error : 'Offline translation is unavailable.');
}
