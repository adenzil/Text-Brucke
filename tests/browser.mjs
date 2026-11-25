import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function fixturePdf() {
  const stream = [
    '0.1 0.45 0.65 rg 325 590 115 60 re f',
    '0 g BT /F1 22 Tf 45 700 Td (Guten Morgen!) Tj ET',
    'BT /F1 14 Tf 45 650 Td (Das ist ein Test.) Tj ET',
    'BT /F1 14 Tf 45 628 Td (Heute ist ein guter Tag.) Tj ET',
    'BT /F1 14 Tf 320 700 Td (Vielen Dank!) Tj ET',
  ].join('\n');
  const nextStream = '0 g BT /F1 22 Tf 45 700 Td (Gute Nacht!) Tj ET';
  const clipStream = 'q 0 g BT /F1 22 Tf 45 700 Td (Guten Morgen! ) Tj 7 Tr (CLIP) Tj ET 1 0 0 rg 0 0 480 760 re f Q';
  const pageWith = (content) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 760] /Resources << /Font << /F1 4 0 R >> >> /Contents ${content} 0 R >>`;
  const pdfStream = (data) => `<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 3 /Kids [3 0 R 6 0 R 8 0 R] >>',
    pageWith(5),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    pdfStream(stream),
    pageWith(7),
    pdfStream(nextStream),
    pageWith(9),
    pdfStream(clipStream),
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const imageLines = {
  german: [
    'Guten Morgen! Schön, dass Sie hier sind.',
    'Die Bibliothek öffnet heute um neun Uhr.',
    'Bitte schließen Sie die Tür leise.',
  ],
  english: [
    'Good morning! Thank you for visiting.',
    'The library opens at nine this morning.',
    'Please close the door quietly behind you.',
  ],
  uncertain: ['12345'],
  blank: [],
};

test('a fresh Chrome extension translates web text, PDFs, and images offline', { timeout: 120_000 }, async (t) => {
  const extensionPath = resolve('.output/chrome-mv3');
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(new Set(manifest.permissions), new Set(['activeTab', 'scripting', 'offscreen', 'contextMenus']));
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  const { chromium } = await import('playwright');

  const profile = await mkdtemp(join(tmpdir(), 'textbrucke-chrome-'));
  const testExtension = join(profile, 'extension');
  let context;
  const server = createServer((request, response) => {
    if (request.url === '/document') {
      response.writeHead(200, { 'Content-Type': 'application/pdf' }).end(fixturePdf());
      return;
    }
    const imageRequest = /^\/ocr-(german|english|uncertain|blank)(\.svg)?$/.exec(request.url);
    if (imageRequest) {
      const [, kind, svg] = imageRequest;
      if (svg) {
        const lines = imageLines[kind].map((line, index) => `<text x="22" y="${112 + index * 55}">${line}</text>`);
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(
          `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="290"><rect width="760" height="290" fill="white"/><g font-family="Arial, sans-serif" font-size="32"><text x="22" y="32">CLIPPED HEADER</text>${lines.join('')}</g></svg>`,
        );
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          `<!doctype html><body style="margin:40px"><p>Neighboring page text</p>
          <div style="width:850px;height:240px;overflow:hidden"><img src="http://localhost:${server.address().port}/ocr-${kind}.svg"
            style="display:block;width:850px;height:290px;object-fit:contain;margin-top:-50px;border-inline:5px solid #a34;background:#fbd"></div></body>`,
        );
      }
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(request.url === '/frame'
      ? '<!doctype html><p id="framed">Vielen Dank!</p>'
      : '<!doctype html><html lang="de"><p id="phrase">Guten Morgen!</p><p id="word">Zug</p><iframe title="German excerpt" src="/frame"></iframe></html>');
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(async () => {
    await context?.close();
    await new Promise((done) => server.close(done));
    await rm(profile, { recursive: true, force: true });
  });

  await cp(extensionPath, testExtension, { recursive: true });
  const workerPath = join(testExtension, manifest.background.service_worker);
  const workerSource = await readFile(workerPath, 'utf8');
  // Chrome's native context menu is outside Playwright's page automation.
  await writeFile(workerPath, `
    const addImageMenuListener = chrome.contextMenus.onClicked.addListener.bind(chrome.contextMenus.onClicked);
    chrome.contextMenus.onClicked.addListener = (listener) => {
      globalThis.clickImageMenuForTest = listener;
      addImageMenuListener(listener);
    };
    ${workerSource}`);

  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${testExtension}`,
      `--load-extension=${testExtension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--disable-background-networking',
      '--enable-unsafe-extension-debugging',
    ],
  });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'chrome-extension:'
      ? route.continue()
      : route.abort();
  });

  const background = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const viewerUrl = new URL('/viewer.html', background.url()).href;
  const extensionId = new URL(viewerUrl).hostname;
  const browserProtocol = await context.browser().newBrowserCDPSession();

  async function clickToolbar(page) {
    await page.bringToFront();
    const { targetInfos } = await browserProtocol.send('Target.getTargets', {
      filter: [{ type: 'tab' }, { exclude: true }],
    });
    const tab = targetInfos.find((target) => target.url === page.url());
    assert.ok(tab, `No Chrome tab target found for ${page.url()}`);
    await browserProtocol.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
  }

  const page = context.pages()[0] ?? await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  const popoverElement = page.locator('[aria-label="English translation"]');
  assert.equal(await popoverElement.count(), 0, 'website access starts only after the toolbar action');
  await context.setOffline(true);
  await clickToolbar(page);
  await popoverElement.waitFor({ state: 'attached', timeout: 5_000 });

  const phrase = await page.locator('#phrase').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().toJSON();
  });
  let started = performance.now();
  await page.mouse.move(phrase.left + 1, phrase.top + phrase.height / 2);
  await page.mouse.down();
  await page.mouse.move(phrase.right + 3, phrase.top + phrase.height / 2, { steps: 5 });
  await page.mouse.up();
  const popover = page.getByRole('status', { name: 'English translation' });
  await popover.getByText(/good morning/i).waitFor({ timeout: 30_000 });
  t.diagnostic(`Cold selection ${Math.round(performance.now() - started)} ms`);
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden' });

  started = performance.now();
  await page.locator('#word').dblclick({ position: { x: 12, y: 8 } });
  await popover.getByText(/train/i).waitFor({ timeout: 15_000 });
  t.diagnostic(`Warm word selection ${Math.round(performance.now() - started)} ms`);

  const frame = page.frameLocator('[title="German excerpt"]');
  await frame.locator('#framed').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
  });
  await frame.getByRole('status', { name: 'English translation' }).getByText(/thank you/i).waitFor({ timeout: 3_000 });

  const viewer = await context.newPage();
  await viewer.goto(viewerUrl);
  await viewer.locator('input[type=file]').setInputFiles({
    name: 'Beispiel.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf(),
  });
  const original = viewer.getByRole('region', { name: 'Original PDF' });
  const translated = viewer.getByRole('region', { name: 'English PDF' });
  await original.locator('canvas').waitFor();
  await translated.locator('.pdf-translation-text').filter({ hasText: /good morning/i }).waitFor({ timeout: 30_000 });
  await translated.locator('.pdf-translation-text').filter({ hasText: /thank you/i }).waitFor();
  const originalBox = await original.boundingBox();
  const translatedBox = await translated.boundingBox();
  assert.ok(originalBox.x < translatedBox.x);
  const canvases = await viewer.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => {
    const x = Math.floor(canvas.width * 380 / 480);
    const y = Math.floor(canvas.height * 140 / 760);
    const context = canvas.getContext('2d');
    const figure = Array.from(context.getImageData(x, y, 1, 1).data);
    const title = Array.from(context.getImageData(0, 0, canvas.width / 2, canvas.height / 8).data);
    return { figure, darkPixels: title.filter((channel, index) => index % 4 === 0 && channel < 120).length };
  }));
  assert.equal(canvases.length, 2);
  assert.deepEqual(canvases[0].figure, canvases[1].figure);
  assert.ok(canvases[0].figure[2] > 130 && canvases[0].figure[0] < 50, 'figure color survived the text replacement');
  assert.ok(canvases[0].darkPixels > 50, 'the original heading is painted');
  assert.equal(canvases[1].darkPixels, 0, 'the right canvas omits the native heading');

  await viewer.getByLabel('Zoom').selectOption('1.25');
  await translated.locator('.pdf-translation-text').filter({ hasText: /good morning/i }).waitFor();
  if (process.env.TEXTBRUCKE_QA_SCREENSHOT) await viewer.screenshot({ path: process.env.TEXTBRUCKE_QA_SCREENSHOT });

  await viewer.getByRole('button', { name: 'Next page' }).click();
  await viewer.getByRole('textbox', { name: 'Page number' }).waitFor();
  assert.equal(await viewer.getByRole('textbox', { name: 'Page number' }).inputValue(), '2');
  await translated.locator('.pdf-translation-text').filter({ hasText: /good night/i }).waitFor();
  await viewer.getByRole('button', { name: 'Next page' }).click();
  await translated.getByText('Text view for this page').waitFor({ timeout: 3_000 });
  await translated.getByText(/good morning/i).waitFor();

  await context.setOffline(false);
  const popup = await context.newPage();
  const pdfTab = await context.newPage();
  await pdfTab.goto(`${base}/document`);
  await clickToolbar(pdfTab);
  await popup.goto(new URL('/popup.html', viewerUrl).href);
  const ready = context.waitForEvent('page');
  await popup.getByRole('button', { name: 'Translate PDF in this tab' }).click();
  const remote = await ready;
  await remote.waitForURL(`${viewerUrl}?*`);
  await remote.locator('.pdf-translation-text').filter({ hasText: /good morning/i }).waitFor({ timeout: 30_000 });

  const imagePage = await context.newPage();
  async function translateImage(kind) {
    await context.setOffline(false);
    await imagePage.goto(`${base}/ocr-${kind}`);
    const srcUrl = await imagePage.locator('img').evaluate(async (image) => {
      await image.decode();
      return image.currentSrc;
    });
    await clickToolbar(imagePage);
    await context.setOffline(true);
    const ready = context.waitForEvent('page');
    await background.evaluate(async ({ srcUrl, pageUrl }) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.setZoom(tab.id, 1.25);
      globalThis.clickImageMenuForTest({
        menuItemId: 'translate-image', mediaType: 'image', srcUrl, pageUrl, frameId: 0,
      }, tab);
    }, { srcUrl, pageUrl: imagePage.url() });
    return ready;
  }

  const germanImage = await translateImage('german');
  const englishText = germanImage.getByRole('region', { name: 'English translation' });
  await englishText.getByText(/good morning/i).waitFor({ timeout: 30_000 });
  const recognized = germanImage.getByRole('region', { name: 'Recognized text' });
  await recognized.getByText(/Schön.*öffnet/is).waitFor();
  assert.doesNotMatch(await recognized.innerText(), /neighboring|clipped/i);
  const [cropWidth, cropHeight] = await germanImage.locator('#captured-image').evaluate((image) => [
    image.naturalWidth, image.naturalHeight,
  ]);
  assert.ok(Math.abs(cropWidth - 950) <= 1 && Math.abs(cropHeight - 300) <= 1,
    `expected a 760×240 CSS pixel crop at 125% zoom, got ${cropWidth}×${cropHeight}`);

  const englishImage = await translateImage('english');
  await englishImage.getByRole('status').getByText(/appears to be English/i).waitFor();
  assert.equal(await englishImage.getByRole('region', { name: 'English translation' }).isVisible(), false);
  assert.equal(await englishImage.getByRole('button', { name: 'Translate as German' }).isVisible(), false);

  const ambiguousImage = await translateImage('uncertain');
  await ambiguousImage.getByRole('button', { name: 'Translate as German' }).click();
  await ambiguousImage.getByRole('region', { name: 'English translation' }).getByText('12345').waitFor();

  const blankImage = await translateImage('blank');
  await blankImage.getByRole('status').getByText(/no readable text/i).waitFor();
});
