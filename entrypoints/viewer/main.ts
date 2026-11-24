import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { extractLayout, renderPdfPage, showTranslations } from '../../lib/pdf-layout';
import type { LayoutBlock, PageLayout } from '../../lib/pdf-layout';
import { translateText } from '../../lib/translation';
import '../../styles/viewer.css';

const assetRoot = new URL('/pdfjs/', location.href).href;
GlobalWorkerOptions.workerSrc = `${assetRoot}build/pdf.worker.mjs`;

const file = document.querySelector<HTMLInputElement>('#file')!;
const welcome = document.querySelector<HTMLElement>('#welcome')!;
const spread = document.querySelector<HTMLElement>('#spread')!;
const navigation = document.querySelector<HTMLElement>('#navigation')!;
const documentName = document.querySelector<HTMLElement>('#document-name')!;
const openStatus = document.querySelector<HTMLElement>('#open-status')!;
const translationStatus = document.querySelector<HTMLElement>('#translation-status')!;
const originalSlot = document.querySelector<HTMLElement>('#original-page')!;
const englishSlot = document.querySelector<HTMLElement>('#english-page')!;
const originalScroll = document.querySelector<HTMLElement>('#original-scroll')!;
const englishScroll = document.querySelector<HTMLElement>('#english-scroll')!;
const textFallback = document.querySelector<HTMLElement>('#text-fallback')!;
const pageNumberInput = document.querySelector<HTMLInputElement>('#page-number')!;
const pageCount = document.querySelector<HTMLElement>('#page-count')!;
const previous = document.querySelector<HTMLButtonElement>('#previous')!;
const next = document.querySelector<HTMLButtonElement>('#next')!;
const zoom = document.querySelector<HTMLSelectElement>('#zoom')!;
const passwordDialog = document.querySelector<HTMLDialogElement>('#password-dialog')!;
const passwordStatus = document.querySelector<HTMLElement>('#password-status')!;
const password = document.querySelector<HTMLInputElement>('#password')!;

interface PageRecord {
  page: PDFPageProxy;
  layout: PageLayout;
  translations: Map<string, string>;
  translating: boolean;
  failed: boolean;
  textClipping: boolean;
}

interface VisiblePage {
  record: PageRecord;
  layer: HTMLElement;
  canvas: HTMLCanvasElement;
  blocks: LayoutBlock[];
  matched: boolean;
}

const pages = new Map<number, Promise<PageRecord>>();
const segmenter = new Intl.Segmenter('de', { granularity: 'sentence' });
let pdf: PDFDocumentProxy | undefined;
let loading: PDFDocumentLoadingTask | undefined;
let loadId = 0;
let renderId = 0;
let pageNumber = 1;
let visible: VisiblePage | undefined;
let renderTasks: RenderTask[] = [];
let unlock: ((value: string) => void) | undefined;

document.querySelectorAll('[data-open]').forEach((button) => {
  button.addEventListener('click', () => file.click());
});

file.addEventListener('change', () => {
  const chosen = file.files?.[0];
  file.value = '';
  if (chosen) void openPdf(chosen, chosen.name);
});

passwordDialog.addEventListener('close', () => {
  const submitPassword = unlock;
  unlock = undefined;
  if (!submitPassword) return;
  if (passwordDialog.returnValue === 'unlock') submitPassword(password.value);
  else {
    loadId += 1;
    void loading?.destroy().catch(() => {});
    openStatus.textContent = 'The PDF is locked. Open it again to enter its password.';
  }
  password.value = '';
});

async function openPdf(source: URL | File, name: string) {
  const id = ++loadId;
  cancelRender();
  unlock = undefined;
  if (passwordDialog.open) passwordDialog.close();
  const previousLoad = loading;
  loading = undefined;
  if (previousLoad) void previousLoad.destroy().catch(() => {});
  pdf = undefined;
  pages.clear();
  navigation.hidden = true;
  spread.hidden = true;
  welcome.hidden = false;
  documentName.textContent = name;
  openStatus.textContent = 'Opening PDF…';
  originalSlot.replaceChildren();
  englishSlot.replaceChildren();
  textFallback.replaceChildren();

  try {
    const input = source instanceof File
      ? { data: new Uint8Array(await source.arrayBuffer()) }
      : { url: source.href, withCredentials: true };
    if (id !== loadId) return;
    const task = getDocument({
      ...input,
      cMapUrl: `${assetRoot}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetRoot}standard_fonts/`,
      wasmUrl: `${assetRoot}wasm/`,
      iccUrl: `${assetRoot}iccs/`,
      useSystemFonts: true,
    });
    loading = task;
    task.onPassword = (submit: (value: string) => void, reason: number) => {
      if (id !== loadId) return;
      unlock = submit;
      password.value = '';
      passwordStatus.textContent = reason === PasswordResponses.INCORRECT_PASSWORD
        ? 'That password was incorrect. Try again.'
        : 'This document requires a password.';
      passwordDialog.returnValue = '';
      if (!passwordDialog.open) passwordDialog.showModal();
      password.focus();
    };

    const opened = await task.promise;
    if (id !== loadId) return;
    pdf = opened;
    pageNumber = 1;
    zoom.value = 'fit';
    document.title = `${name} · Textbrücke`;
    welcome.hidden = true;
    spread.hidden = false;
    navigation.hidden = false;
    setPageControls();
    void renderPage(true);
  } catch (error) {
    if (id !== loadId) return;
    console.error('Textbrücke could not read the PDF', error);
    openStatus.textContent = source instanceof File
      ? 'This file could not be read as a PDF.'
      : 'This PDF could not be reopened from its URL. Download it and choose the local file.';
  }
}

function setPageControls() {
  pageNumberInput.value = `${pageNumber}`;
  pageCount.textContent = `/ ${pdf?.numPages}`;
  previous.disabled = pageNumber === 1;
  next.disabled = pageNumber === pdf?.numPages;
}

function goToPage(value: number) {
  if (!pdf || !Number.isInteger(value)) {
    setPageControls();
    return;
  }
  const nextPage = Math.max(1, Math.min(value, pdf.numPages));
  const changed = nextPage !== pageNumber;
  pageNumber = nextPage;
  setPageControls();
  if (changed) void renderPage(true);
}

function getPage(document: PDFDocumentProxy, number: number) {
  let record = pages.get(number);
  if (!record) {
    record = document.getPage(number).then(async (page): Promise<PageRecord> => ({
      page,
      layout: await extractLayout(page, page.getViewport({ scale: 1 })),
      translations: new Map(),
      translating: false,
      failed: false,
      textClipping: false,
    }));
    pages.set(number, record);
    void record.catch(() => {
      if (pages.get(number) === record) pages.delete(number);
    });
  }
  return record;
}

function cancelRender() {
  renderId += 1;
  visible = undefined;
  for (const task of renderTasks) task.cancel();
  renderTasks = [];
}

async function renderPage(resetScroll: boolean) {
  if (!pdf) return;
  cancelRender();
  const id = renderId;
  const number = pageNumber;
  translationStatus.textContent = 'Preparing page…';
  textFallback.hidden = true;
  if (resetScroll) {
    originalSlot.replaceChildren();
    englishSlot.replaceChildren();
    originalScroll.scrollTo(0, 0);
    englishScroll.scrollTo(0, 0);
  }

  try {
    const record = await getPage(pdf, number);
    if (id !== renderId) return;
    const natural = record.page.getViewport({ scale: 1 });
    const padding = parseFloat(getComputedStyle(originalScroll).paddingLeft) * 2;
    const available = Math.min(originalScroll.clientWidth, englishScroll.clientWidth) - padding - 2;
    const scale = zoom.value === 'fit' ? Math.max(0.05, available / natural.width) : Number(zoom.value);
    const viewport = record.page.getViewport({ scale });
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)));
    const original = makeSheet(originalSlot);
    const english = makeSheet(englishSlot);
    english.sheet.style.visibility = 'hidden';
    const layer = document.createElement('div');
    layer.className = 'translation-layer';
    layer.lang = 'en';
    english.sheet.append(layer);

    let matched = record.layout.blocks.length > 0 && !record.layout.unsupportedGeometry && !record.textClipping;
    const originalTask = renderPdfPage(record.page, viewport, original.canvas, { pixelRatio });
    const englishTask = renderPdfPage(record.page, viewport, english.canvas, {
      pixelRatio,
      omitText: matched,
      onTextClipping: () => { record.textClipping = true; },
    });
    renderTasks = [originalTask, englishTask];
    await Promise.all(renderTasks.map((task) => task.promise));
    if (id !== renderId) return;
    if (matched && record.textClipping) {
      // Removing a preceding text operator can move a glyph-based graphics mask.
      matched = false;
      const unfiltered = renderPdfPage(record.page, viewport, english.canvas, { pixelRatio });
      renderTasks = [unfiltered];
      await unfiltered.promise;
      if (id !== renderId) return;
    }
    renderTasks = [];
    english.sheet.style.visibility = '';
    const blocks = record.layout.blocks.map((block) => ({
      ...block, left: block.left * scale, top: block.top * scale,
      width: block.width * scale, height: block.height * scale, fontSize: block.fontSize * scale,
    }));
    visible = { record, layer, canvas: english.canvas, blocks, matched };
    displayTranslations();
    if (record.translations.size < blocks.length) void translatePage(record, number, loadId);
  } catch (error) {
    if (id !== renderId) return;
    console.error('Textbrücke could not render the PDF page', error);
    cancelRender();
    translationStatus.textContent = 'This page could not be displayed.';
  }
}

function makeSheet(slot: HTMLElement) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  sheet.append(canvas);
  slot.replaceChildren(sheet);
  return { sheet, canvas };
}

function displayTranslations() {
  if (!visible) return;
  const { record, layer, canvas, blocks, matched } = visible;
  if (!blocks.length) {
    translationStatus.textContent = 'No selectable text on this page.';
    textFallback.hidden = false;
    textFallback.textContent = 'The page may be a scan. This reader translates PDFs with a text layer.';
    return;
  }

  if (matched) {
    showTranslations(layer, blocks, record.translations, canvas);
  } else {
    textFallback.hidden = false;
    textFallback.replaceChildren(...blocks.flatMap(({ id }) => {
      const text = record.translations.get(id);
      if (text === undefined) return [];
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      return [paragraph];
    }));
  }
  const complete = record.translations.size === blocks.length;
  translationStatus.replaceChildren();
  if (record.failed) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry-button';
    retry.textContent = 'Retry translation';
    retry.addEventListener('click', () => void translatePage(record, pageNumber, loadId));
    translationStatus.append(retry);
  } else {
    translationStatus.textContent = complete ? (matched ? '' : 'Text view for this page') : 'Translating page…';
  }
}

async function translatePage(record: PageRecord, number: number, id: number) {
  if (record.translating) return;
  record.translating = true;
  record.failed = false;
  const current = () => id === loadId && number === pageNumber;
  if (visible?.record === record) displayTranslations();
  try {
    for (const { id: blockId, text } of record.layout.blocks) {
      if (!current()) break;
      if (record.translations.has(blockId)) continue;
      const pieces: string[] = [];
      for (const { segment } of segmenter.segment(text)) {
        const sentence = segment.trim();
        for (let start = 0; start < sentence.length;) {
          let end = Math.min(start + 2_000, sentence.length);
          if (end < sentence.length) {
            const boundary = sentence.lastIndexOf(' ', end);
            if (boundary > start) end = boundary;
          }
          if (!current()) return;
          pieces.push(await translateText(sentence.slice(start, end), 'document'));
          start = end + (sentence[end] === ' ' ? 1 : 0);
        }
      }
      record.translations.set(blockId, pieces.join(' '));
      if (visible?.record === record) displayTranslations();
    }
  } catch (error) {
    console.error('Textbrücke could not translate the PDF page', error);
    record.failed = true;
  } finally {
    record.translating = false;
    if (visible?.record === record) displayTranslations();
  }
}

previous.addEventListener('click', () => goToPage(pageNumber - 1));
next.addEventListener('click', () => goToPage(pageNumber + 1));
pageNumberInput.addEventListener('change', () => goToPage(Number(pageNumberInput.value)));
pageNumberInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') pageNumberInput.blur();
});
zoom.addEventListener('change', () => void renderPage(false));

let lastWidth = 0;
new ResizeObserver(([entry]) => {
  if (!entry) return;
  const width = entry.contentRect.width;
  if (Math.abs(lastWidth - width) < 1) return;
  lastWidth = width;
  if (width && zoom.value === 'fit') void renderPage(false);
}).observe(originalScroll);

function syncScroll(source: HTMLElement, target: HTMLElement) {
  source.addEventListener('scroll', () => {
    if (!visible?.matched) return;
    const maxLeft = Math.max(0, target.scrollWidth - target.clientWidth);
    const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
    const left = Math.min(source.scrollLeft, maxLeft);
    const top = Math.min(source.scrollTop, maxTop);
    if (Math.abs(target.scrollLeft - left) > 1 || Math.abs(target.scrollTop - top) > 1) {
      target.scrollTo(left, top);
    }
  }, { passive: true });
}
syncScroll(originalScroll, englishScroll);
syncScroll(englishScroll, originalScroll);

const source = new URLSearchParams(location.search).get('src');
if (source) {
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    const name = url.pathname.split('/').filter(Boolean).at(-1) ?? 'Web PDF';
    let label = name;
    try { label = decodeURIComponent(name); } catch { /* Keep malformed URL escapes visible. */ }
    void openPdf(url, label);
  } catch {
    openStatus.textContent = 'Choose a local file to open this PDF.';
  }
}
