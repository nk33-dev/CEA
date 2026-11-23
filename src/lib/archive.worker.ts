import { zipSync } from 'fflate';

self.onmessage = (event: MessageEvent<Record<string, Uint8Array>>) => {
  try {
    const data = zipSync(event.data, { level: 0 });
    self.postMessage({ data }, { transfer: [data.buffer] });
  } catch {
    self.postMessage({ error: true });
  }
};
