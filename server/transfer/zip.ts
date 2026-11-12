import fs from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { framework as frameworkInfo, frameworkLabel } from '../../shared/frameworks.ts';
import { contentLanguages, normalizeLocale } from '../../shared/locales.ts';
import { ASSET_ID_PATTERN, assetDir, extOf, mimeOf, normalizeRelPath } from '../../shared/paths.ts';
import { buildIdeaPrompt, buildReplicaPrompt, buildSource, pickText } from '../../shared/prompt.ts';
import { ASSET_TYPES, type AssetDetail, type AssetText, type AssetType, type DuplicateStrategy, type ImportPreview, type ImportResult, type Variant } from '../../shared/types.ts';
import { badRequest } from '../errors.ts';
import { Library } from '../library.ts';
import { previewScale, previewViewport, type PreviewViewport } from '../../shared/preview.ts';
import { cleanLabels } from '../../shared/contentLocale.ts';
import { alignVocabulary } from './vocabulary.ts';
import { parseThemeContract, parseThemeIdeas, resolveTheme, themeLabel } from '../../shared/theme.ts';

export const FORMAT = 'craft-every-aspect-export';
/** v1：单一实现；v2：多语言文案与多框架；v3：译名；v4：主题声明与分主题思路 */
export const FORMAT_VERSION = 4;
const MAX_UNZIPPED = 2 * 1024 * 1024 * 1024;
const STORED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp4', 'webm', 'mov']);

export interface ManifestFile {
  role: 'code' | 'media';
  /** 相对素材目录，例如 code/react/Component.tsx、media/cover.png */
  path: string;
  mime: string;
  size: number;
  label: string;
}

export interface ManifestAsset {
  id: string;
  title: string;
  type: AssetType;
  categoryId: string | null;
  tags: string[];
  sourceUrl: string;
  sourceName: string;
  favorite: boolean;
  cover: string | null;
  previewScale?: number;
  previewViewport?: PreviewViewport | null;
  tagLabels?: Record<string, Record<string, string>>;
  createdAt: string;
  updatedAt: string;
  texts: Record<string, AssetText>;
  variants: Omit<Variant, 'files'>[];
  files: ManifestFile[];
}

export interface Manifest {
  format: typeof FORMAT;
  formatVersion: number;
  exportedAt: string;
  sourceLibraryId: string;
  categories: { id: string; name: string; sort: number; labels?: Record<string, string> }[];
  assets: ManifestAsset[];
}

function relToAsset(asset: { id: string }, libraryRel: string) {
  return libraryRel.slice(assetDir(asset.id).length + 1);
}

function readFile(lib: Library, rel: string): Uint8Array {
  const abs = lib.resolve(rel);
  if (!abs || !fs.existsSync(abs)) throw badRequest(`素材文件丢失：${rel}`);
  return fs.readFileSync(abs);
}

function put(zip: Zippable, path: string, data: Uint8Array) {
  zip[path] = STORED_EXT.has(extOf(path)) ? [data, { level: 0 }] : data;
}

/** 代码文件在库里的相对路径 */
const codeRel = (id: string, fw: string, p: string) => `${assetDir(id)}/code/${fw}/${p}`;

function readme(asset: AssetDetail): string {
  const lines = [`# ${asset.title}`, '', pickText(asset, 'zh', 'summary') || '（无简介）', ''];
  if (asset.sourceUrl) lines.push('## 来源', `${asset.sourceName || asset.sourceUrl}：${asset.sourceUrl}`, '');
  lines.push('## 实现');
  for (const v of asset.variants) {
    const deps = Object.entries(v.dependencies).map(([n, ver]) => `${n}@${ver}`);
    const run = v.framework === 'html' ? '浏览器直接打开 source.html' : `入口 code/${v.framework}/${v.entry}，默认导出组件`;
    lines.push(`- ${frameworkLabel(v.framework)}：${run}${deps.length ? `；依赖 ${deps.join(' ')}` : ''}`);
    const theme = resolveTheme(v);
    lines.push(`  组件主题：${themeLabel(theme.mode)}${theme.source === 'declared' ? '（已声明）' : '（兼容读取）'}；预览背景不属于组件主题。`);
  }
  lines.push('', '## 提示词', 'prompts/ 下按「框架.语言」放复刻提示词，按语言放思路提示词。');
  if (asset.media.length) {
    lines.push('', '## 截图与录屏', ...asset.media.map(f => `- ${relToAsset(asset, f.path)}${f.label ? `：${f.label}` : ''}`));
  }
  return lines.join('\n') + '\n';
}

/** 整库或选中素材的 ZIP：清单、代码和媒体文件 */
export function exportLibrary(lib: Library, ids?: string[]): Uint8Array {
  const targetIds = ids?.length ? ids : lib.repo.allAssetIds();
  const assets = targetIds.map(id => lib.getAsset(id));
  const categories = lib.listCategories();
  const tagLabels = new Map(lib.repo.listTags().map(t => [t.name.toLowerCase(), t.labels]));
  const usedCategories = ids?.length ? categories.filter(c => assets.some(a => a.categoryId === c.id)) : categories;
  const zip: Zippable = {};
  const manifest: Manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceLibraryId: lib.libraryId,
    categories: usedCategories.map(({ id, name, sort, labels }) => ({ id, name, sort, labels })),
    assets: assets.map(asset => ({
      id: asset.id,
      title: asset.title,
      type: asset.type,
      categoryId: asset.categoryId,
      tags: asset.tags,
      tagLabels: Object.fromEntries(asset.tags.map(t => [t, tagLabels.get(t.toLowerCase()) ?? {}])),
      sourceUrl: asset.sourceUrl,
      sourceName: asset.sourceName,
      favorite: asset.favorite,
      cover: asset.cover ? relToAsset(asset, asset.cover) : null,
      ...(asset.previewScale !== undefined ? { previewScale: asset.previewScale } : {}),
      ...(asset.previewViewport ? { previewViewport: asset.previewViewport } : {}),
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
      texts: asset.texts,
      variants: asset.variants.map(({ files: _, ...variant }) => variant),
      files: [
        ...asset.variants.flatMap(v => v.files.map(f => {
          const data = strToU8(f.content);
          zip[codeRel(asset.id, v.framework, f.path)] = data;
          return { role: 'code' as const, path: `code/${v.framework}/${f.path}`, mime: mimeOf(f.path), size: data.byteLength, label: '' };
        })),
        ...asset.media.map(f => {
          put(zip, f.path, readFile(lib, f.path));
          return { role: 'media' as const, path: relToAsset(asset, f.path), mime: f.mime, size: f.size, label: f.label };
        }),
      ],
    })),
  };
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(zip, { level: 6 });
}

/** 单个素材的参考包：截图、说明、各框架代码和各语言提示词，可直接交给 AI 或同事 */
export function exportReferencePackage(lib: Library, id: string): Uint8Array {
  const asset = lib.getAsset(id);
  const category = lib.listCategories().find(c => c.id === asset.categoryId) ?? null;
  const zip: Zippable = {};
  const languages = contentLanguages(Object.keys(asset.texts));
  for (const v of asset.variants) {
    for (const f of v.files) zip[`code/${v.framework}/${f.path}`] = strToU8(f.content);
    if (v.framework === 'html') zip['source.html'] = strToU8(buildSource(asset, 'html'));
    for (const L of languages) zip[`prompts/replica.${v.framework}.${L.id}.md`] = strToU8(buildReplicaPrompt(asset, { framework: v.framework, locale: L.id }));
    for (const L of languages) for (const targetTheme of ['light', 'dark', 'both'] as const) {
      zip[`prompts/replica.${v.framework}.${targetTheme}.${L.id}.md`] = strToU8(buildReplicaPrompt(asset, { framework: v.framework, locale: L.id, targetTheme }));
    }
  }
  for (const L of languages) {
    const idea = buildIdeaPrompt(asset, { locale: L.id });
    if (idea) zip[`prompts/idea.${L.id}.md`] = strToU8(idea);
    for (const targetTheme of ['light', 'dark'] as const) {
      const themed = buildIdeaPrompt(asset, { locale: L.id, targetTheme });
      if (themed) zip[`prompts/idea.${targetTheme}.${L.id}.md`] = strToU8(themed);
    }
  }
  for (const f of asset.media) put(zip, relToAsset(asset, f.path), readFile(lib, f.path));
  zip['README.md'] = strToU8(readme(asset));
  zip['asset.json'] = strToU8(JSON.stringify({
    id: asset.id, title: asset.title, type: asset.type, tags: asset.tags, category: category?.name ?? null,
    titles: Object.fromEntries(Object.entries(asset.texts).filter(([, t]) => t.title).map(([locale, t]) => [locale, t.title])),
    summary: Object.fromEntries(Object.entries(asset.texts).filter(([, t]) => t.summary).map(([locale, t]) => [locale, t.summary])),
    categoryLabels: category?.labels,
    tagLabels: Object.fromEntries(asset.tags.map(t => [t, lib.repo.getTagLabels(t)])),
    frameworks: asset.frameworks, sourceUrl: asset.sourceUrl, sourceName: asset.sourceName,
    supportsDarkMode: Object.fromEntries(asset.variants.filter(v => v.supportsDarkMode).map(v => [v.framework, true])),
    previewScale: asset.previewScale,
    previewViewport: asset.previewViewport,
    themes: Object.fromEntries(asset.variants.filter(v => v.theme).map(v => [v.framework, v.theme])),
    themeIdeas: Object.fromEntries(Object.entries(asset.texts).filter(([, t]) => t.themeIdeas).map(([loc, t]) => [loc, t.themeIdeas])),
  }, null, 2));
  return zipSync(zip, { level: 6 });
}

// ---- 导入 ----

/** 校验后的素材：代码已读成文本，媒体记下在压缩包里的位置 */
export interface ParsedAsset extends Omit<ManifestAsset, 'variants' | 'files'> {
  variants: Variant[];
  media: { path: string; zipPath: string; mime: string; label: string }[];
}

export interface ParsedPackage {
  formatVersion: number;
  exportedAt: string;
  categories: Manifest['categories'];
  assets: ParsedAsset[];
  files: Record<string, Uint8Array>;
}

function fail(message: string): never {
  throw badRequest(`导入文件无效：${message}`);
}

function str(v: unknown, field: string, max = 100_000): string {
  if (typeof v !== 'string') fail(`${field} 应为文本`);
  if (v.length > max) fail(`${field} 过长`);
  return v;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

function deps(v: unknown): Record<string, string> {
  return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : {};
}

/** v1 只有一种实现，代码在 code/ 下；简介是英文、思路提示词是中文 */
function upgradeV1(a: Record<string, unknown>): Pick<ManifestAsset, 'texts' | 'variants' | 'files'> {
  const kind = text(a.kind);
  const files = (Array.isArray(a.files) ? a.files : []) as Record<string, unknown>[];
  const texts: Record<string, AssetText> = {};
  if (text(a.description)) texts.en = { summary: text(a.description), idea: '' };
  if (text(a.idea)) texts.zh = { summary: '', idea: text(a.idea) };
  return {
    texts,
    variants: [{ framework: kind, entry: text(a.entry), dependencies: deps(a.dependencies) }],
    files: files.map(f => ({ ...f, framework: kind })) as unknown as ManifestFile[],
  };
}

/** 解压上传的 ZIP：限制解压后大小，拒绝越出目录的路径 */
export function unzipSafe(data: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter(file) {
        total += file.originalSize;
        if (total > MAX_UNZIPPED) fail('解压后超过 2 GB');
        return !file.name.endsWith('/');
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('导入文件无效')) throw e;
    fail('不是有效的 ZIP 文件');
  }
  for (const name of Object.keys(files)) {
    if (normalizeRelPath(name) !== name) fail(`压缩包内路径不安全：${name}`);
  }
  return files;
}

/** 是否是本工具导出的备份包（根目录有带格式标记的 manifest.json） */
export function isBackupPackage(files: Record<string, Uint8Array>) {
  if (!files['manifest.json']) return false;
  try {
    return JSON.parse(strFromU8(files['manifest.json'])).format === FORMAT;
  } catch {
    return false;
  }
}

/** 解压并逐项校验清单：格式版本、ID、路径、文件是否齐全 */
export function parsePackage(data: Uint8Array): ParsedPackage {
  return parsePackageFiles(unzipSafe(data));
}

export function parsePackageFiles(files: Record<string, Uint8Array>): ParsedPackage {
  if (!files['manifest.json']) fail('缺少 manifest.json');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    fail('manifest.json 不是有效的 JSON');
  }
  if (raw.format !== FORMAT) fail('不是本工具导出的素材包');
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion < 1) fail('缺少格式版本');
  if (raw.formatVersion > FORMAT_VERSION) fail(`素材包格式版本 ${raw.formatVersion} 高于当前程序支持的 ${FORMAT_VERSION}，请升级程序`);
  if (!Array.isArray(raw.assets) || !Array.isArray(raw.categories)) fail('清单结构不完整');
  const version = raw.formatVersion;

  const categories = (raw.categories as Record<string, unknown>[]).map((c, i) => {
    const id = str(c.id, `categories[${i}].id`, 64);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) fail(`分类 ID 不合法：${id}`);
    return { id, name: str(c.name, `categories[${i}].name`, 40), sort: Number(c.sort) || 0, labels: cleanLabels(c.labels, 40) };
  });

  const seen = new Set<string>();
  const assets = (raw.assets as Record<string, unknown>[]).map((a, i): ParsedAsset => {
    const id = str(a.id, `assets[${i}].id`, 64);
    if (!ASSET_ID_PATTERN.test(id)) fail(`素材 ID 不合法：${id}`);
    if (seen.has(id)) fail(`素材 ID 重复：${id}`);
    seen.add(id);
    if (!Array.isArray(a.files)) fail(`素材 ${id} 缺少文件列表`);
    const v2 = version === 1 ? upgradeV1(a) : {
      texts: (a.texts && typeof a.texts === 'object' ? a.texts : {}) as Record<string, AssetText>,
      variants: (Array.isArray(a.variants) ? a.variants : []) as ManifestAsset['variants'],
      files: a.files as ManifestFile[],
    };

    const texts: Record<string, AssetText> = {};
    for (const [loc, t] of Object.entries(v2.texts)) {
      const language = normalizeLocale(loc);
      if (!language) fail(`语言代码无效：${loc}`);
      if (Object.hasOwn(texts, language)) fail(`语言代码重复：${loc}`);
      let themeIdeas: AssetText['themeIdeas'];
      try { themeIdeas = parseThemeIdeas(t?.themeIdeas); } catch (e) { fail((e as Error).message); }
      texts[language] = { ...(text(t?.title) ? { title: text(t.title).slice(0, 120) } : {}), summary: text(t?.summary), idea: text(t?.idea), ...(themeIdeas ? { themeIdeas } : {}) };
    }

    const variants: Variant[] = v2.variants.map(v => {
      const info = frameworkInfo(text(v.framework));
      if (!info) fail(`素材 ${id} 的实现方式未知：${String(v.framework)}`);
      let theme: Variant['theme'];
      try { theme = parseThemeContract(v.theme); } catch (e) { fail((e as Error).message); }
      return { framework: info.id, entry: text(v.entry), dependencies: deps(v.dependencies), files: [], ...(theme ? { theme } : {}), ...(v.supportsDarkMode === true ? { supportsDarkMode: true } : {}) };
    });
    const media: ParsedAsset['media'] = [];
    for (const f of v2.files as (ManifestFile & { framework?: string })[]) {
      const p = normalizeRelPath(str(f.path, `素材 ${id} 的文件路径`, 500));
      if (!p || !(p.startsWith('code/') || p.startsWith('media/'))) fail(`素材 ${id} 的文件路径不合法：${String(f.path)}`);
      const role = p.startsWith('code/') ? 'code' : 'media';
      if (f.role !== role) fail(`素材 ${id} 的文件 ${p} 类型与目录不符`);
      const zipPath = `${assetDir(id)}/${p}`;
      if (!files[zipPath]) fail(`素材 ${id} 缺少文件 ${p}`);
      if (role === 'media') {
        media.push({ path: p, zipPath, mime: mimeOf(p), label: typeof f.label === 'string' ? f.label.slice(0, 200) : '' });
        continue;
      }
      // v1：code/<file>；v2：code/<framework>/<file>
      const rest = p.slice('code/'.length);
      const fw = version === 1 ? f.framework! : rest.split('/')[0];
      const variant = variants.find(v => v.framework === fw);
      if (!variant) fail(`素材 ${id} 的文件 ${p} 不属于任何实现`);
      variant.files.push({ path: version === 1 ? rest : rest.slice(fw.length + 1), content: strFromU8(files[zipPath]) });
    }
    for (const v of variants) if (!v.files.some(f => f.path === v.entry)) fail(`素材 ${id} 的 ${frameworkLabel(v.framework)} 入口文件不存在`);

    const cover = a.cover == null ? null : str(a.cover, `素材 ${id} 的封面`, 500);
    if (cover && !media.some(f => f.path === cover)) fail(`素材 ${id} 的封面文件不存在`);
    const categoryId = a.categoryId == null ? null : str(a.categoryId, `素材 ${id} 的分类`, 64);
    const type = ASSET_TYPES.find(t => t.id === a.type)?.id ?? 'component';
    return {
      id,
      title: str(a.title, `素材 ${id} 的名称`, 120),
      type,
      categoryId: categoryId && categories.some(c => c.id === categoryId) ? categoryId : null,
      tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string') : [],
      tagLabels: a.tagLabels && typeof a.tagLabels === 'object' ? Object.fromEntries(Object.entries(a.tagLabels).map(([name, labels]) => [name, cleanLabels(labels, 40)])) : {},
      sourceUrl: text(a.sourceUrl),
      sourceName: text(a.sourceName),
      favorite: a.favorite === true,
      cover,
      ...(a.previewScale !== undefined ? { previewScale: previewScale(a.previewScale) } : {}),
      ...(a.previewViewport ? { previewViewport: previewViewport(a.previewViewport) } : {}),
      createdAt: text(a.createdAt) || new Date().toISOString(),
      updatedAt: text(a.updatedAt) || new Date().toISOString(),
      texts,
      variants,
      media,
    };
  });

  return { formatVersion: version, exportedAt: text(raw.exportedAt), categories, assets, files };
}

export function previewImport(lib: Library | null, pkg: ParsedPackage): ImportPreview {
  const duplicates = lib
    ? pkg.assets.flatMap(a => {
        const existing = lib.repo.getAsset(a.id);
        return existing ? [{ id: a.id, title: a.title, existingTitle: existing.title }] : [];
      })
    : [];
  return {
    formatVersion: pkg.formatVersion,
    exportedAt: pkg.exportedAt,
    assetCount: pkg.assets.length,
    categoryCount: pkg.categories.length,
    fileCount: pkg.assets.reduce((n, a) => n + a.media.length + a.variants.reduce((m, v) => m + v.files.length, 0), 0),
    duplicates,
    items: pkg.assets.map(a => ({ id: a.id, title: a.title, frameworks: a.variants.map(v => v.framework) })),
  };
}

/**
 * 把素材包合并进 lib。重复判断依据稳定的素材 ID：
 * skip 保留现有素材；overwrite 用包里的版本替换；copy 以新 ID 另存一份。
 */
export function importPackage(lib: Library, pkg: ParsedPackage, duplicates: DuplicateStrategy): ImportResult {
  const result: ImportResult = { created: 0, overwritten: 0, copied: 0, skipped: 0, libraryPath: lib.root };
  // 素材文件夹是手写的，分类和标签写成已有词的显示名时归到那个词；备份包按原样恢复
  if (!pkg.formatVersion) alignVocabulary(lib, pkg);

  // 分类按 ID 对应；ID 不同但名称相同时并入已有分类
  const categoryMap = new Map<string, string>();
  for (const c of pkg.categories) {
    const byId = lib.repo.getCategory(c.id);
    if (byId) {
      if (c.labels) lib.repo.setCategoryLabels(byId.id, { ...c.labels, ...byId.labels });
      categoryMap.set(c.id, byId.id);
      continue;
    }
    const byName = lib.repo.findCategoryByName(c.name);
    if (byName) categoryMap.set(c.id, byName.id);
    else categoryMap.set(c.id, lib.createCategory(c.name, c.id, c.sort).id);
    if (c.labels) {
      const mapped = categoryMap.get(c.id)!;
      lib.repo.setCategoryLabels(mapped, { ...c.labels, ...lib.repo.getCategory(mapped)?.labels });
    }
  }

  for (const a of pkg.assets) {
    const exists = !!lib.repo.getAsset(a.id);
    let id: string | undefined = a.id;
    let title = a.title;
    if (exists) {
      if (duplicates === 'skip') {
        result.skipped++;
        continue;
      }
      if (duplicates === 'overwrite') lib.deleteAsset(a.id);
      else {
        id = undefined;
        title = `${a.title}（导入副本）`;
      }
    }
    const created = lib.createAsset({
      title,
      type: a.type,
      categoryId: a.categoryId ? categoryMap.get(a.categoryId) ?? null : null,
      tags: a.tags,
      sourceUrl: a.sourceUrl,
      sourceName: a.sourceName,
      texts: a.texts,
      variants: a.variants,
      favorite: a.favorite,
      previewScale: a.previewScale,
      previewViewport: a.previewViewport,
    }, { id, createdAt: a.createdAt, updatedAt: a.updatedAt });
    const newId = created.id;
    const translatedTags = new Map(Object.entries(a.tagLabels ?? {}).map(([name, labels]) => [name.toLowerCase(), labels]));
    for (const tag of created.tags) {
      const labels = translatedTags.get(tag.toLowerCase());
      if (labels) {
        lib.repo.setTagLabels(tag, { ...labels, ...lib.repo.getTagLabels(tag) });
      }
    }
    lib.repo.transaction(() => {
      for (const f of a.media) lib.writeImportedMedia(newId, f.path, pkg.files[f.zipPath], { mime: f.mime, label: f.label });
      lib.repo.setCover(newId, a.cover ? `${assetDir(newId)}/${a.cover}` : null);
    });
    if (!exists) result.created++;
    else if (duplicates === 'overwrite') result.overwritten++;
    else result.copied++;
  }
  return result;
}
