import { browser } from 'wxt/browser';
import '../../styles/popup.css';

const translatePdf = document.querySelector<HTMLButtonElement>('#translate-pdf')!;
const openPdf = document.querySelector<HTMLButtonElement>('#open-pdf')!;
const status = document.querySelector<HTMLElement>('#status')!;
const siteHint = document.querySelector<HTMLElement>('#site-hint')!;
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

async function enableSelection(tabId: number) {
  const script = '/content-scripts/selection.js' as const;
  const files = [script];
  try {
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files });
  } catch {
    // Some pages embed frames outside the current tab's temporary permission.
    await browser.scripting.executeScript({ target: { tabId }, files });
  }
}

async function activateCurrentPage() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = URL.parse(tab?.url ?? '');
  if (tab?.id === undefined || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    siteHint.textContent = 'To translate selected text, open this menu from a webpage.';
    return;
  }

  currentUrl = url;
  translatePdf.disabled = false;
  await enableSelection(tab.id);
  siteHint.textContent = 'Selection translation is on for this page. Close this menu and select German text.';
}

void activateCurrentPage().catch(() => {
  siteHint.textContent = 'Selection translation is unavailable on this page. For a PDF, use the reader below.';
});
