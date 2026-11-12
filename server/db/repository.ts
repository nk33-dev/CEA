import type { DatabaseSync } from 'node:sqlite';
import type { AssetFile, AssetSummary, AssetText, AssetType, Category, FileRole, TagCount, AssetPage, AssetQuery } from '../../shared/types.ts';
import { previewViewport, type PreviewViewport } from '../../shared/preview.ts';
import { parseThemeContract, type ThemeContract } from '../../shared/theme.ts';

/**
 * 所有 SQL 都在这个文件里。换数据库（例如 MySQL）时改这里的表结构和查询，
 * 上层的 Library 与 HTTP 接口保持不变。
 */

interface AssetRow {
  id: string;
  title: string;
  type: AssetType;
  category_id: string | null;
  source_url: string;
  source_name: string;
  favorite: number;
  cover: string | null;
  preview_scale: number;
  preview_viewport: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetRecord {
  id: string;
  title: string;
  type: AssetType;
  categoryId: string | null;
  sourceUrl: string;
  sourceName: string;
  favorite: boolean;
  cover: string | null;
  previewScale?: number;
  previewViewport?: PreviewViewport | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariantRecord {
  framework: string;
  entry: string;
  dependencies: Record<string, string>;
  supportsDarkMode?: boolean;
  theme?: ThemeContract | null;
}

export interface FileRecord {
  role: FileRole;
  framework: string;
  path: string;
  mime: string;
  size: number;
  label: string;
}

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    categoryId: row.category_id,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    favorite: !!row.favorite,
    cover: row.cover,
    ...(row.preview_scale !== 1 ? { previewScale: row.preview_scale } : {}),
    ...(row.preview_viewport ? { previewViewport: previewViewport(JSON.parse(row.preview_viewport)) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Repository {
  db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('begin immediate');
    try {
      const result = fn();
      this.db.exec('commit');
      return result;
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  // ---- 素材 ----

  /** 导出和旧接口读取全库；浏览页使用 searchAssets 的分页摘要。 */
  listAssets(ids?: string[], includeSearch = true): AssetSummary[] {
    if (ids && !ids.length) return [];
    const own = ids ? ` where asset_id in (${ids.map(() => '?').join(',')})` : '';
    const args = ids ?? [];
    const rows = this.db.prepare(`select * from assets${ids ? ` where id in (${ids.map(() => '?').join(',')})` : ''} order by updated_at desc`).all(...args) as unknown as AssetRow[];
    const tags = this.groupBy<{ asset_id: string; name: string }>(
      `select at.asset_id, t.name from asset_tags at join tags t on t.id = at.tag_id${own} order by at.position`, r => r.name, args);
    const frameworks = this.groupBy<{ asset_id: string; framework: string }>(
      `select asset_id, framework from variants${own} order by sort, framework`, r => r.framework, args);
    const texts = new Map<string, { locale: string; title: string; summary: string; idea: string; theme_ideas: string }[]>();
    for (const r of this.db.prepare(`select asset_id, locale, title, summary, ${includeSearch ? 'idea, theme_ideas' : "'' as idea, '{}' as theme_ideas"} from asset_texts${own}`).all(...args) as { asset_id: string; locale: string; title: string; summary: string; idea: string; theme_ideas: string }[]) {
      const list = texts.get(r.asset_id) ?? [];
      list.push(r);
      texts.set(r.asset_id, list);
    }
    return rows.map(row => {
      const own = texts.get(row.id) ?? [];
      const assetTags = tags.get(row.id) ?? [];
      return {
        ...toRecord(row),
        tags: assetTags,
        frameworks: frameworks.get(row.id) ?? [],
        locales: own.map(t => t.locale),
        summaries: Object.fromEntries(own.map(t => [t.locale, t.summary])),
        titles: Object.fromEntries(own.filter(t => t.title).map(t => [t.locale, t.title])),
        searchText: includeSearch ? [row.title, row.source_name, ...assetTags, ...own.flatMap(t => [t.title, t.summary, t.idea, ...Object.values(JSON.parse(t.theme_ideas))])].join('\n').toLowerCase() : '',
      };
    });
  }

  private groupBy<T extends { asset_id: string }>(sql: string, pick: (r: T) => string, args: string[] = []): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const r of this.db.prepare(sql).all(...args) as unknown as T[]) {
      const list = map.get(r.asset_id) ?? [];
      list.push(pick(r));
      map.set(r.asset_id, list);
    }
    return map;
  }

  searchAssets(query: AssetQuery): AssetPage {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(60, Math.max(1, Math.floor(query.limit ?? 24)));
    const match = (() => {
      const clauses: string[] = [];
      const args: (string | number)[] = [];
      for (const term of (query.q ?? '').slice(0, 200).trim().toLowerCase().split(/\s+/).filter(Boolean)) {
        clauses.push(`(
          instr(lower(a.title),?)>0
          or exists(select 1 from asset_texts x where x.asset_id=a.id and (instr(lower(x.title),?)>0 or instr(lower(x.summary),?)>0 or instr(lower(x.idea),?)>0
            or exists(select 1 from json_each(x.theme_ideas) where instr(lower(value),?)>0)))
          or exists(select 1 from asset_tags ax join tags tx on tx.id=ax.tag_id where ax.asset_id=a.id and (
            instr(lower(tx.name),?)>0 or exists(select 1 from json_each(tx.labels) where instr(lower(value),?)>0)
          ))
          or exists(select 1 from categories c where c.id=a.category_id and (
            instr(lower(c.name),?)>0 or exists(select 1 from json_each(c.labels) where instr(lower(value),?)>0)
          ))
        )`);
        args.push(term, term, term, term, term, term, term, term, term);
      }
      for (const tag of [...new Set(query.tags ?? [])]) {
        clauses.push('exists(select 1 from asset_tags ax join tags tx on tx.id=ax.tag_id where ax.asset_id=a.id and tx.name=? collate nocase)');
        args.push(tag);
      }
      return { sql: clauses.length ? ' where ' + clauses.join(' and ') : '', args };
    })();
    const where = (skip?: 'category' | 'framework' | 'favorite') => {
      const clauses: string[] = [];
      const args: string[] = [];
      if (query.category && skip !== 'category') { clauses.push('a.category_id=?'); args.push(query.category); }
      if (query.framework && skip !== 'framework') { clauses.push('exists(select 1 from variants v where v.asset_id=a.id and v.framework=?)'); args.push(query.framework); }
      if (query.favorite && skip !== 'favorite') clauses.push('a.favorite=1');
      return { sql: clauses.length ? ' where ' + clauses.join(' and ') : '', args };
    };
    const current = where();
    const category = where('category');
    const framework = where('framework');
    const favorite = where('favorite');
    const order = query.sort === 'title' ? 'a.title collate nocase, a.id' : query.sort === 'created' ? 'a.created_at desc, a.id' : 'a.updated_at desc, a.id';
    // 长文匹配只执行一次，分页和各筛选计数共用结果，避免每个计数重新扫描思路文本。
    const result = this.db.prepare(`
      with matched as materialized (select a.* from assets a${match.sql}),
      filtered as materialized (select a.* from matched a${current.sql}),
      category_counts as (
        select coalesce(a.category_id,'null') key,count(*) count from matched a${category.sql} group by a.category_id
      ),
      framework_counts as (
        select v.framework key,count(*) count from matched a join variants v on v.asset_id=a.id${framework.sql} group by v.framework
      ),
      tag_counts as (
        select t.name key,count(*) count from filtered a join asset_tags ax on ax.asset_id=a.id join tags t on t.id=ax.tag_id group by t.id
      ),
      favorite_count as (select coalesce(sum(a.favorite),0) n from matched a${favorite.sql})
      select
        (select count(*) from filtered) total,
        (select json_group_array(id) from (select a.id from filtered a order by ${order} limit ? offset ?)) ids,
        (select json_group_object(key,count) from category_counts) categories,
        (select json_group_object(key,count) from framework_counts) frameworks,
        (select json_group_object(key,count) from tag_counts) tags,
        (select n from favorite_count) favorite
    `).get(...match.args, ...current.args, ...category.args, ...framework.args, ...favorite.args, limit, (page - 1) * limit) as {
      total: number; ids: string; categories: string; frameworks: string; tags: string; favorite: number;
    };
    const ids = JSON.parse(result.ids) as string[];
    const items = this.listAssets(ids, false);
    const byId = new Map(items.map(a => [a.id, a]));
    return {
      items: ids.map(id => byId.get(id)!),
      total: result.total, page, limit,
      facets: {
        categories: JSON.parse(result.categories),
        frameworks: JSON.parse(result.frameworks),
        tags: JSON.parse(result.tags),
        favorite: result.favorite,
      },
    };
  }

  getAsset(id: string): AssetRecord | null {
    const row = this.db.prepare('select * from assets where id = ?').get(id) as AssetRow | undefined;
    return row ? toRecord(row) : null;
  }

  allAssetIds(): string[] {
    return (this.db.prepare('select id from assets order by created_at').all() as { id: string }[]).map(r => r.id);
  }

  insertAsset(a: AssetRecord) {
    this.db.prepare(`insert into assets (id, title, type, category_id, source_url, source_name, favorite, cover, created_at, updated_at, preview_scale, preview_viewport)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      a.id, a.title, a.type, a.categoryId, a.sourceUrl, a.sourceName, a.favorite ? 1 : 0, a.cover, a.createdAt, a.updatedAt, a.previewScale ?? 1, a.previewViewport ? JSON.stringify(a.previewViewport) : null,
    );
  }

  updateAsset(a: AssetRecord) {
    this.db.prepare(`update assets set title = ?, type = ?, category_id = ?, source_url = ?, source_name = ?, favorite = ?, cover = ?,
      created_at = ?, updated_at = ?, preview_scale = ?, preview_viewport = ? where id = ?`).run(
      a.title, a.type, a.categoryId, a.sourceUrl, a.sourceName, a.favorite ? 1 : 0, a.cover, a.createdAt, a.updatedAt, a.previewScale ?? 1, a.previewViewport ? JSON.stringify(a.previewViewport) : null, a.id,
    );
  }

  setFavorite(id: string, favorite: boolean): boolean {
    return this.db.prepare('update assets set favorite = ? where id = ?').run(favorite ? 1 : 0, id).changes > 0;
  }

  setCover(id: string, cover: string | null) {
    this.db.prepare('update assets set cover = ? where id = ?').run(cover, id);
  }

  touch(id: string, at: string) {
    this.db.prepare('update assets set updated_at = ? where id = ?').run(at, id);
  }

  deleteAsset(id: string): boolean {
    const changed = this.db.prepare('delete from assets where id = ?').run(id).changes > 0;
    this.pruneTags();
    return changed;
  }

  countAssets(): number {
    return (this.db.prepare('select count(*) n from assets').get() as { n: number }).n;
  }

  // ---- 文案 ----

  getTexts(assetId: string): Record<string, AssetText> {
    const rows = this.db.prepare('select locale, title, summary, idea, theme_ideas from asset_texts where asset_id = ? order by locale').all(assetId) as { locale: string; title: string; summary: string; idea: string; theme_ideas: string }[];
    return Object.fromEntries(rows.map(r => [r.locale, { ...(r.title ? { title: r.title } : {}), summary: r.summary, idea: r.idea, ...(r.theme_ideas !== '{}' ? { themeIdeas: JSON.parse(r.theme_ideas) } : {}) }]));
  }

  setTexts(assetId: string, texts: Record<string, AssetText>) {
    this.db.prepare('delete from asset_texts where asset_id = ?').run(assetId);
    const insert = this.db.prepare('insert into asset_texts(asset_id, locale, title, summary, idea, theme_ideas) values (?, ?, ?, ?, ?, ?)');
    for (const [loc, t] of Object.entries(texts)) {
      if (t.title?.trim() || t.summary.trim() || t.idea.trim() || Object.keys(t.themeIdeas ?? {}).length) insert.run(assetId, loc, t.title ?? '', t.summary, t.idea, JSON.stringify(t.themeIdeas ?? {}));
    }
  }

  // ---- 实现 ----

  getVariants(assetId: string): VariantRecord[] {
    const rows = this.db.prepare('select framework, entry, dependencies, supports_dark_mode, theme from variants where asset_id = ? order by sort, framework').all(assetId) as { framework: string; entry: string; dependencies: string; supports_dark_mode: number; theme: string | null }[];
    return rows.map(r => ({ framework: r.framework, entry: r.entry, dependencies: JSON.parse(r.dependencies || '{}'), ...(r.supports_dark_mode ? { supportsDarkMode: true } : {}), ...(r.theme ? { theme: parseThemeContract(JSON.parse(r.theme)) } : {}) }));
  }

  setVariants(assetId: string, variants: VariantRecord[]) {
    this.db.prepare('delete from variants where asset_id = ?').run(assetId);
    const insert = this.db.prepare('insert into variants(asset_id, framework, entry, dependencies, sort, supports_dark_mode, theme) values (?, ?, ?, ?, ?, ?, ?)');
    variants.forEach((v, i) => insert.run(assetId, v.framework, v.entry, JSON.stringify(v.dependencies), i, v.supportsDarkMode === true ? 1 : 0, v.theme ? JSON.stringify(v.theme) : null));
  }

  // ---- 标签 ----

  getTags(assetId: string): string[] {
    return (this.db.prepare('select t.name from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = ? order by at.position')
      .all(assetId) as { name: string }[]).map(r => r.name);
  }

  setTags(assetId: string, names: string[]) {
    this.db.prepare('delete from asset_tags where asset_id = ?').run(assetId);
    const upsert = this.db.prepare('insert into tags(name) values (?) on conflict(name) do nothing');
    const find = this.db.prepare('select id from tags where name = ? collate nocase');
    const link = this.db.prepare('insert or ignore into asset_tags(asset_id, tag_id, position) values (?, ?, ?)');
    names.forEach((name, position) => {
      upsert.run(name);
      const { id } = find.get(name) as { id: number };
      link.run(assetId, id, position);
    });
    this.pruneTags();
  }

  private pruneTags() {
    this.db.exec('delete from tags where id not in (select tag_id from asset_tags)');
  }

  listTags(): TagCount[] {
    const rows = this.db.prepare(`select t.name, t.labels, count(*) count from tags t join asset_tags at on at.tag_id = t.id
      group by t.id order by count desc, t.name collate nocase`).all() as unknown as (TagCount & { labels: string })[];
    return rows.map(({ labels, ...row }) => ({ ...row, ...(labels !== '{}' ? { labels: JSON.parse(labels) } : {}) }));
  }

  setTagLabels(name: string, labels: Record<string, string>): boolean {
    return this.db.prepare('update tags set labels=? where name=? collate nocase').run(JSON.stringify(labels), name).changes > 0;
  }

  getTagLabels(name: string): Record<string, string> {
    const row = this.db.prepare('select labels from tags where name=? collate nocase').get(name) as { labels: string } | undefined;
    return row ? JSON.parse(row.labels) : {};
  }

  /** 改名；新名字已存在时合并到那个标签 */
  renameTag(from: string, to: string): boolean {
    const src = this.db.prepare('select id from tags where name = ? collate nocase').get(from) as { id: number } | undefined;
    if (!src) return false;
    const dst = this.db.prepare('select id from tags where name = ? collate nocase').get(to) as { id: number } | undefined;
    if (!dst || dst.id === src.id) {
      this.db.prepare('update tags set name = ? where id = ?').run(to, src.id);
      return true;
    }
    this.db.prepare('insert or ignore into asset_tags(asset_id, tag_id, position) select asset_id, ?, position from asset_tags where tag_id = ?').run(dst.id, src.id);
    const labels = this.db.prepare('select labels from tags where id=?').get(src.id) as { labels: string };
    const targetLabels = this.db.prepare('select labels from tags where id=?').get(dst.id) as { labels: string };
    this.db.prepare('update tags set labels=? where id=?').run(JSON.stringify({ ...JSON.parse(labels.labels), ...JSON.parse(targetLabels.labels) }), dst.id);
    this.db.prepare('delete from tags where id = ?').run(src.id);
    return true;
  }

  deleteTag(name: string): boolean {
    return this.db.prepare('delete from tags where name = ? collate nocase').run(name).changes > 0;
  }

  // ---- 分类 ----

  listCategories(): Category[] {
    const rows = this.db.prepare(`select c.id, c.name, c.sort, c.labels, count(a.id) count from categories c
      left join assets a on a.category_id = c.id group by c.id order by c.sort, c.name collate nocase`).all() as unknown as (Category & { labels: string })[];
    return rows.map(({ labels, ...row }) => ({ ...row, ...(labels !== '{}' ? { labels: JSON.parse(labels) } : {}) }));
  }

  setCategoryLabels(id: string, labels: Record<string, string>): boolean {
    return this.db.prepare('update categories set labels=? where id=?').run(JSON.stringify(labels), id).changes > 0;
  }

  getCategory(id: string): Category | null {
    return this.listCategories().find(c => c.id === id) ?? null;
  }

  findCategoryByName(name: string): Category | null {
    return this.listCategories().find(c => c.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  insertCategory(id: string, name: string, sort?: number) {
    const next = sort ?? (this.db.prepare('select coalesce(max(sort), -1) + 1 n from categories').get() as { n: number }).n;
    this.db.prepare('insert into categories(id, name, sort) values (?, ?, ?)').run(id, name, next);
  }

  updateCategory(id: string, name: string, sort: number): boolean {
    return this.db.prepare('update categories set name = ?, sort = ? where id = ?').run(name, sort, id).changes > 0;
  }

  deleteCategory(id: string): boolean {
    return this.db.prepare('delete from categories where id = ?').run(id).changes > 0;
  }

  // ---- 文件 ----

  listFiles(assetId: string, role?: FileRole): (AssetFile & { framework: string })[] {
    const rows = role
      ? this.db.prepare('select id, role, framework, path, mime, size, label from files where asset_id = ? and role = ? order by id').all(assetId, role)
      : this.db.prepare('select id, role, framework, path, mime, size, label from files where asset_id = ? order by role, id').all(assetId);
    return rows as unknown as (AssetFile & { framework: string })[];
  }

  getFile(assetId: string, fileId: number): AssetFile | null {
    const row = this.db.prepare('select id, role, path, mime, size, label from files where asset_id = ? and id = ?').get(assetId, fileId);
    return (row as unknown as AssetFile | undefined) ?? null;
  }

  replaceCodeFiles(assetId: string, files: FileRecord[]) {
    this.db.prepare(`delete from files where asset_id = ? and role = 'code'`).run(assetId);
    for (const f of files) this.addFile(assetId, f);
  }

  addFile(assetId: string, f: FileRecord): number {
    this.db.prepare(`insert into files(asset_id, role, framework, path, mime, size, label) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(asset_id, path) do update set role = excluded.role, framework = excluded.framework, mime = excluded.mime, size = excluded.size, label = excluded.label`)
      .run(assetId, f.role, f.framework, f.path, f.mime, f.size, f.label);
    const row = this.db.prepare('select id from files where asset_id = ? and path = ?').get(assetId, f.path) as { id: number };
    return row.id;
  }

  updateFileLabel(assetId: string, fileId: number, label: string): boolean {
    return this.db.prepare('update files set label = ? where asset_id = ? and id = ?').run(label, assetId, fileId).changes > 0;
  }

  deleteFile(assetId: string, fileId: number): boolean {
    return this.db.prepare('delete from files where asset_id = ? and id = ?').run(assetId, fileId).changes > 0;
  }
}
