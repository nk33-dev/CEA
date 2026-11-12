import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc';
import { rolldown, type Plugin } from 'rolldown';
import type { CodeFile } from '../shared/types.ts';
import { normalizeRelPath } from '../shared/paths.ts';

/**
 * React / Vue 实现在本地打包成一个脚本，和 HTML 实现一样通过 /play/<id>/<framework>/ 播放，
 * 不依赖在线打包服务，离线也能预览。裸模块（react、vue、motion 等）从程序的 node_modules 解析。
 * 加一种框架：在 MOUNT 里写挂载代码；需要编译的文件类型在 load 里处理。
 */

const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY_ID = '\0cea-entry.tsx';
const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.vue', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

const MOUNT: Record<string, (entry: string) => string> = {
  react: entry => [
    "import { createRoot } from 'react-dom/client';",
    `import App from ${JSON.stringify(entry)};`,
    "createRoot(document.getElementById('root')).render(<App />);",
  ].join('\n'),
  vue: entry => [
    "import { createApp } from 'vue';",
    `import App from ${JSON.stringify(entry)};`,
    "createApp(App).mount('#root');",
  ].join('\n'),
};

export function canBundle(framework: string) {
  return framework in MOUNT;
}

export interface BundleResult {
  code: string;
  error: string | null;
}

const cache = new Map<string, BundleResult>();
const inFlight = new Map<string, Promise<BundleResult>>();

const injectCss = (css: string) => `{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);}`;

function compileVue(id: string, source: string) {
  const { descriptor, errors } = parse(source, { filename: id });
  if (errors.length) throw new Error(`${id}: ${errors[0].message}`);
  const scopeId = 'data-v-' + Buffer.from(id).toString('hex').slice(-8);
  const scoped = descriptor.styles.some(s => s.scoped);
  const script = descriptor.script || descriptor.scriptSetup
    ? compileScript(descriptor, { id: scopeId, inlineTemplate: true, templateOptions: { compilerOptions: { scopeId: scoped ? scopeId : undefined } } })
    : null;
  const css = descriptor.styles.map(s => {
    const out = compileStyle({ source: s.content, filename: id, id: scopeId, scoped: s.scoped });
    if (out.errors.length) throw new Error(`${id}: ${out.errors[0].message}`);
    return out.code;
  }).join('\n');
  const body = script
    ? script.content.replace(/export default/, 'const __sfc =')
    : 'const __sfc = {};';
  return {
    code: `${css ? injectCss(css) : ''}\n${body}\n${scoped ? `__sfc.__scopeId = ${JSON.stringify(scopeId)};` : ''}\nexport default __sfc;`,
    moduleType: (script?.lang === 'ts' ? 'ts' : 'js') as 'ts' | 'js',
  };
}

function virtualFiles(framework: string, code: CodeFile[], entry: string): Plugin {
  const files = new Map(code.map(f => ['/' + f.path, f.content]));
  return {
    name: 'cea-virtual-files',
    resolveId(source, importer) {
      if (source === ENTRY_ID) return source;
      if (source.startsWith('.') || source.startsWith('/')) {
        const from = importer && importer !== ENTRY_ID ? path.posix.dirname(importer) : '/';
        const base = source.startsWith('/') ? source : path.posix.join(from, source);
        const clean = normalizeRelPath(base);
        if (clean === null) return null;
        for (const ext of EXTENSIONS) if (files.has('/' + clean + ext)) return '/' + clean + ext;
        return null;
      }
      return this.resolve(source, path.join(PROJECT_ROOT, 'package.json'), { skipSelf: true });
    },
    load(id) {
      if (id === ENTRY_ID) return MOUNT[framework]('/' + entry);
      const content = files.get(id);
      if (content === undefined) return null;
      if (id.endsWith('.css')) return { code: injectCss(content), moduleType: 'js' };
      if (id.endsWith('.vue')) return compileVue(id, content);
      return content;
    },
  };
}

export function bundle(framework: string, _key: string, code: CodeFile[], entry: string): Promise<BundleResult> {
  const key = createHash('sha256').update(JSON.stringify([framework, entry, code])).digest('hex');
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = compileBundle(framework, code, entry).then(result => {
    if (!result.error) cache.set(key, result);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    return result;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function compileBundle(framework: string, code: CodeFile[], entry: string): Promise<BundleResult> {
  let result: BundleResult;
  let build: Awaited<ReturnType<typeof rolldown>> | undefined;
  try {
    if (!canBundle(framework)) throw new Error(`不支持打包 ${framework}`);
    build = await rolldown({
      input: ENTRY_ID,
      cwd: PROJECT_ROOT,
      platform: 'browser',
      logLevel: 'silent',
      transform: {
        jsx: { runtime: 'automatic' },
        define: {
          'process.env.NODE_ENV': '"production"',
          __VUE_OPTIONS_API__: 'true',
          __VUE_PROD_DEVTOOLS__: 'false',
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
      },
      plugins: [virtualFiles(framework, code, entry)],
      onLog(level, log) {
        if (level === 'warn' && log.code === 'UNRESOLVED_IMPORT') throw new Error(log.message);
      },
    });
    const out = await build.generate({ format: 'iife', minify: true });
    result = { code: out.output[0].code, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result = { code: '', error: message.replace(/\u001b\[[0-9;]*m/g, '') };
  } finally {
    await build?.close();
  }
  return result;
}
