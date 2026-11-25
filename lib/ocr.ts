import { createWorker, OEM, PSM } from 'tesseract.js';

export async function readImageText(imageUrl: string) {
  const failure = Promise.withResolvers<never>();
  const deadline = window.setTimeout(() => failure.reject(new Error('Image recognition timed out.')), 30_000);
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let finished = false;

  async function recognize() {
    const assetRoot = new URL('/ocr/', location.href).href;
    const started = await createWorker(['deu', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${assetRoot}worker.min.js`,
      corePath: `${assetRoot}tesseract-core-lstm.js`,
      langPath: assetRoot,
      workerBlobURL: false,
      cacheMethod: 'none',
      errorHandler: (error: unknown) => failure.reject(error),
    });
    if (finished) {
      await started.terminate();
      return '';
    }
    worker = started;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    let { data } = await worker.recognize(imageUrl);
    if (!/[\p{L}\p{N}]/u.test(data.text)) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      ({ data } = await worker.recognize(imageUrl));
    }
    return data.text.trim();
  }

  try {
    return await Promise.race([recognize(), failure.promise]);
  } finally {
    finished = true;
    window.clearTimeout(deadline);
    await worker?.terminate();
  }
}
