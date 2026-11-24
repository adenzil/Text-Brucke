const PAIR = { from: 'de', to: 'en' };
const FILES = {
  worker: 'translator-worker.js',
  model: 'model.deen.intgemm.alphas.bin.gz',
  shortlist: 'lex.50.50.deen.s2t.bin.gz',
  vocab: 'vocab.deen.spm.gz',
} as const;

type AssetPath = `/translation/${(typeof FILES)[keyof typeof FILES]}`;

export function createOfflineTranslator(getAssetUrl: (path: AssetPath) => string) {
  let worker: Worker | undefined;
  let requestId = 0;

  async function loadAsset(file: AssetPath) {
    const response = await fetch(getAssetUrl(file));
    if (!response.ok || !response.body) throw new Error('An offline model file is unavailable.');
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  // The queue sends one command at a time using the bundled Bergamot worker's RPC protocol.
  async function call<T>(worker: Worker, name: string, args: unknown[], transfer: Transferable[] = []) {
    const id = ++requestId;
    const listeners = new AbortController();
    const deadline = AbortSignal.timeout(60_000);
    try {
      return await new Promise<T>((resolve, reject) => {
        const options = { signal: listeners.signal };
        worker.addEventListener('message', ({ data }) => {
          if (data.id !== id) return;
          if (data.error) reject(new Error(data.error.message || 'Bergamot could not run.'));
          else resolve(data.result as T);
        }, options);
        worker.addEventListener('error', (event) => {
          reject(new Error(event.message || 'Could not start the offline translation worker.'));
        }, options);
        worker.addEventListener('messageerror', () => {
          reject(new Error('Could not read the offline translation response.'));
        }, options);
        deadline.addEventListener('abort', () => {
          reject(new Error('The offline translation worker timed out.'));
        }, options);
        worker.postMessage({ id, name, args }, transfer);
      });
    } finally {
      listeners.abort();
    }
  }

  return async function translate(text: string): Promise<string> {
    try {
      if (!worker) {
        worker = new Worker(getAssetUrl(`/translation/${FILES.worker}`));
        await call(worker, 'initialize', [{}]);
        const [model, shortlist, vocab] = await Promise.all([
          loadAsset(`/translation/${FILES.model}`),
          loadAsset(`/translation/${FILES.shortlist}`),
          loadAsset(`/translation/${FILES.vocab}`),
        ]);
        await call(worker, 'loadTranslationModel', [
          PAIR,
          { model, shortlist, vocabs: [vocab] },
        ], [model, shortlist, vocab]);
      }

      const [result] = await call<Array<{ target: { text: string } }>>(worker, 'translate', [{
        models: [PAIR],
        texts: [{ text, html: false, qualityScores: false }],
      }]);
      if (typeof result?.target.text !== 'string') throw new Error('Bergamot returned no translation.');
      return result.target.text;
    } catch (error) {
      worker?.terminate();
      worker = undefined;
      throw error;
    }
  };
}
