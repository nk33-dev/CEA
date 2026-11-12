import { renderCode, type HighlightJob } from './highlightJob.ts';

const cache = new Map<string, string[]>();
self.onmessage = (event: MessageEvent<{ id: number; job: HighlightJob }>) => {
  const { id, job } = event.data;
  try {
    const key = JSON.stringify(job);
    let chunks = cache.get(key);
    if (!chunks) {
      chunks = renderCode(job);
      if (key.length < 200_000) cache.set(key, chunks);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
    }
    self.postMessage({ id, chunks });
  } catch {
    self.postMessage({ id, error: true });
  }
};
