import { defineContentScript } from 'wxt/utils/define-content-script';
import { translateText } from '../lib/translation';
import styles from '../styles/selection.css?inline';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  main(context) {
    const host = document.createElement('div');
    host.hidden = true;
    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
    root.adoptedStyleSheets = [sheet];

    const card = document.createElement('div');
    card.className = 'popover';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-label', 'English translation');
    const label = document.createElement('span');
    label.className = 'language';
    label.textContent = 'DE → EN';
    const result = document.createElement('div');
    result.className = 'result';
    result.lang = 'en';
    card.append(label, result);
    root.append(card);
    document.documentElement.append(host);

    let timer: number | undefined;
    let revision = 0;
    let pressed = false;
    let lastText = '';
    let copying = false;

    function hide() {
      window.clearTimeout(timer);
      revision += 1;
      lastText = '';
      host.hidden = true;
    }

    function position(rect: DOMRect) {
      const bounds = card.getBoundingClientRect();
      const margin = 10;
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - bounds.width - margin));
      const below = rect.bottom + 8;
      const top = below + bounds.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, rect.top - bounds.height - 8);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }

    function update() {
      const selection = document.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (!selection || selection.isCollapsed || !text || !selection.rangeCount) {
        hide();
        return;
      }
      const range = selection.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const element = common instanceof Element ? common : common.parentElement;
      if (element?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) {
        hide();
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        hide();
        return;
      }

      if (text === lastText && !host.hidden) {
        position(rect);
        return;
      }
      const request = ++revision;
      lastText = text;
      const oversized = text.length > 8_000;
      result.textContent = oversized ? 'Select a shorter passage.' : 'Translating…';
      host.hidden = false;
      position(rect);
      if (oversized) return;

      const finish = (message: string) => {
        if (request !== revision || document.getSelection()?.toString().trim() !== text) return;
        result.textContent = message;
        position(range.getBoundingClientRect());
      };
      void translateText(text).then(finish, (error: unknown) => {
        finish(error instanceof Error ? error.message : 'Translation failed. Reselect the text to retry.');
        lastText = '';
      });
    }

    function schedule() {
      window.clearTimeout(timer);
      if (!pressed && !copying) timer = window.setTimeout(update, 80);
    }

    context.addEventListener(document, 'pointerdown', (event) => {
      copying = event.composedPath().includes(host);
      if (copying) {
        window.clearTimeout(timer);
        return;
      }
      pressed = true;
      hide();
    }, { capture: true });
    context.addEventListener(window, 'pointerup', (event) => {
      if (event.composedPath().includes(host)) return;
      pressed = false;
      schedule();
    }, { capture: true });
    context.addEventListener(window, 'pointercancel', () => {
      pressed = false;
      schedule();
    }, { capture: true });
    context.addEventListener(document, 'selectionchange', schedule);
    context.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape') hide();
    }, { capture: true });
    context.addEventListener(window, 'resize', hide);
    context.addEventListener(window, 'blur', () => {
      pressed = false;
      copying = false;
      hide();
    });
    context.addEventListener(window, 'scroll', hide, { capture: true, passive: true });
    context.onInvalidated(() => {
      hide();
      host.remove();
    });
  },
});
