import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await rolldown({
  input: path.join(root, 'server/cli.ts'),
  platform: 'node',
  external: source => !source.startsWith('.') && !path.isAbsolute(source),
});
try {
  await bundle.write({ file: path.join(root, 'dist-cli/cea.mjs'), format: 'esm' });
} finally { await bundle.close(); }
