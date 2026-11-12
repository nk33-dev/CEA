import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, resolveLibraryPath } from './config.ts';
import { createApp } from './app.ts';
import { Library } from './library.ts';

const argv = process.argv.slice(2);
const port = Number(process.env.CEA_PORT ?? (argv.includes('--serve-dist') ? 5180 : 5179));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const target = resolveLibraryPath(argv);
let lib: Library;
try {
  lib = Library.open(target.path);
} catch (e) {
  console.error(`无法打开素材库 ${target.path}：${e instanceof Error ? e.message : e}`);
  console.error('可以用 --library <目录> 或环境变量 CEA_LIBRARY 指定其他目录。');
  process.exit(1);
}

const state = { lib };
const app = createApp(state, { distDir: argv.includes('--serve-dist') ? path.join(root, 'dist') : undefined });

app.listen(port, '127.0.0.1', () => {
  console.log(`素材库服务：http://127.0.0.1:${port}`);
  console.log(`素材库目录：${state.lib.root}`);
  console.log(`程序配置：${configDir()}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    state.lib.close();
    process.exit(0);
  });
}
