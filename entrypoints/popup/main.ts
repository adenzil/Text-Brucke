import { browser } from 'wxt/browser';
import '../../styles/popup.css';

const translatePdf = document.querySelector<HTMLButtonElement>('#translate-pdf')!;
const openPdf = document.querySelector<HTMLButtonElement>('#open-pdf')!;
const status = document.querySelector<HTMLElement>('#status')!;
let currentUrl: URL | undefined;

async function openViewer(source?: URL) {
  const viewer = new URL(browser.runtime.getURL('/viewer.html'));
  if (source) viewer.searchParams.set('src', source.href);
  try {
    await browser.tabs.create({ url: viewer.href });
    window.close();
  } catch {
    status.textContent = 'The PDF reader could not be opened. Try again.';
  }
}

openPdf.addEventListener('click', () => void openViewer());
translatePdf.addEventListener('click', () => {
  if (currentUrl) void openViewer(currentUrl);
});

void browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const url = URL.parse(tab?.url ?? '');
  if (url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
    currentUrl = url;
    translatePdf.disabled = false;
  }
}).catch(() => { /* Local files can still be opened from the reader. */ });
