import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await rolldown({
  input: path.join(root, 'server/cli.ts'),
  platform: 'node',
  external: source => !source.startsWith('.') && !path.isAbsolute(source),
});
try {
  const directory = path.join(root, 'dist-cli');
  fs.mkdirSync(directory, { recursive: true });
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith('.mjs') && fs.lstatSync(path.join(directory, file)).isFile()) fs.unlinkSync(path.join(directory, file));
  }
  await bundle.write({ dir: directory, entryFileNames: 'cea.mjs', chunkFileNames: '[name]-[hash].mjs', format: 'esm' });
} finally { await bundle.close(); }
