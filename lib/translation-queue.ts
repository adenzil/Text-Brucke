import type { TranslationPriority } from './translation';

type Job = {
  priority: TranslationPriority;
  promise: Promise<string>;
  resolve: (text: string) => void;
  reject: (error: unknown) => void;
};

const MAX_CACHE_ENTRIES = 256;
const MAX_CACHE_ENTRY_LENGTH = 8_192;

export function createTranslationQueue(run: (text: string) => Promise<string>) {
  const cache = new Map<string, string>();
  const jobs = new Map<string, Job>();
  let running = false;

  async function drain() {
    running = true;
    while (jobs.size) {
      let next = jobs.entries().next().value!;
      for (const entry of jobs) {
        if (entry[1].priority === 'selection') {
          next = entry;
          break;
        }
      }

      const [text, job] = next;
      try {
        const translated = await run(text);
        if (text.length + translated.length <= MAX_CACHE_ENTRY_LENGTH) {
          cache.set(text, translated);
          if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        }
        job.resolve(translated);
      } catch (error) {
        job.reject(error);
      } finally {
        jobs.delete(text);
      }
    }
    running = false;
  }

  return function translate(text: string, priority: TranslationPriority = 'selection') {
    if (!text.trim()) return Promise.resolve(text);

    const cached = cache.get(text);
    if (cached !== undefined) {
      cache.delete(text);
      cache.set(text, cached);
      return Promise.resolve(cached);
    }

    const existing = jobs.get(text);
    if (existing) {
      if (priority === 'selection') existing.priority = 'selection';
      return existing.promise;
    }

    const job = { priority, ...Promise.withResolvers<string>() };
    jobs.set(text, job);
    if (!running) void drain();
    return job.promise;
  };
}
