# Textbrücke

A Chrome extension for German-to-English reading. Select a word or phrase on a web page for an inline translation, or open a PDF to read the original and English pages side by side.

## Install

Use desktop Chrome 145 or later. To build from source with Node.js 24 or later, run:

```sh
npm ci
npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, and choose **Load unpacked**. Select `.output/chrome-mv3`.

## Use

- **Web page** — Click Textbrücke in the Chrome toolbar once on the page you want to use, then close the menu and select German text. Click the toolbar icon again after loading a new page. Press Escape to dismiss the translation.
- **PDF open in Chrome** — Open the extension toolbar menu and choose **Translate PDF in this tab**.
- **Local PDF** — Choose **Open a local PDF** in the extension toolbar menu, then select the file. Use this route for downloaded PDFs and web PDFs that cannot be fetched again from their original URL.

The English pane translates the current page as you read. It keeps graphics and places English in the source text areas where possible. Use **Show full translation** on an overflowing block to read the full passage. Pages whose text geometry cannot be reproduced get an English text view. Image-only scans require a selectable text layer before they can be translated.

Both translation features work offline from first use. The extension bundles its model and runtime and keeps selected text and PDF translations on the device. Opening a web PDF requires access to its original URL. [Model, engine, and license information](public/translation/NOTICE.md)

Textbrücke uses Chrome’s temporary access to the tab when you click the toolbar icon. Selection translation is available on ordinary web pages and permitted frames within that tab. For Chrome’s built-in PDF viewer, use **Translate PDF in this tab** and keep the source tab open while the document loads. [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

## Verify

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:browser
```

The browser test uses a fresh profile and switches Chrome offline before the first translation. It also checks the English PDF canvas against the original for preserved artwork and removed German glyphs. Run `npm run zip` to produce the distributable Chrome archive in `.output`.
