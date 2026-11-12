import crypto from 'node:crypto';
import fs from 'node:fs';
import { cleanLabels } from '../../shared/contentLocale.ts';
import { parseThemeContract, parseThemeIdeas, type ThemeContract } from '../../shared/theme.ts';
import path from 'node:path';
import { strFromU8, strToU8 } from 'fflate';
import { framework as frameworkInfo, FRAMEWORKS } from '../../shared/frameworks.ts';
import { cliCommand, folderGuide } from '../../shared/folderGuide.ts';
import { normalizeLocale } from '../../shared/locales.ts';
import { splitHtml } from '../../shared/html.ts';
export { splitHtml } from '../../shared/html.ts';
import { ASSET_ID_PATTERN, extOf, isImage, isVideo, mimeOf, normalizeRelPath, slugify } from '../../shared/paths.ts';
import type { AssetText, Variant } from '../../shared/types.ts';
import { previewScale, previewViewport, type PreviewViewport } from '../../shared/preview.ts';
import { LOCAL_CLI } from '../config.ts';
import { badRequest } from '../errors.ts';
import type { Library } from '../library.ts';
import type { ParsedAsset, ParsedPackage } from './zip.ts';

/**
 * 「素材文件夹」格式（说明见 shared/folderGuide.ts）：一个素材一个文件夹，
 * 代码按框架分目录，文案写在 asset.json 和 idea.<语言>.md 里。
 * 解析结果和备份包一样是 ParsedPackage，导入走同一套流程。
 */

type Files = Record<string, Uint8Array>;

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vite', '__MACOSX']);
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const LOOSE_EXT: Record<string, string> = { html: 'html', htm: 'html', vue: 'vue', tsx: 'react', jsx: 'react' };
const MAX_FILES = 20_000;
const MAX_BYTES = 1024 * 1024 * 1024;

function ignored(rel: string) {
  const parts = rel.split('/');
  return parts.some(p => IGNORED_DIRS.has(p)) || IGNORED_FILES.has(parts.at(-1)!.toLowerCase());
}

/** 读取本机文件夹，返回相对路径 → 内容 */
export function readFolder(dir: string): Files {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw badRequest(`文件夹不存在：${root}`);
  const files: Files = {};
  let count = 0;
  let bytes = 0;
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (ignored(child)) continue;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) {
        const clean = normalizeRelPath(child);
        if (!clean) continue;
        if (++count > MAX_FILES) throw badRequest('文件夹里的文件超过 2 万个，请只选素材所在的文件夹');
        const data = fs.readFileSync(path.join(root, child));
        bytes += data.byteLength;
        if (bytes > MAX_BYTES) throw badRequest('文件夹超过 1 GB，请只选素材所在的文件夹');
        files[clean] = data;
      }
    }
  };
  walk('');
  return files;
}

const hasCjk = (s: string) => /[\u3400-\u9fff]/.test(s);
const guessLocale = (s: string) => (hasCjk(s) ? 'zh' : 'en');

function titleFrom(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  if (hasCjk(base) || /[A-Z]/.test(base)) return base;
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function idFrom(name: string) {
  const slug = slugify(name.replace(/\.[^.]+$/, ''));
  return slug && ASSET_ID_PATTERN.test(slug) ? slug : `asset-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
}

function categoryId(name: string) {
  return `folder-${crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12)}`;
}

const REACT_ENTRIES = ['Component', 'index', 'App', 'main'].flatMap(n => ['tsx', 'jsx', 'ts', 'js'].map(e => `${n}.${e}`));
const VUE_ENTRIES = ['Component.vue', 'App.vue', 'index.vue'];

function pickEntry(fw: string, files: { path: string; content: string }[], wanted?: string): string | null {
  const info = frameworkInfo(fw)!;
  if (info.fixed) return info.entry;
  if (wanted && files.some(f => f.path === wanted)) return wanted;
  const candidates = files.filter(f => info.entryExt.includes(extOf(f.path)));
  const top = candidates.filter(f => !f.path.includes('/'));
  for (const name of fw === 'vue' ? VUE_ENTRIES : REACT_ENTRIES) if (top.some(f => f.path === name)) return name;
  const exporting = top.filter(f => fw === 'vue' || /export\s+default/.test(f.content));
  if (exporting.length === 1) return exporting[0].path;
  if (top.length === 1) return top[0].path;
  return null;
}

interface AssetJson {
  id?: string;
  title?: string;
  titles?: Record<string, string>;
  tagLabels?: Record<string, Record<string, string>>;
  categoryLabels?: Record<string, string>;
  category?: string;
  tags?: string[];
  summary?: string | Record<string, string>;
  idea?: string | Record<string, string>;
  themes?: Record<string, ThemeContract>;
  themeIdeas?: Record<string, unknown>;
  entry?: Record<string, string>;
  dependencies?: Record<string, Record<string, string>>;
  sourceUrl?: string;
  sourceName?: string;
  favorite?: boolean;
  cover?: string;
  previewScale?: number;
  previewViewport?: PreviewViewport | null;
}

/** 去掉行注释、块注释和末尾多余的逗号，字符串里的内容不动；asset.json 可以照说明书带注释写 */
export function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function readJson(data: Uint8Array | undefined, where: string): AssetJson {
  if (!data) return {};
  try {
    const v = JSON.parse(stripJsonComments(strFromU8(data).replace(/^\uFEFF/, '')));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new FolderProblem(`${where} 不是有效的 JSON`);
  }
}

class FolderProblem extends Error {}

function localized(v: unknown): Record<string, string> {
  if (typeof v === 'string') return v.trim() ? { [guessLocale(v)]: v.trim() } : {};
  if (!v || typeof v !== 'object') return {};
  return cleanLabels(v, 20000);
}

/** 解析一个素材文件夹；files 的路径相对素材文件夹 */
function parseAssetFolder(name: string, input: Files, prefix: string): ParsedAsset & { categoryName: string | null; categoryLabels: Record<string, string> } {
  // 素材库内部布局把代码放在 code/<框架>/ 下，照库外布局读
  const files = Object.fromEntries(Object.entries(input).map(([p, d]) => [/^code\/(html|react|vue)\//.test(p) ? p.slice(5) : p, d]));
  const json = readJson(files['asset.json'], `${name}/asset.json`);
  const text = (rel: string) => strFromU8(files[rel]).replace(/^\uFEFF/, '');
  const variants: Variant[] = [];
  const paths = Object.keys(files);

  for (const info of FRAMEWORKS) {
    const dir = `${info.id}/`;
    const own = paths.filter(p => p.startsWith(dir) && p !== `${dir}package.json`);
    if (!own.length) continue;
    const code = own.map(p => ({ path: p.slice(dir.length), content: text(p) }));
    let deps = json.dependencies?.[info.id] ?? {};
    if (files[`${dir}package.json`]) {
      const pkg = readJson(files[`${dir}package.json`], `${name}/${dir}package.json`) as { dependencies?: Record<string, string> };
      deps = { ...pkg.dependencies, ...deps };
    }
    for (const builtin of ['react', 'react-dom', 'vue']) delete deps[builtin];
    if (info.id === 'html') {
      const single = code.find(f => /^index\.html?$/i.test(f.path)) ?? (code.length === 1 && /\.html?$/i.test(code[0].path) ? code[0] : null);
      if (!code.some(f => f.path === 'markup.html') && single) {
        const split = splitHtml(single.content);
        variants.push({ framework: 'html', entry: 'markup.html', dependencies: {}, files: [
          { path: 'markup.html', content: split.markup }, { path: 'style.css', content: split.style }, { path: 'script.js', content: split.script },
        ] });
        continue;
      }
    }
    const entry = pickEntry(info.id, code, json.entry?.[info.id]);
    if (!entry) throw new FolderProblem(`${info.label} 实现找不到入口文件，在 asset.json 的 entry 里写明，例如 {"${info.id}": "${info.entry}"}`);
    variants.push({ framework: info.id, entry, dependencies: deps, files: code });
  }

  // 没有框架目录时，素材文件夹根目录下的单个 index.html / 组件文件也算
  if (!variants.length) {
    const html = paths.find(p => /^index\.html?$/i.test(p)) ?? (paths.filter(p => /\.html?$/i.test(p) && !p.includes('/')).length === 1 ? paths.find(p => /\.html?$/i.test(p) && !p.includes('/')) : undefined);
    if (html) {
      const split = splitHtml(text(html));
      variants.push({ framework: 'html', entry: 'markup.html', dependencies: {}, files: [
        { path: 'markup.html', content: split.markup }, { path: 'style.css', content: split.style }, { path: 'script.js', content: split.script },
      ] });
    } else {
      // 没有框架目录：有 .vue 算 Vue，有 .tsx / .jsx 算 React，同目录的样式和工具文件一起带上
      const loose = paths.filter(p => !p.startsWith('media/') && /.(vue|tsx|jsx|ts|js|css)$/i.test(p));
      const fw = loose.some(p => extOf(p) === 'vue') ? 'vue' : loose.some(p => /.(tsx|jsx)$/i.test(p)) ? 'react' : null;
      if (fw) {
        const code = loose.filter(p => fw === 'vue' ? !/.(tsx|jsx)$/i.test(p) : extOf(p) !== 'vue').map(p => ({ path: p, content: text(p) }));
        const entry = pickEntry(fw, code, json.entry?.[fw]);
        if (!entry) throw new FolderProblem(`找不到入口文件，在 asset.json 的 entry 里写明，例如 {"${fw}": "${frameworkInfo(fw)!.entry}"}`);
        variants.push({ framework: fw, entry, dependencies: json.dependencies?.[fw] ?? {}, files: code });
      }
    }
  }
  if (!variants.length) throw new FolderProblem('没有找到代码：需要 html/、react/、vue/ 里的任意一个，或一个 index.html');
  for (const v of variants) {
    if (!v.files.some(f => f.path === v.entry && f.content.trim())) throw new FolderProblem(`${frameworkInfo(v.framework)!.label} 的入口文件 ${v.entry} 是空的`);
  }

  const texts: Record<string, AssetText> = {};
  const summaries = localized(json.summary);
  const ideas = localized(json.idea);
  const titles = cleanLabels(json.titles, 120);
  for (const p of paths) {
    const m = /^idea(?:\.([a-z0-9-]+))?\.(?:md|txt)$/i.exec(p);
    if (!m) continue;
    const body = text(p).trim();
    if (!body) continue;
    const loc = m[1] ? normalizeLocale(m[1]) : guessLocale(body);
    if (!loc) throw new FolderProblem(`语言代码无效：${m[1]}`);
    ideas[loc] = body;
  }
  const themedIdeas = Object.fromEntries(Object.entries(json.themeIdeas ?? {}).map(([id, value]) => {
    const normalized = normalizeLocale(id);
    if (!normalized) throw new FolderProblem(`语言代码无效：${id}`);
    return [normalized, value];
  }));
  for (const loc of new Set([...Object.keys(summaries), ...Object.keys(ideas), ...Object.keys(titles), ...Object.keys(themedIdeas)])) {
    let themeIdeas: AssetText['themeIdeas'];
    try { themeIdeas = parseThemeIdeas(themedIdeas[loc]); }
    catch (e) { throw new FolderProblem((e as Error).message); }
    texts[loc] = { ...(titles[loc] ? { title: titles[loc] } : {}), summary: summaries[loc] ?? '', idea: ideas[loc] ?? '', ...(themeIdeas ? { themeIdeas } : {}) };
  }
  if (json.themes !== undefined && (!json.themes || typeof json.themes !== 'object' || Array.isArray(json.themes))) throw new FolderProblem('themes 需要按框架声明主题');
  for (const [framework, theme] of Object.entries(json.themes ?? {})) {
    const variant = variants.find(v => v.framework === framework);
    if (!variant) throw new FolderProblem(`主题声明对应的实现不存在：${framework}`);
    try { variant.theme = parseThemeContract(theme); }
    catch (e) { throw new FolderProblem((e as Error).message); }
  }

  const media: ParsedAsset['media'] = paths
    .filter(p => p.startsWith('media/') && (isImage(mimeOf(p)) || isVideo(mimeOf(p))))
    .map(p => ({ path: p, zipPath: prefix + p, mime: mimeOf(p), label: '' }));
  const coverWanted = json.cover ? normalizeRelPath(json.cover.startsWith('media/') ? json.cover : `media/${json.cover}`) : null;
  const cover = media.find(f => f.path === coverWanted)?.path
    ?? media.find(f => /^media\/cover\.[a-z0-9]+$/i.test(f.path) && isImage(f.mime))?.path
    ?? media.find(f => isImage(f.mime))?.path ?? null;

  const now = new Date().toISOString();
  const categoryName = typeof json.category === 'string' && json.category.trim() ? json.category.trim().slice(0, 40) : null;
  const wantedId = typeof json.id === 'string' && ASSET_ID_PATTERN.test(json.id) ? json.id : idFrom(name);
  return {
    id: wantedId,
    title: (typeof json.title === 'string' && json.title.trim() ? json.title.trim() : titleFrom(name)).slice(0, 120),
    type: 'component',
    categoryId: categoryName ? categoryId(categoryName) : null,
    categoryName,
    categoryLabels: cleanLabels(json.categoryLabels, 40),
    tags: Array.isArray(json.tags) ? json.tags.filter((t): t is string => typeof t === 'string') : [],
    tagLabels: json.tagLabels && typeof json.tagLabels === 'object' ? Object.fromEntries(Object.entries(json.tagLabels).map(([name, labels]) => [name, cleanLabels(labels, 40)])) : {},
    sourceUrl: typeof json.sourceUrl === 'string' ? json.sourceUrl : '',
    sourceName: typeof json.sourceName === 'string' ? json.sourceName : '',
    favorite: json.favorite === true,
    cover,
    ...(json.previewScale !== undefined ? { previewScale: previewScale(json.previewScale) } : {}),
    ...(json.previewViewport ? { previewViewport: previewViewport(json.previewViewport) } : {}),
    createdAt: now,
    updatedAt: now,
    texts,
    variants,
    media,
  };
}

/** 去掉压缩或拖入时多出来的一层外壳目录，例如 my-components.zip 里只有 my-components/ */
function stripWrapper(files: Files): Files {
  let current = files;
  for (let i = 0; i < 3; i++) {
    const tops = new Set(Object.keys(current).map(p => p.split('/')[0]));
    const [only] = tops;
    if (tops.size !== 1 || !Object.keys(current).every(p => p.startsWith(only + '/'))) break;
    if (isAssetRoot(Object.keys(current).map(p => p.slice(only.length + 1)))) break;
    current = Object.fromEntries(Object.entries(current).map(([p, d]) => [p.slice(only.length + 1), d]));
  }
  return current;
}

function isAssetRoot(paths: string[]) {
  return paths.some(p => p === 'asset.json' || /^idea(\.[a-z-]+)?\.(md|txt)$/i.test(p) || /^index\.html?$/i.test(p) || FRAMEWORKS.some(f => p.startsWith(f.id + '/') || p.startsWith(`code/${f.id}/`)));
}

export interface FolderPackage extends ParsedPackage {
  problems: { name: string; reason: string }[];
}

/**
 * 把一组文件按素材文件夹格式解析。name 是选中的文件夹名，单个素材文件夹时用作 ID。
 * 有问题的素材记进 problems 并跳过，其余照常导入。
 */
export function parseFolderFiles(input: Files, name = 'asset'): FolderPackage {
  const files = stripWrapper(input);
  const paths = Object.keys(files);
  if (!paths.length) throw badRequest('文件夹是空的');
  // 每组一个素材：own 是相对素材文件夹的文件，prefix 是媒体在 files 里的前缀（散放文件没有媒体）
  const groups: { name: string; own: Files; prefix: string | null }[] = [];
  if (isAssetRoot(paths)) groups.push({ name, own: files, prefix: '' });
  else {
    const dirs = [...new Set(paths.filter(p => p.includes('/')).map(p => p.split('/')[0]))].sort();
    for (const d of dirs) {
      const own = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith(d + '/')).map(([p, data]) => [p.slice(d.length + 1), data]));
      groups.push({ name: d, own, prefix: d + '/' });
    }
    for (const p of paths.filter(p => !p.includes('/') && LOOSE_EXT[extOf(p)]).sort()) {
      const fw = LOOSE_EXT[extOf(p)];
      groups.push({ name: p, own: fw === 'html' ? { 'index.html': files[p] } : { [`${fw}/${p}`]: files[p] }, prefix: null });
    }
  }

  const assets: ParsedAsset[] = [];
  const categories = new Map<string, { id: string; name: string; sort: number; labels?: Record<string, string> }>();
  const problems: FolderPackage['problems'] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    try {
      const { categoryName, categoryLabels, ...asset } = parseAssetFolder(g.name, g.own, g.prefix ?? '');
      if (g.prefix === null) asset.media = [];
      let id = asset.id;
      for (let n = 2; seen.has(id); n++) id = `${asset.id}-${n}`;
      seen.add(id);
      asset.id = id;
      if (categoryName && asset.categoryId && !categories.has(asset.categoryId)) categories.set(asset.categoryId, { id: asset.categoryId, name: categoryName, sort: categories.size, ...(Object.keys(categoryLabels).length ? { labels: categoryLabels } : {}) });
      assets.push(asset);
    } catch (e) {
      if (e instanceof FolderProblem) problems.push({ name: g.name, reason: e.message });
      else throw e;
    }
  }
  if (!assets.length && !problems.length) throw badRequest('没有找到素材。每个素材一个文件夹，里面放 html/、react/ 或 vue/，详见导入导出页的「文件夹格式说明」');
  return { formatVersion: 0, exportedAt: '', categories: [...categories.values()], assets, files, problems };
}

// ---- 导出 ----

/** 把素材导出成素材文件夹格式，返回相对路径 → 内容；可以写到磁盘或打包下载 */
export function folderFiles(lib: Library, ids?: string[]): Files {
  const targetIds = ids?.length ? ids : lib.repo.allAssetIds();
  const categories = new Map(lib.listCategories().map(c => [c.id, c]));
  const tagLabels = new Map(lib.repo.listTags().map(t => [t.name.toLowerCase(), t.labels]));
  const out: Files = { 'README.md': strToU8(folderGuide(cliCommand(LOCAL_CLI))) };
  for (const id of targetIds) {
    const a = lib.getAsset(id);
    const json: AssetJson = { id: a.id, title: a.title };
    if (a.categoryId && categories.has(a.categoryId)) {
      json.category = categories.get(a.categoryId)!.name;
      json.categoryLabels = categories.get(a.categoryId)!.labels;
    }
    if (a.tags.length) json.tags = a.tags;
    json.tagLabels = Object.fromEntries(a.tags.map(t => [t, tagLabels.get(t.toLowerCase()) ?? {}]));
    json.titles = Object.fromEntries(Object.entries(a.texts).filter(([, t]) => t.title).map(([k, t]) => [k, t.title!]));
    const themes = Object.fromEntries(a.variants.filter(v => v.theme).map(v => [v.framework, v.theme!]));
    if (Object.keys(themes).length) json.themes = themes;
    const themeIdeas = Object.fromEntries(Object.entries(a.texts).filter(([, t]) => t.themeIdeas).map(([loc, t]) => [loc, t.themeIdeas]));
    if (Object.keys(themeIdeas).length) json.themeIdeas = themeIdeas;
    const summary = Object.fromEntries(Object.entries(a.texts).filter(([, t]) => t.summary).map(([k, t]) => [k, t.summary]));
    if (Object.keys(summary).length) json.summary = summary;
    const entry = Object.fromEntries(a.variants.filter(v => !frameworkInfo(v.framework)?.fixed).map(v => [v.framework, v.entry]));
    if (Object.keys(entry).length) json.entry = entry;
    const deps = Object.fromEntries(a.variants.filter(v => Object.keys(v.dependencies).length).map(v => [v.framework, v.dependencies]));
    if (Object.keys(deps).length) json.dependencies = deps;
    if (a.sourceUrl) json.sourceUrl = a.sourceUrl;
    if (a.sourceName) json.sourceName = a.sourceName;
    if (a.favorite) json.favorite = true;
    if (a.previewScale !== undefined) json.previewScale = a.previewScale;
    if (a.previewViewport) json.previewViewport = a.previewViewport;
    if (a.cover) json.cover = a.cover.slice(`assets/${a.id}/`.length);
    out[`${a.id}/asset.json`] = strToU8(JSON.stringify(json, null, 2) + '\n');
    for (const [loc, t] of Object.entries(a.texts)) if (t.idea) out[`${a.id}/idea.${loc}.md`] = strToU8(t.idea.trimEnd() + '\n');
    for (const v of a.variants) for (const f of v.files) out[`${a.id}/${v.framework}/${f.path}`] = strToU8(f.content);
    for (const m of a.media) {
      const abs = lib.resolve(m.path);
      if (abs && fs.existsSync(abs)) out[`${a.id}/${m.path.slice(`assets/${a.id}/`.length)}`] = fs.readFileSync(abs);
    }
  }
  return out;
}

/** 写到 parent 下新建的文件夹里，重名时加序号，返回实际路径 */
export function writeFolder(parent: string, name: string, files: Files): string {
  const base = path.resolve(parent);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw badRequest(`导出位置不存在：${base}`);
  let target = path.join(base, name);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(base, `${name}-${n}`);
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(target, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
  return target;
}
