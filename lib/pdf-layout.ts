import { OPS } from 'pdfjs-dist';
import type { PageViewport, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { OperationsFilter, TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';

type TextBox = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
};

export type LayoutBlock = TextBox & { id: string };
export type PageLayout = { blocks: LayoutBlock[]; unsupportedGeometry: boolean };

type Run = TextBox & { baseline: number; spaceBefore: boolean; spaceAfter: boolean };
type Line = TextBox & { baseline: number };
type Matrix = [number, number, number, number, number, number];

function toRun(item: TextItem, style: TextStyle | undefined, viewport: PageViewport): Run | null {
  const [a, b, c, d, e, f] = viewport.transform as Matrix;
  const [xScale, xSkew, ySkew, yScale, x, y] = item.transform as Matrix;
  const across = a * xScale + c * xSkew;
  const slope = b * xScale + d * xSkew;
  const lean = a * ySkew + c * yScale;
  const rise = b * ySkew + d * yScale;
  const fontSize = Math.hypot(lean, rise);
  const rawLeft = a * x + c * y + e;
  const baseline = b * x + d * y + f;
  const width = Math.abs(item.width) * Math.hypot(a, b);

  if (style?.vertical || item.dir !== 'ltr' || across <= 0 || rise >= 0 ||
    Math.abs(slope) > across * 0.12 || Math.abs(lean) > fontSize * 0.25 ||
    ![fontSize, rawLeft, baseline, width].every(Number.isFinite) || width <= 0 || fontSize <= 0) {
    return null;
  }

  const ascent = style?.ascent && style.ascent > 0 ? style.ascent : 0.8;
  const rawTop = baseline - fontSize * ascent;
  const left = Math.max(0, rawLeft);
  const top = Math.max(0, rawTop);
  return {
    text: item.str.trim(),
    left,
    top,
    width: Math.min(rawLeft + width, viewport.width) - left,
    height: Math.min(rawTop + fontSize, viewport.height) - top,
    fontSize,
    fontFamily: style?.fontFamily || 'sans-serif',
    baseline,
    spaceBefore: /^\s/.test(item.str),
    spaceAfter: /\s$/.test(item.str),
  };
}

function extendBox(box: TextBox, other: TextBox, separator: string) {
  const right = Math.max(box.left + box.width, other.left + other.width);
  const bottom = Math.max(box.top + box.height, other.top + other.height);
  box.left = Math.min(box.left, other.left);
  box.top = Math.min(box.top, other.top);
  box.width = right - box.left;
  box.height = bottom - box.top;
  box.text += separator + other.text;
}

function linesFromRuns(runs: Run[]): Line[] {
  const rows: Run[][] = [];
  for (const run of runs.sort((left, right) => left.baseline - right.baseline || left.left - right.left)) {
    const previous = rows.at(-1);
    const anchor = previous?.[0];
    if (anchor && run.baseline - anchor.baseline <= Math.min(anchor.fontSize, run.fontSize) * 0.3) {
      previous.push(run);
    } else {
      rows.push([run]);
    }
  }

  const lines: Line[] = [];
  for (const row of rows) {
    let line: Line | undefined;
    let previous: Run | undefined;
    for (const run of row.sort((left, right) => left.left - right.left)) {
      const gap = line ? run.left - (line.left + line.width) : 0;
      if (line && previous && gap <= Math.min(previous.fontSize, run.fontSize) * 1.05) {
        const space = previous.spaceAfter || run.spaceBefore || gap > run.fontSize * 0.12;
        extendBox(line, run, space ? ' ' : '');
      } else {
        const { baseline, text, left, top, width, height, fontSize, fontFamily } = run;
        line = { baseline, text, left, top, width, height, fontSize, fontFamily };
        lines.push(line);
      }
      previous = run;
    }
  }
  return lines;
}

function blocksFromLines(lines: Line[]): TextBox[] {
  const groups: Array<{ box: TextBox; last: Line }> = [];
  let active: typeof groups = [];

  // Sparse rows and large gaps are kept separate to avoid collapsing table entries.
  for (const line of lines) {
    active = active.filter(group => line.baseline - group.last.baseline <= group.last.fontSize * 1.65);
    const paragraph = active.findLast(({ last }) => {
      const gap = line.baseline - last.baseline;
      return gap >= last.fontSize * 0.75 &&
        Math.abs(last.left - line.left) <= last.fontSize * 0.65 &&
        Math.abs(last.fontSize - line.fontSize) <= last.fontSize * 0.16 &&
        last.text.length >= 20 &&
        !/^(?:[•▪◦●*–-]|\d+[.)])\s/.test(line.text);
    });

    if (paragraph) {
      if (paragraph.box.text.endsWith('\u00ad')) paragraph.box.text = paragraph.box.text.slice(0, -1);
      else if (!paragraph.box.text.endsWith('-')) {
        paragraph.box.text += ' ';
      }
      extendBox(paragraph.box, line, '');
      paragraph.last = line;
    } else {
      const { baseline: _baseline, ...box } = line;
      const group = { box, last: line };
      groups.push(group);
      active.push(group);
    }
  }

  return groups.map(group => group.box);
}

export async function extractLayout(page: Pick<PDFPageProxy, 'getTextContent'>, viewport: PageViewport): Promise<PageLayout> {
  const { items, styles } = await page.getTextContent();
  const runs: Run[] = [];
  const fallback: TextBox[] = [];
  for (const item of items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const run = toRun(item, styles[item.fontName], viewport);
    if (!run) {
      fallback.push({ text: item.str.trim(), left: 0, top: 0, width: 0, height: 0, fontSize: 0, fontFamily: 'sans-serif' });
    } else if (run.width > 0 && run.height > 0) {
      runs.push(run);
    }
  }

  const boxes = [...blocksFromLines(linesFromRuns(runs)), ...fallback];
  return {
    blocks: boxes.map((box, index) => ({ ...box, id: `block-${index + 1}` })),
    unsupportedGeometry: fallback.length > 0,
  };
}

const textPaintOperators = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);

function createTextPaintFilter(onTextClipping?: () => void): OperationsFilter {
  let annotation = false;
  let textRenderingMode = 0;
  const savedModes: number[] = [];

  return (index, { fnArray, argsArray }) => {
    const op = fnArray[index];
    if (op === undefined) return true;
    switch (op) {
      case OPS.beginAnnotation:
        annotation = true;
        break;
      case OPS.endAnnotation:
        annotation = false;
        break;
      case OPS.save:
      case OPS.paintFormXObjectBegin:
      case OPS.beginGroup:
        savedModes.push(textRenderingMode);
        break;
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
      case OPS.endGroup:
        textRenderingMode = savedModes.pop() ?? 0;
        break;
      case OPS.setTextRenderingMode:
        if (!annotation) textRenderingMode = Number(argsArray[index]?.[0] ?? 0);
        break;
    }

    if (annotation || !textPaintOperators.has(op)) return true;
    // PDF text rendering modes 4–7 use glyphs as a clipping path.
    if (textRenderingMode < 4) return false;
    onTextClipping?.();
    return true;
  };
}

export function renderPdfPage(
  page: Pick<PDFPageProxy, 'render'>,
  viewport: PageViewport,
  canvas: HTMLCanvasElement,
  { omitText = false, pixelRatio = 1, onTextClipping }: {
    omitText?: boolean;
    pixelRatio?: number;
    onTextClipping?: () => void;
  } = {},
): RenderTask {
  const ratio = Math.min(pixelRatio, Math.sqrt(16_777_216 / (viewport.width * viewport.height)), 16_384 / Math.max(viewport.width, viewport.height));
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  return page.render({
    canvas,
    viewport,
    transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
    operationsFilter: omitText ? createTextPaintFilter(onTextClipping) : undefined,
  });
}

function backgroundTextColor(canvas: HTMLCanvasElement | undefined): (block: LayoutBlock) => string {
  const darkText = '#161616';
  if (!canvas?.width || !canvas.height || !canvas.clientWidth || !canvas.clientHeight) return () => darkText;

  const thumbnail = canvas.ownerDocument.createElement('canvas');
  thumbnail.width = 96;
  thumbnail.height = 96;
  const context = thumbnail.getContext('2d', { willReadFrequently: true });
  if (!context) return () => darkText;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.drawImage(canvas, 0, 0, 96, 96);
  const pixels = context.getImageData(0, 0, 96, 96).data;
  return ({ left, top, width: boxWidth, height: boxHeight }) => {
    let lightness = 0;
    const y = Math.min(95, Math.floor((top + boxHeight / 2) * 96 / height));
    for (const fraction of [0.2, 0.5, 0.8]) {
      const x = Math.min(95, Math.floor((left + boxWidth * fraction) * 96 / width));
      const offset = (y * 96 + x) * 4;
      lightness += (pixels[offset] ?? 255) * 0.2126 + (pixels[offset + 1] ?? 255) * 0.7152 +
        (pixels[offset + 2] ?? 255) * 0.0722;
    }
    return lightness / 3 < 133 ? '#fff' : darkText;
  };
}

function addOverflowButton(box: HTMLElement, copy: HTMLElement, block: LayoutBlock) {
  const doc = box.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'pdf-translation-more';
  button.textContent = '…';
  button.title = 'Show full translation';
  button.setAttribute('aria-label', 'Show full translation');

  const size = Math.min(block.width, block.height, 22);
  copy.style.paddingRight = `${size}px`;
  Object.assign(button.style, {
    position: 'absolute', right: '0', bottom: '0', width: `${size}px`, height: `${size}px`, minHeight: '0',
    display: 'grid', placeItems: 'center', padding: '0', border: '0', borderRadius: '3px',
    background: '#174e77', color: '#fff', cursor: 'pointer', font: 'bold 11px/1 system-ui',
  });

  const panel = doc.createElement('div');
  panel.className = 'pdf-translation-popover';
  panel.popover = 'auto';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Full translation');
  Object.assign(panel.style, {
    pointerEvents: 'auto', width: 'min(32rem, calc(100vw - 3rem))', maxHeight: 'min(32rem, 70vh)',
    boxSizing: 'border-box', padding: '1.1rem', border: '1px solid #9ca7ad', borderRadius: '9px',
    boxShadow: '0 8px 30px #0003', background: '#fff', color: '#161616',
    font: '1rem/1.5 system-ui, sans-serif', overflow: 'auto',
  });

  const text = doc.createElement('p');
  text.textContent = copy.textContent;
  Object.assign(text.style, { margin: '0 0 1rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
  const close = doc.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.autofocus = true;
  close.popoverTargetElement = panel;
  close.popoverTargetAction = 'hide';
  panel.append(text, close);
  button.popoverTargetElement = panel;
  box.append(button, panel);
}

const shownLayouts = new WeakMap<HTMLElement, {
  blocks: readonly LayoutBlock[];
  background: HTMLCanvasElement | undefined;
  textColor: ReturnType<typeof backgroundTextColor>;
}>();

export function showTranslations(
  layer: HTMLElement,
  blocks: readonly LayoutBlock[],
  translations: ReadonlyMap<string, string>,
  background?: HTMLCanvasElement,
): void {
  const doc = layer.ownerDocument;
  const boxes: Array<{ box: HTMLElement; copy: HTMLElement; block: LayoutBlock }> = [];
  let layout = shownLayouts.get(layer);
  if (!layout || layout.blocks !== blocks || layout.background !== background) {
    layout = { blocks, background, textColor: backgroundTextColor(background) };
    shownLayouts.set(layer, layout);
    layer.replaceChildren();
    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    layer.lang = 'en';
  }

  const existing = new Map(Array.from(layer.children, child => [child.getAttribute('data-block-id'), child]));
  let cursor = layer.firstElementChild;
  for (const block of blocks) {
    const english = translations.get(block.id);
    if (!english || block.width <= 0 || block.height <= 0) continue;

    const previous = existing.get(block.id);
    if (previous?.firstElementChild?.textContent === english) {
      existing.delete(block.id);
      cursor = previous.nextElementSibling;
      continue;
    }

    const box = doc.createElement('div');
    box.className = 'pdf-translation-block';
    box.dataset.blockId = block.id;
    Object.assign(box.style, {
      position: 'absolute', left: `${block.left}px`, top: `${block.top}px`, width: `${block.width}px`,
      height: `${block.height}px`, color: layout.textColor(block), fontFamily: block.fontFamily,
      pointerEvents: 'auto', userSelect: 'text',
    });

    const copy = doc.createElement('div');
    copy.className = 'pdf-translation-text';
    copy.textContent = english;
    Object.assign(copy.style, {
      fontSize: `${Math.min(block.fontSize, block.height)}px`, lineHeight: '1', maxHeight: '100%',
      overflow: 'hidden', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', boxSizing: 'border-box',
    });
    box.append(copy);
    layer.insertBefore(box, cursor);
    boxes.push({ box, copy, block });
  }
  for (const obsolete of existing.values()) obsolete.remove();

  for (const { box, copy, block } of boxes) {
    const fits = () => copy.scrollHeight <= copy.clientHeight && copy.scrollWidth <= copy.clientWidth;
    if (fits()) continue;

    let largest = Math.min(block.fontSize, block.height);
    let smallest = Math.min(largest, Math.max(8, block.fontSize * 0.68));
    copy.style.fontSize = `${smallest}px`;
    if (!fits()) {
      addOverflowButton(box, copy, block);
      continue;
    }

    for (let step = 0; step < 4; step++) {
      const size = (smallest + largest) / 2;
      copy.style.fontSize = `${size}px`;
      if (fits()) smallest = size;
      else largest = size;
    }
    copy.style.fontSize = `${smallest}px`;
  }
}
