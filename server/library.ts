import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { framework as frameworkInfo, FRAMEWORK_IDS } from '../shared/frameworks.ts';
import { LOCALE_IDS, normalizeLocale } from '../shared/locales.ts';
import { ASSET_ID_PATTERN, assetDir, extOf, isImage, mimeOf, normalizeRelPath, slugify } from '../shared/paths.ts';
import { ASSET_TYPES, type AssetDetail, type AssetInput, type AssetSummary, type AssetText, type Category, type CodeFile, type LibraryInfo, type Variant } from '../shared/types.ts';
import { Repository, type AssetRecord, type FileRecord, type VariantRecord } from './db/repository.ts';
import { migrate, SCHEMA_VERSION } from './db/schema.ts';
import { parseThemeContract, parseThemeIdeas, resolveTheme } from '../shared/theme.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import { previewScale, previewViewport } from '../shared/preview.ts';
import { cleanLabels } from '../shared/contentLocale.ts';

const MARKER = 'library.json';
const DB_FILE = 'library.db';
const MAX_CODE_BYTES = 2 * 1024 * 1024;

interface Marker {
  format: 'craft-every-aspect-library';
  libraryId: string;
  createdAt: string;
}

export const newId = (): string => crypto.randomUUID();
const now = () => new Date().toISOString();

/**
 * 用 staging 目录替换 target。Windows 上资源管理器或杀毒软件打开着 target 时整个目录改不了名，
 * 这时改为逐项替换 target 里的内容。
 */
function replaceDir(staging: string, target: string, old: string) {
  if (!fs.existsSync(target)) {
    fs.renameSync(staging, target);
    return;
  }
  try {
    fs.renameSync(target, old);
  } catch (e) {
    if (!['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e;
    fs.mkdirSync(old);
    for (const name of fs.readdirSync(target)) fs.renameSync(path.join(target, name), path.join(old, name));
    for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(target, name));
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    return;
  }
  fs.renameSync(staging, target);
  fs.rmSync(old, { recursive: true, force: true });
}

/**
 * 一个素材库目录：
 *   library.json  目录标识
 *   library.db    SQLite：素材信息、分类、标签、各语言文案、文件索引
 *   assets/<id>/code/<framework>/   各框架的实现代码
 *   assets/<id>/media/              截图、录屏等媒体
 * 数据库里只存相对路径，整个目录可以直接移动或复制。
 */
export class Library {
  readonly root: string;
  readonly libraryId: string;
  readonly repo: Repository;
  private db: DatabaseSync;

  private constructor(root: string, libraryId: string, db: DatabaseSync) {
    this.root = root;
    this.libraryId = libraryId;
    this.db = db;
    this.repo = new Repository(db);
  }

  static open(dir: string): Library {
    const root = path.resolve(dir);
    fs.mkdirSync(root, { recursive: true });
    const markerPath = path.join(root, MARKER);
    let marker: Marker;
    if (fs.existsSync(markerPath)) {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } else {
      const unexpected = fs.readdirSync(root).filter(name => !name.startsWith('.'));
      if (unexpected.length) {
        throw badRequest(`目录 ${root} 不是空目录，也不是素材库。请选择空目录或已有素材库。`);
      }
      marker = { format: 'craft-every-aspect-library', libraryId: newId(), createdAt: now() };
      fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
    }
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    const db = new DatabaseSync(path.join(root, DB_FILE));
    migrate(db, root);
    return new Library(root, marker.libraryId, db);
  }

  /** 判断目录能否作为素材库打开：不存在、空目录或已有素材库 */
  static check(dir: string): 'library' | 'empty' | 'occupied' {
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) return 'empty';
    if (!fs.statSync(root).isDirectory()) return 'occupied';
    if (fs.existsSync(path.join(root, MARKER))) return 'library';
    return fs.readdirSync(root).some(name => !name.startsWith('.')) ? 'occupied' : 'empty';
  }

  close() {
    this.db.close();
  }

  info(): LibraryInfo {
    return { path: this.root, libraryId: this.libraryId, schemaVersion: SCHEMA_VERSION, assetCount: this.repo.countAssets() };
  }

  /** 把库内相对路径转成绝对路径；越出库目录时返回 null */
  resolve(rel: string): string | null {
    const clean = normalizeRelPath(rel);
    if (!clean) return null;
    const abs = path.join(this.root, clean);
    return abs.startsWith(this.root + path.sep) ? abs : null;
  }

  // ---- 素材 ----

  listAssets(): AssetSummary[] {
    return this.repo.listAssets();
  }

  getAsset(id: string): AssetDetail {
    const record = this.repo.getAsset(id);
    if (!record) throw notFound('素材不存在或已被删除');
    const files = this.repo.listFiles(id);
    const variants = this.repo.getVariants(id).map(v => this.readVariant(id, v, files));
    const texts = this.repo.getTexts(id);
    return {
      ...record,
      tags: this.repo.getTags(id),
      frameworks: variants.map(v => v.framework),
      locales: Object.keys(texts),
      texts,
      variants,
      media: files.filter(f => f.role === 'media').map(({ framework: _, ...f }) => f),
    };
  }

  getPlayback(id: string, framework?: string) {
    const asset = this.repo.getAsset(id);
    if (!asset) throw notFound('素材不存在或已被删除');
    const variants = this.repo.getVariants(id);
    const variant = framework ? variants.find(v => v.framework === framework) : variants[0];
    if (!variant) throw notFound('这个素材没有该框架的实现');
    return { asset, variant: this.readVariant(id, variant, this.repo.listFiles(id)) };
  }

  private readVariant(id: string, { supportsDarkMode: _, ...variant }: VariantRecord, files: ReturnType<Repository['listFiles']>): Variant {
    const prefix = `${assetDir(id)}/code/${variant.framework}/`;
    const code = files.filter(f => f.role === 'code' && f.framework === variant.framework).map(f => {
      const abs = this.resolve(f.path);
      return { path: f.path.slice(prefix.length), content: abs && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '' };
    });
    const resolved = resolveTheme({ ...variant, files: code });
    return { ...variant, files: code, ...(resolved.mode === 'both' ? { supportsDarkMode: true } : {}) };
  }

  createAsset(input: AssetInput, options: { id?: string; createdAt?: string; updatedAt?: string } = {}): AssetDetail {
    const clean = this.validate(input);
    const requested = (options.id ?? input.id ?? '').trim();
    if (requested && !ASSET_ID_PATTERN.test(requested)) throw badRequest('素材 ID 只能用小写字母、数字和连字符，最长 64 个字符');
    if (requested && this.repo.getAsset(requested)) throw conflict(`素材 ID「${requested}」已被占用`);
    const id = requested || this.uniqueId(clean.title);
    const record: AssetRecord = {
      id,
      title: clean.title,
      type: clean.type!,
      categoryId: clean.categoryId,
      sourceUrl: clean.sourceUrl,
      sourceName: clean.sourceName,
      favorite: !!clean.favorite,
      cover: null,
      previewScale: clean.previewScale,
      previewViewport: clean.previewViewport,
      createdAt: options.createdAt ?? now(),
      updatedAt: options.updatedAt ?? options.createdAt ?? now(),
    };
    const written = this.writeCode(id, clean.variants);
    try {
      this.repo.transaction(() => {
        this.repo.insertAsset(record);
        this.saveParts(id, clean, written);
      });
    } catch (e) {
      fs.rmSync(this.absAssetDir(id), { recursive: true, force: true });
      throw e;
    }
    return this.getAsset(id);
  }

  updateAsset(id: string, input: AssetInput): AssetDetail {
    const existing = this.repo.getAsset(id);
    if (!existing) throw notFound('素材不存在或已被删除');
    const oldVariants = this.repo.getVariants(id);
    const oldTexts = this.repo.getTexts(id);
    const suppliedLocales = new Set(Object.keys(input.texts ?? {}).map(normalizeLocale));
    // 旧客户端可能只提交它认识的语言；未提交的外部语言需保留。
    const retainedTexts = Object.fromEntries(Object.entries(oldTexts).filter(([locale]) =>
      !LOCALE_IDS.includes(locale) && !suppliedLocales.has(locale)));
    const clean = this.validate({
      ...input,
      variants: (input.variants ?? []).map(v => !Object.hasOwn(v, 'theme') && oldVariants.find(old => old.framework === v.framework)?.theme
        ? { ...v, theme: oldVariants.find(old => old.framework === v.framework)!.theme } : v),
      texts: { ...retainedTexts, ...Object.fromEntries(Object.entries(input.texts ?? {}).map(([locale, text]) => {
        const old = oldTexts[normalizeLocale(locale) ?? locale];
        return [locale, {
          ...(!Object.hasOwn(text, 'title') && old?.title ? { title: old.title } : {}),
          ...(!Object.hasOwn(text, 'themeIdeas') && old?.themeIdeas ? { themeIdeas: old.themeIdeas } : {}),
          ...text,
        }];
      })) },
    });
    const written = this.writeCode(id, clean.variants);
    this.repo.transaction(() => {
      this.repo.updateAsset({
        ...existing,
        title: clean.title,
        type: clean.type!,
        categoryId: clean.categoryId,
        sourceUrl: clean.sourceUrl,
        sourceName: clean.sourceName,
        favorite: clean.favorite ?? existing.favorite,
        previewScale: input.previewScale === undefined ? existing.previewScale : clean.previewScale,
        previewViewport: input.previewViewport === undefined ? existing.previewViewport : clean.previewViewport,
        updatedAt: now(),
      });
      this.saveParts(id, clean, written);
    });
    return this.getAsset(id);
  }

  deleteAsset(id: string) {
    this.manageAssets([id], 'delete');
  }

  setFavorite(id: string, favorite: boolean) {
    if (!this.repo.setFavorite(id, favorite)) throw notFound('素材不存在或已被删除');
  }

  // ---- 媒体 ----

  addMedia(id: string, fileName: string, data: Uint8Array, label = ''): AssetDetail {
    if (!this.repo.getAsset(id)) throw notFound('素材不存在或已被删除');
    const base = normalizeRelPath(path.basename(fileName.replace(/\\/g, '/')));
    if (!base) throw badRequest('文件名不合法');
    const mime = mimeOf(base);
    if (!mime.startsWith('image/') && !mime.startsWith('video/')) throw badRequest('只能上传图片或视频');
    const rel = this.uniqueMediaPath(id, base);
    const abs = this.resolve(rel)!;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    this.repo.transaction(() => {
      this.repo.addFile(id, { role: 'media', framework: '', path: rel, mime, size: data.byteLength, label });
      const asset = this.repo.getAsset(id)!;
      if (!asset.cover && isImage(mime)) this.repo.setCover(id, rel);
      this.repo.touch(id, now());
    });
    return this.getAsset(id);
  }

  updateMedia(id: string, fileId: number, patch: { label?: string; cover?: boolean }): AssetDetail {
    const file = this.repo.getFile(id, fileId);
    if (!file || file.role !== 'media') throw notFound('文件不存在');
    this.repo.transaction(() => {
      if (patch.label !== undefined) this.repo.updateFileLabel(id, fileId, patch.label.trim().slice(0, 200));
      if (patch.cover === true) {
        if (!isImage(file.mime)) throw badRequest('封面需要是图片');
        this.repo.setCover(id, file.path);
      } else if (patch.cover === false && this.repo.getAsset(id)?.cover === file.path) {
        this.repo.setCover(id, null);
      }
    });
    return this.getAsset(id);
  }

  deleteMedia(id: string, fileId: number): AssetDetail {
    const file = this.repo.getFile(id, fileId);
    if (!file || file.role !== 'media') throw notFound('文件不存在');
    this.repo.transaction(() => {
      this.repo.deleteFile(id, fileId);
      if (this.repo.getAsset(id)?.cover === file.path) {
        const nextCover = this.repo.listFiles(id, 'media').find(f => isImage(f.mime));
        this.repo.setCover(id, nextCover?.path ?? null);
      }
    });
    const abs = this.resolve(file.path);
    if (abs) fs.rmSync(abs, { force: true });
    return this.getAsset(id);
  }

  /** 导入时直接写入一份媒体文件，rel 是相对素材目录的路径，例如 media/a.png */
  writeImportedMedia(id: string, rel: string, data: Uint8Array, meta: { mime: string; label: string }) {
    const target = `${assetDir(id)}/${rel}`;
    const abs = this.resolve(target);
    if (!abs) throw badRequest(`文件路径不合法：${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    this.repo.addFile(id, { role: 'media', framework: '', path: target, mime: meta.mime, size: data.byteLength, label: meta.label });
  }

  // ---- 分类与标签 ----

  listCategories(): Category[] {
    return this.repo.listCategories();
  }

  createCategory(name: string, id = newId(), sort?: number): Category {
    const clean = name.trim();
    if (!clean) throw badRequest('分类名称不能为空');
    if (this.repo.findCategoryByName(clean)) throw conflict('已有同名分类');
    this.repo.insertCategory(id, clean.slice(0, 40), sort);
    return this.repo.getCategory(id)!;
  }

  updateCategory(id: string, patch: { name?: string; sort?: number; labels?: Record<string, string> }): Category {
    const current = this.repo.getCategory(id);
    if (!current) throw notFound('分类不存在');
    const name = patch.name?.trim() ?? current.name;
    if (!name) throw badRequest('分类名称不能为空');
    const same = this.repo.findCategoryByName(name);
    if (same && same.id !== id) throw conflict('已有同名分类');
    this.repo.updateCategory(id, name.slice(0, 40), patch.sort ?? current.sort);
    if (patch.labels !== undefined) this.repo.setCategoryLabels(id, cleanLabels(patch.labels, 40));
    return this.repo.getCategory(id)!;
  }

  deleteCategory(id: string) {
    if (!this.repo.deleteCategory(id)) throw notFound('分类不存在');
  }

  renameTag(from: string, to: string, labels?: unknown) {
    const name = to.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 30);
    if (!name) throw badRequest('标签名称不能为空');
    this.repo.transaction(() => {
      if (!this.repo.renameTag(from, name)) throw notFound('标签不存在');
      if (labels !== undefined) this.repo.setTagLabels(name, cleanLabels(labels, 40));
    });
  }

  setTagLabels(name: string, labels: unknown) {
    if (!this.repo.setTagLabels(name, cleanLabels(labels, 40))) throw notFound('标签不存在');
  }

  deleteTag(name: string) {
    if (!this.repo.deleteTag(name)) throw notFound('标签不存在');
  }

  manageTags(names: string[], action: 'delete' | 'merge', target = '') {
    const unique = [...new Set(names.map(n => n.toLowerCase()))];
    const known = new Map(this.repo.listTags().map(t => [t.name.toLowerCase(), t.name]));
    if (!unique.length || unique.length > 2000) throw badRequest('请选择 1 至 2000 个标签');
    if (unique.some(n => !known.has(n))) throw notFound('部分标签已不存在，请刷新后重试');
    const clean = target.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 30);
    if (action === 'merge' && !clean) throw badRequest('合并后的标签名称不能为空');
    this.repo.transaction(() => {
      for (const name of unique) {
        if (action === 'delete') this.repo.deleteTag(known.get(name)!);
        else this.repo.renameTag(known.get(name)!, clean);
      }
    });
    return { changed: unique.length };
  }

  manageAssets(ids: string[], action: 'delete' | 'tag' | 'category', value = '') {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.length > 1000) throw badRequest('请选择 1 至 1000 个组件');
    if (unique.some(id => !this.repo.getAsset(id))) throw notFound('部分组件已不存在，请刷新后重试');
    if (action === 'delete') {
      const trash = path.join(this.root, `.trash-${crypto.randomUUID()}`);
      const moved: string[] = [];
      fs.mkdirSync(trash);
      try {
        for (const id of unique) {
          const source = this.absAssetDir(id);
          if (fs.existsSync(source)) { fs.renameSync(source, path.join(trash, id)); moved.push(id); }
        }
        this.repo.transaction(() => { for (const id of unique) this.repo.deleteAsset(id); });
      } catch (e) {
        for (const id of moved) fs.renameSync(path.join(trash, id), this.absAssetDir(id));
        fs.rmSync(trash, { recursive: true, force: true });
        throw e;
      }
      try { fs.rmSync(trash, { recursive: true, force: true }); } catch (e) { console.error('组件已删除，临时目录清理失败：', trash, e); }
    } else {
      const tag = value.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 30);
      if (action === 'tag' && !tag) throw badRequest('标签名称不能为空');
      if (action === 'category' && value && !this.repo.getCategory(value)) throw notFound('分类不存在');
      this.repo.transaction(() => {
        for (const id of unique) {
          if (action === 'tag') this.repo.setTags(id, [...this.repo.getTags(id), tag]);
          else this.repo.updateAsset({ ...this.repo.getAsset(id)!, categoryId: value || null });
        }
      });
    }
    return { changed: unique.length };
  }

  // ---- 内部 ----

  private absAssetDir(id: string) {
    return path.join(this.root, 'assets', id);
  }

  private saveParts(id: string, clean: AssetInput, written: FileRecord[]) {
    this.repo.setTags(id, clean.tags);
    this.repo.setTexts(id, clean.texts);
    this.repo.setVariants(id, clean.variants);
    this.repo.replaceCodeFiles(id, written);
  }

  /** 根据名称生成可读的 ID，例如 weather-day-switcher；中文名称没有可用字母时用随机后缀 */
  private uniqueId(title: string): string {
    const base = slugify(title) || 'asset';
    if (!this.repo.getAsset(base) && base !== 'asset') return base;
    for (;;) {
      const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
      if (!this.repo.getAsset(candidate)) return candidate;
    }
  }

  private uniqueMediaPath(id: string, base: string): string {
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 0; ; i++) {
      const name = i ? `${stem}-${i + 1}${ext}` : base;
      const rel = `${assetDir(id)}/media/${name}`;
      if (!fs.existsSync(this.resolve(rel)!)) return rel;
    }
  }

  /**
   * 先把代码写到临时目录，成功后再替换旧的 code 目录，
   * 避免写到一半失败时留下新旧混杂的文件。
   */
  private writeCode(id: string, variants: Variant[]): FileRecord[] {
    const dir = this.absAssetDir(id);
    const target = path.join(dir, 'code');
    const staging = path.join(dir, `.code-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(staging, { recursive: true });
    const records: FileRecord[] = [];
    try {
      for (const v of variants) {
        for (const file of v.files) {
          const abs = path.join(staging, v.framework, file.path);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content);
          records.push({
            role: 'code',
            framework: v.framework,
            path: `${assetDir(id)}/code/${v.framework}/${file.path}`,
            mime: mimeOf(file.path),
            size: Buffer.byteLength(file.content),
            label: '',
          });
        }
      }
      replaceDir(staging, target, path.join(dir, `.old-${crypto.randomBytes(4).toString('hex')}`));
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    return records;
  }

  private validate(input: AssetInput): AssetInput {
    const title = String(input.title ?? '').trim();
    if (!title) throw badRequest('请填写素材名称');
    const type = input.type ?? 'component';
    if (!ASSET_TYPES.some(t => t.id === type)) throw badRequest('素材类型不正确');
    if (input.categoryId && !this.repo.getCategory(input.categoryId)) throw badRequest('分类不存在');
    if (input.previewScale !== undefined && (typeof input.previewScale !== 'number' || !Number.isFinite(input.previewScale))) throw badRequest('预览缩放必须是有效数字');
    if (input.previewViewport != null && !previewViewport(input.previewViewport)) throw badRequest('预览画布需要有效的宽度和高度');

    // 未安装语言包的文案也保留；语言码仍需合法，空内容不存。
    const texts: Record<string, AssetText> = {};
    for (const [loc, t] of Object.entries(input.texts ?? {})) {
      const language = normalizeLocale(loc);
      if (!language) throw badRequest(`语言代码无效：${loc}`);
      if (Object.hasOwn(texts, language)) throw badRequest(`语言代码重复：${loc}`);
      const summary = String(t?.summary ?? '').trim().slice(0, 2000);
      const idea = String(t?.idea ?? '').trim().slice(0, 20000);
      const title = String(t?.title ?? '').trim().slice(0, 120);
      let themeIdeas: AssetText['themeIdeas'];
      try { themeIdeas = parseThemeIdeas(t?.themeIdeas); }
      catch (e) { throw badRequest((e as Error).message); }
      if (summary || idea || title || themeIdeas) texts[language] = { ...(title ? { title } : {}), summary, idea, ...(themeIdeas ? { themeIdeas } : {}) };
    }

    let total = 0;
    const variants: Variant[] = [];
    for (const v of input.variants ?? []) {
      const info = frameworkInfo(String(v.framework));
      if (!info) throw badRequest(`不支持的框架：${v.framework}，可选 ${FRAMEWORK_IDS.join('、')}`);
      if (variants.some(x => x.framework === info.id)) throw badRequest(`${info.label} 实现重复`);
      const seen = new Set<string>();
      const files: CodeFile[] = [];
      for (const file of v.files ?? []) {
        const p = normalizeRelPath(String(file.path ?? ''));
        if (!p) throw badRequest(`文件名不合法：${file.path}`);
        if (seen.has(p.toLowerCase())) throw badRequest(`${info.label} 实现里文件名重复：${p}`);
        seen.add(p.toLowerCase());
        const content = String(file.content ?? '');
        total += Buffer.byteLength(content);
        files.push({ path: p, content });
      }
      // HTML 固定三个文件；其他框架的入口可以改名，但必须是存在的文件
      for (const p of info.fixed ?? []) if (!files.some(f => f.path === p)) files.push({ path: p, content: '' });
      const entry = info.fixed ? info.entry : normalizeRelPath(String(v.entry || info.entry)) ?? '';
      if (!files.some(f => f.path === entry && f.content.trim())) throw badRequest(`${info.label} 实现缺少入口文件 ${entry || info.entry}`);
      if (!info.entryExt.includes(extOf(entry))) throw badRequest(`${info.label} 的入口文件需要是 ${info.entryExt.map(e => '.' + e).join(' / ')}`);

      const dependencies: Record<string, string> = {};
      for (const [name, version] of Object.entries(v.dependencies ?? {})) {
        const n = name.trim();
        if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(n)) throw badRequest(`依赖名不合法：${name}`);
        dependencies[n] = String(version || 'latest').trim();
      }
      let theme: Variant['theme'];
      try { theme = parseThemeContract(v.theme); }
      catch (e) { throw badRequest((e as Error).message); }
      const support = resolveTheme({ files, theme });
      variants.push({ framework: info.id, entry, dependencies, files, ...(theme ? { theme } : {}), ...(support.mode === 'both' ? { supportsDarkMode: true } : {}) });
    }
    if (type === 'component' && !variants.length) throw badRequest('组件至少需要一种实现');
    if (total > MAX_CODE_BYTES) throw badRequest('代码总大小超过 2 MB');

    const tags = [...new Map(
      (input.tags ?? []).map(t => String(t).trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean).map(t => [t.toLowerCase(), t]),
    ).values()];
    return {
      title: title.slice(0, 120),
      type,
      categoryId: input.categoryId || null,
      tags,
      sourceUrl: String(input.sourceUrl ?? '').trim().slice(0, 500),
      sourceName: String(input.sourceName ?? '').trim().slice(0, 80),
      texts,
      variants,
      favorite: input.favorite,
      previewScale: previewScale(input.previewScale),
      previewViewport: previewViewport(input.previewViewport),
    };
  }
}
