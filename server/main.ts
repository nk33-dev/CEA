import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, resolveLibraryPath } from './config.ts';
import { createApp, type AppState } from './app.ts';
import { Library } from './library.ts';

const argv = process.argv.slice(2);
const port = Number(process.env.CEA_PORT ?? (argv.includes('--serve-dist') ? 5180 : 5179));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const state: AppState = { lib: null };
try {
  const target = resolveLibraryPath(argv);
  if (target) {
    if (target.fromConfig && Library.check(target.path) !== 'library') throw new Error(`保存的位置不是可用的素材库：${target.path}`);
    state.lib = Library.open(target.path);
  }
} catch (e) {
  console.error(`无法打开素材库：${e instanceof Error ? e.message : e}`);
  console.error('请在页面中重新选择素材库。');
}

const app = createApp(state, { distDir: argv.includes('--serve-dist') ? path.join(root, 'dist') : undefined });

app.listen(port, '127.0.0.1', () => {
  console.log(`素材库服务：http://127.0.0.1:${port}`);
  console.log(state.lib ? `素材库目录：${state.lib.root}` : '首次使用：请在页面中选择素材库位置。');
  console.log(`程序配置：${configDir()}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    state.lib?.close();
    process.exit(0);
  });
}
