import assert from 'node:assert/strict';
import test from 'node:test';
import { detectImageLanguage, scaleImageCrop, splitImageText } from '../lib/image-translation.ts';

test('scales the visible image bounds into screenshot pixels and clamps to the screenshot', () => {
  assert.deepEqual(scaleImageCrop({
    left: 90.5, top: 55, right: 322, bottom: 170,
    viewport: { left: 10, top: 30, width: 300, height: 200 },
  }, 600, 400), { x: 161, y: 50, width: 439, height: 230 });

  assert.equal(scaleImageCrop({
    left: 0, top: 220, right: 50, bottom: 240,
    viewport: { left: 0, top: 0, width: 300, height: 200 },
  }, 600, 400), undefined);
});

test('returns a language only for reliable results with at least 80 percent coverage', () => {
  assert.equal(detectImageLanguage({
    isReliable: true, languages: [{ language: 'de', percentage: 80 }, { language: 'en', percentage: 20 }],
  }), 'de');
  assert.equal(detectImageLanguage({
    isReliable: true, languages: [{ language: 'en', percentage: 100 }],
  }), 'en');
  assert.equal(detectImageLanguage({
    isReliable: true, languages: [{ language: 'de', percentage: 65 }, { language: 'en', percentage: 35 }],
  }), undefined);
  assert.equal(detectImageLanguage({
    isReliable: false, languages: [{ language: 'de', percentage: 100 }],
  }), undefined);
  assert.equal(detectImageLanguage({
    isReliable: true, languages: [{ language: 'und', percentage: 100 }],
  }), undefined);
});

test('keeps long image text within the translation message limit', () => {
  const paragraph = 'Straße '.repeat(900).trim();
  assert.deepEqual(splitImageText(`${paragraph}\n\n${paragraph}`), [paragraph, paragraph]);
  assert.deepEqual(splitImageText('abc'), ['abc']);
  const oversizedLine = 'ä'.repeat(7_999) + '😀' + 'Ende';
  const chunks = splitImageText(oversizedLine);
  assert.equal(chunks.join(''), oversizedLine);
  assert.ok(chunks.every((chunk) => chunk.length <= 8_000 && !/[\uD800-\uDBFF]$/u.test(chunk)));
});
