import type { HighlightJob } from './highlightJob.ts';

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, { resolve: (chunks: string[]) => void; reject: () => void }>();

export function highlightAsync(job: HighlightJob) {
  if (!worker) {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; chunks: string[]; error?: boolean }>) => {
      const task = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.error) task?.reject();
      else task?.resolve(event.data.chunks);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const task of pending.values()) task.reject();
      pending.clear();
    };
  }
  const id = ++sequence;
  const promise = new Promise<string[]>((resolve, reject) => pending.set(id, { resolve, reject }));
  worker.postMessage({ id, job });
  return { promise, cancel: () => pending.delete(id) };
}
