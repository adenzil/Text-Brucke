import assert from 'node:assert/strict';
import test from 'node:test';
import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { RenderParameters, TextItem } from 'pdfjs-dist/types/src/display/api';
import { extractLayout, renderPdfPage } from '../lib/pdf-layout.ts';

type Viewport = ReturnType<PDFPageProxy['getViewport']>;

function viewport(scale = 1): Viewport {
  return { transform: [scale, 0, 0, -scale, 0, 600 * scale], width: 500 * scale, height: 600 * scale } as Viewport;
}

function run(str: string, left: number, baseline: number, width: number, fontSize = 10): TextItem {
  return {
    str,
    dir: 'ltr',
    transform: [fontSize, 0, 0, fontSize, left, 600 - baseline],
    width,
    height: fontSize,
    fontName: 'font',
    hasEOL: false,
  };
}

function pageWith(items: TextItem[]): Pick<PDFPageProxy, 'getTextContent'> {
  return {
    getTextContent: async () => ({ items, styles: { font: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } }, lang: 'de' }),
  };
}

test('joins fragments and successive prose lines within a column', async () => {
  const page = pageWith([
    run('Zweiter Absatz steht in der rechten Spalte.', 270, 50, 190),
    run('Dieser Absatz steht', 30, 50, 86),
    run('in der linken Spalte', 118, 50, 85),
    run('und endet hier.', 30, 62, 72),
    run('Er endet hier.', 270, 62, 63),
  ]);

  const layout = await extractLayout(page, viewport(2));
  assert.equal(layout.unsupportedGeometry, false);
  assert.deepEqual(layout.blocks.map(({ text, left, top, width, height }) => ({ text, left, top, width, height })), [
    { text: 'Dieser Absatz steht in der linken Spalte und endet hier.', left: 60, top: 84, width: 346, height: 44 },
    { text: 'Zweiter Absatz steht in der rechten Spalte. Er endet hier.', left: 540, top: 84, width: 380, height: 44 },
  ]);
});

test('keeps aligned short table cells as individual blocks', async () => {
  const layout = await extractLayout(pageWith([
    run('Artikel', 30, 50, 29),
    run('Preis', 180, 50, 22),
    run('Buch', 30, 63, 23),
    run('17,50 €', 180, 63, 34),
  ]), viewport());

  assert.deepEqual(layout.blocks.map(block => block.text), ['Artikel', 'Preis', 'Buch', '17,50 €']);
});

test('keeps rotated text available for the page fallback', async () => {
  const rotated = { ...run('Randnotiz', 490, 50, 43), transform: [0, 10, -10, 0, 490, 550] };
  const layout = await extractLayout(pageWith([run('Überschrift', 30, 40, 50), rotated]), viewport());

  assert.equal(layout.unsupportedGeometry, true);
  assert.deepEqual(layout.blocks.map(block => block.text), ['Überschrift', 'Randnotiz']);
});

test('filters native text paint while keeping graphics and annotation appearances', () => {
  const canvas = { style: {} } as HTMLCanvasElement;
  let parameters: RenderParameters | undefined;
  const page = {
    render(options: RenderParameters) {
      parameters = options;
      return {} as ReturnType<PDFPageProxy['render']>;
    },
  };
  renderPdfPage(page, viewport(), canvas, { omitText: true, pixelRatio: 2 });

  assert.equal(canvas.width, 1000);
  assert.deepEqual(parameters?.transform, [2, 0, 0, 2, 0, 0]);
  const fnArray = [OPS.setFont, OPS.showText, OPS.paintImageXObject, OPS.stroke, OPS.beginAnnotation, OPS.showText, OPS.endAnnotation, OPS.showSpacedText];
  const operatorList = { fnArray, argsArray: fnArray.map(() => []), lastChunk: true };
  const kept = fnArray.filter((_, index) => parameters?.operationsFilter?.(index, operatorList));
  assert.deepEqual(kept, [OPS.setFont, OPS.paintImageXObject, OPS.stroke, OPS.beginAnnotation, OPS.showText, OPS.endAnnotation]);
});
