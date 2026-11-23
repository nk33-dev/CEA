import { uiText } from './uiI18n.ts';

export function archiveFiles(files: Record<string, Uint8Array>, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ data?: Uint8Array<ArrayBuffer>; error?: boolean }>) => {
      finish();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(uiText('文件夹打包失败，请重试或选择本机文件夹')));
    };
    worker.onerror = () => { finish(); reject(new Error(uiText('文件夹打包失败，请重试或选择本机文件夹'))); };
    try { worker.postMessage(files, Object.values(files).map(file => file.buffer as ArrayBuffer)); }
    catch (error) { finish(); reject(error); }
  });
}
