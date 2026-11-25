type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type VisibleImage = Bounds & {
  viewport: { left: number; top: number; width: number; height: number };
};

export type ImageTranslationInput =
  | { imageUrl: string }
  | { error: string };

export function scaleImageCrop(image: VisibleImage, pixelWidth: number, pixelHeight: number) {
  const { viewport } = image;
  const scaleX = pixelWidth / viewport.width;
  const scaleY = pixelHeight / viewport.height;
  const x = Math.max(0, Math.floor((image.left - viewport.left) * scaleX));
  const y = Math.max(0, Math.floor((image.top - viewport.top) * scaleY));
  const right = Math.min(pixelWidth, Math.ceil((image.right - viewport.left) * scaleX));
  const bottom = Math.min(pixelHeight, Math.ceil((image.bottom - viewport.top) * scaleY));
  if (right <= x || bottom <= y) return;
  return { x, y, width: right - x, height: bottom - y };
}

export function detectImageLanguage(result: {
  isReliable: boolean;
  languages: readonly { language: string; percentage: number }[];
}) {
  if (!result.isReliable) return;
  const language = result.languages.find(({ percentage }) => percentage >= 80)?.language;
  return language === 'und' ? undefined : language;
}

export function splitImageText(text: string) {
  const limit = 8_000;
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const prefix = remaining.slice(0, limit);
    let end = prefix.lastIndexOf('\n');
    if (end < limit / 2) end = prefix.search(/\s\S*$/u);
    if (end < limit / 2) end = /[\uD800-\uDBFF]$/u.test(prefix) ? limit - 1 : limit;
    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
