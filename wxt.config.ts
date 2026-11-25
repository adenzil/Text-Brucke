import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Textbrücke',
    description: 'Translate German text and images and read PDFs side by side in English, entirely on your device.',
    minimum_chrome_version: '145',
    permissions: ['activeTab', 'scripting', 'offscreen', 'contextMenus'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
  },
  hooks: {
    async 'build:publicAssets'(wxt, files) {
      for (const [source, name] of [
        ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
        ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt'],
        ['tesseract.js/LICENSE.md', 'LICENSE.tesseract.js'],
        ['tesseract.js-core/LICENSE', 'LICENSE.tesseract.js-core'],
        ['tesseract.js-core/tesseract-core-lstm.js', 'tesseract-core-lstm.js'],
        ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
      ] as const) {
        files.push({ absoluteSrc: resolve(wxt.config.root, 'node_modules', source), relativeDest: `ocr/${name}` });
      }

      const pdfjs = resolve(wxt.config.root, 'node_modules/pdfjs-dist');
      for (const relativePath of ['LICENSE', 'build/pdf.worker.mjs']) {
        files.push({ absoluteSrc: resolve(pdfjs, relativePath), relativeDest: `pdfjs/${relativePath}` });
      }
      for (const directory of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
        const entries = await readdir(resolve(pdfjs, directory), { withFileTypes: true });
        for (const entry of entries.filter((entry) => entry.isFile())) {
          const relativePath = `${directory}/${entry.name}`;
          files.push({ absoluteSrc: resolve(pdfjs, relativePath), relativeDest: `pdfjs/${relativePath}` });
        }
      }
    },
  },
});
