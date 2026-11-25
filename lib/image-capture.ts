import { browser } from 'wxt/browser';
import type { Browser } from 'wxt/browser';
import { scaleImageCrop } from './image-translation';
import type { ImageTranslationInput, VisibleImage } from './image-translation';

const MENU_ID = 'translate-image';
const RETRY_IMAGE = 'The image could not be captured. Bring it into view or open it in its own tab, then right-click it again.';

// Chrome serializes this function to run in the page's isolated world.
function findVisibleImage(src: string, pageUrl: string): Promise<VisibleImage | undefined> {
  const images = Array.from(document.images).filter((image) =>
    image.currentSrc === src && image.complete && image.naturalWidth > 0 &&
    getComputedStyle(image).visibility === 'visible');
  if (location.href !== pageUrl || images.length === 0) return Promise.resolve(undefined);

  function renderedBounds(image: HTMLImageElement, box: DOMRectReadOnly) {
    if (!image.offsetWidth || !image.offsetHeight) return;
    const style = getComputedStyle(image);
    const scaleX = box.width / image.offsetWidth;
    const scaleY = box.height / image.offsetHeight;
    const px = Number.parseFloat;
    let left = box.left + (px(style.borderLeftWidth) + px(style.paddingLeft)) * scaleX;
    let top = box.top + (px(style.borderTopWidth) + px(style.paddingTop)) * scaleY;
    let right = box.right - (px(style.borderRightWidth) + px(style.paddingRight)) * scaleX;
    let bottom = box.bottom - (px(style.borderBottomWidth) + px(style.paddingBottom)) * scaleY;
    if (right <= left || bottom <= top) return;

    // The element box includes letterboxing when the fitted image is smaller.
    if (['contain', 'scale-down', 'none'].includes(style.objectFit)) {
      const width = (right - left) / scaleX;
      const height = (bottom - top) / scaleY;
      const contain = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const fit = style.objectFit === 'contain' ? contain : style.objectFit === 'scale-down' ? Math.min(1, contain) : 1;
      const positions = style.objectPosition.split(/\s+/u);
      if (positions.length !== 2) return;
      const position = (freeSpace: number, value: string) =>
        value.endsWith('%') ? freeSpace * px(value) / 100 : value.endsWith('px') ? px(value) : NaN;
      const fittedWidth = image.naturalWidth * fit;
      const fittedHeight = image.naturalHeight * fit;
      const fittedLeft = left + position(width - fittedWidth, positions[0]!) * scaleX;
      const fittedTop = top + position(height - fittedHeight, positions[1]!) * scaleY;
      if (!Number.isFinite(fittedLeft) || !Number.isFinite(fittedTop)) return;
      left = Math.max(left, fittedLeft);
      top = Math.max(top, fittedTop);
      right = Math.min(right, fittedLeft + fittedWidth * scaleX);
      bottom = Math.min(bottom, fittedTop + fittedHeight * scaleY);
    }
    return { left, top, right, bottom };
  }

  return new Promise((resolve) => {
    const matches: VisibleImage[] = [];
    let remaining = images.length;
    const observer = new IntersectionObserver((entries) => {
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: window.innerWidth / (visual?.scale ?? 1),
        height: window.innerHeight / (visual?.scale ?? 1),
      };
      for (const { target, boundingClientRect, intersectionRect } of entries) {
        const image = renderedBounds(target as HTMLImageElement, boundingClientRect);
        if (!image) continue;
        const left = Math.max(intersectionRect.left, image.left, viewport.left);
        const top = Math.max(intersectionRect.top, image.top, viewport.top);
        const right = Math.min(intersectionRect.right, image.right, viewport.left + (visual?.width ?? viewport.width));
        const bottom = Math.min(intersectionRect.bottom, image.bottom, viewport.top + (visual?.height ?? viewport.height));
        if (right <= left || bottom <= top) continue;
        if (document.elementFromPoint((left + right) / 2, (top + bottom) / 2) !== target) continue;
        matches.push({ left, top, right, bottom, viewport });
      }
      remaining -= entries.length;
      if (remaining <= 0) {
        clearTimeout(deadline);
        observer.disconnect();
        resolve(matches.length === 1 ? matches[0] : undefined);
      }
    });
    const deadline = window.setTimeout(() => {
      observer.disconnect();
      resolve(undefined);
    }, 1_000);
    for (const image of images) observer.observe(image);
  });
}

async function cropScreenshot(screenshot: string, image: VisibleImage) {
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob());
  try {
    const crop = scaleImageCrop(image, bitmap.width, bitmap.height);
    if (!crop) throw new Error(RETRY_IMAGE);
    const scale = Math.min(1, Math.sqrt(12_000_000 / (crop.width * crop.height)));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(crop.width * scale)), Math.max(1, Math.floor(crop.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error(RETRY_IMAGE);
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8_192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  } finally {
    bitmap.close();
  }
}

async function captureImage(info: Browser.contextMenus.OnClickData, tabId: number, windowId: number) {
  if ((info.frameId ?? 0) !== 0) {
    return { error: 'Image translation is available for images on the main webpage. Try opening the image in its own tab.' };
  }
  const { srcUrl, pageUrl } = info;
  if (!srcUrl || !pageUrl) return { error: RETRY_IMAGE };

  let tabChanged = false;
  const onActivated = (active: Browser.tabs.OnActivatedInfo) => {
    if (active.windowId === windowId && active.tabId !== tabId) tabChanged = true;
  };
  const readImage = async () => {
    const [frame] = await browser.scripting.executeScript({
      target: { tabId },
      func: findVisibleImage,
      args: [srcUrl, pageUrl],
    });
    return frame;
  };

  browser.tabs.onActivated.addListener(onActivated);
  try {
    const before = await readImage();
    if (!before?.result || tabChanged || !(await browser.tabs.get(tabId)).active) return { error: RETRY_IMAGE };
    const screenshot = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    const after = await readImage();
    if (tabChanged || !(await browser.tabs.get(tabId)).active || !after?.result ||
        before.documentId !== after.documentId || JSON.stringify(before.result) !== JSON.stringify(after.result)) {
      return { error: RETRY_IMAGE };
    }
    return { imageUrl: await cropScreenshot(screenshot, before.result) };
  } catch {
    return { error: RETRY_IMAGE };
  } finally {
    browser.tabs.onActivated.removeListener(onActivated);
  }
}

export function registerImageTranslation() {
  const resultsUrl = browser.runtime.getURL('/image.html');
  const pending = new Map<string, ImageTranslationInput>();

  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.remove(MENU_ID).catch(() => {}).then(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: 'Translate image',
        contexts: ['image'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      }, () => {
        if (browser.runtime.lastError) console.error(browser.runtime.lastError.message);
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    const { id, windowId } = tab;
    void captureImage(info, id, windowId).then(async (input) => {
      const token = crypto.randomUUID();
      pending.set(token, input);
      setTimeout(() => pending.delete(token), 30_000);
      try {
        await browser.tabs.create({ url: `${resultsUrl}#${token}`, windowId, openerTabId: id });
      } catch {
        pending.delete(token);
      }
    });
  });

  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'image-translation-input' || sender.id !== browser.runtime.id ||
        sender.url?.split('#', 1)[0] !== resultsUrl || typeof message.token !== 'string') return;
    const input = pending.get(message.token);
    pending.delete(message.token);
    respond(input ?? { error: 'This image is no longer available. Right-click it again to translate it.' });
  });
}
