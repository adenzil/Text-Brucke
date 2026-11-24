import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranslationQueue } from '../lib/translation-queue.ts';

test('selection translation runs before the next document translation', async () => {
  const calls: string[] = [];
  const first = Promise.withResolvers<string>();
  const translate = createTranslationQueue((text) => {
    calls.push(text);
    return text === 'Eins' ? first.promise : Promise.resolve(text.toUpperCase());
  });

  const active = translate('Eins', 'document');
  const waiting = translate('Zwei', 'document');
  const selection = translate('Drei', 'selection');
  first.resolve('One');

  assert.deepEqual(await Promise.all([active, waiting, selection]), ['One', 'ZWEI', 'DREI']);
  assert.deepEqual(calls, ['Eins', 'Drei', 'Zwei']);
});

test('a pending document translation can be promoted by the same selection', async () => {
  const calls: string[] = [];
  const first = Promise.withResolvers<string>();
  const translate = createTranslationQueue((text) => {
    calls.push(text);
    return text === 'Eins' ? first.promise : Promise.resolve(text.toUpperCase());
  });

  const active = translate('Eins', 'document');
  const waiting = translate('Zwei', 'document');
  const shared = translate('Drei', 'document');
  const selection = translate('Drei', 'selection');
  first.resolve('One');

  assert.deepEqual(await Promise.all([active, waiting, shared, selection]), ['One', 'ZWEI', 'DREI', 'DREI']);
  assert.deepEqual(calls, ['Eins', 'Drei', 'Zwei']);
});

test('repeated text shares the active request and reuses the cached result', async () => {
  let calls = 0;
  const translate = createTranslationQueue(async () => {
    calls++;
    return 'Good morning';
  });

  assert.deepEqual(await Promise.all([translate('Guten Morgen'), translate('Guten Morgen')]), [
    'Good morning',
    'Good morning',
  ]);
  assert.equal(await translate('Guten Morgen'), 'Good morning');
  assert.equal(calls, 1);
});

test('failed translation leaves the queue usable and can be retried', async () => {
  let fail = true;
  const translate = createTranslationQueue(async (text) => {
    if (fail) {
      fail = false;
      throw new Error('Worker unavailable');
    }
    return text.toUpperCase();
  });

  const failed = translate('Eins');
  const waiting = translate('Zwei');
  await assert.rejects(failed, /Worker unavailable/);
  assert.equal(await waiting, 'ZWEI');
  assert.equal(await translate('Eins'), 'EINS');
});
