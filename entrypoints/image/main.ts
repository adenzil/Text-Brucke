import { browser } from 'wxt/browser';
import { detectImageLanguage, splitImageText } from '../../lib/image-translation';
import type { ImageTranslationInput } from '../../lib/image-translation';
import { readImageText } from '../../lib/ocr';
import { translateText } from '../../lib/translation';
import '../../styles/image.css';

const status = document.querySelector('#status')!;
const translateButton = document.querySelector<HTMLButtonElement>('#translate')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const capturedImage = document.querySelector<HTMLImageElement>('#captured-image')!;
const recognized = document.querySelector<HTMLElement>('#recognized')!;
const recognizedText = document.querySelector<HTMLElement>('#recognized-text')!;
const english = document.querySelector<HTMLElement>('#english')!;
const englishText = document.querySelector('#english-text')!;

async function translate() {
  translateButton.disabled = true;
  recognizedText.lang = 'de';
  status.textContent = 'Translating German to English…';
  try {
    const translated: string[] = [];
    for (const chunk of splitImageText(recognizedText.textContent ?? '')) {
      translated.push(await translateText(chunk));
    }
    englishText.textContent = translated.join('\n\n');
    english.hidden = false;
    translateButton.hidden = true;
    status.textContent = 'Translated from German.';
  } catch {
    translateButton.textContent = 'Retry translation';
    translateButton.hidden = false;
    status.textContent = 'The German text could not be translated.';
  } finally {
    translateButton.disabled = false;
  }
}

translateButton.addEventListener('click', () => void translate());

async function openImage() {
  const token = location.hash.slice(1);
  const input: ImageTranslationInput | undefined = token
    ? await browser.runtime.sendMessage({ type: 'image-translation-input', token })
    : undefined;
  if (!input || 'error' in input) {
    status.textContent = input?.error ?? 'Right-click a webpage image and choose Translate image to get started.';
    return;
  }

  capturedImage.src = input.imageUrl;
  preview.hidden = false;
  status.textContent = 'Reading the text in the image…';
  const text = await readImageText(input.imageUrl);
  if (!/[\p{L}\p{N}]/u.test(text)) {
    status.textContent = 'No readable text found. Zoom in on the image and try again.';
    return;
  }

  recognizedText.textContent = text;
  recognized.hidden = false;
  status.textContent = 'Checking the language…';
  const detection = await browser.i18n.detectLanguage(text).catch(() => ({ isReliable: false, languages: [] }));
  const language = detectImageLanguage(detection);
  if (language === 'de') {
    await translate();
  } else if (language) {
    const name = new Intl.DisplayNames('en', { type: 'language' }).of(language);
    recognizedText.lang = language;
    status.textContent = `The recognized text appears to be ${name}. Textbrücke translates German.`;
  } else {
    status.textContent = 'Textbrücke could not determine the language. If the text is German, you can translate it.';
    translateButton.hidden = false;
  }
}

void openImage().catch(() => {
  status.textContent = 'Textbrücke could not read the image. Right-click it and try again.';
});
