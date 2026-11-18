import fs from 'node:fs';
import path from 'node:path';
import type { AssetQuery, AssetSummary } from '../../shared/types.ts';
import { Library } from '../library.ts';
import { libraryStatus, registeredLibraries, resolveCliLibrary, type LibraryTarget } from '../libraryRegistry.ts';

export function libraryFilePath(lib: Library, relative: string) {
  const candidate = lib.resolve(relative);
  if (!candidate) throw new Error(`资源路径越出素材库：${relative}`);
  const absolute = fs.realpathSync(candidate);
  const local = path.relative(lib.root, absolute);
  if (local === '..' || local.startsWith('..' + path.sep) || path.isAbsolute(local)) {
    throw new Error(`资源链接越出素材库：${relative}`);
  }
  return absolute;
}

function summary(target: LibraryTarget, asset: AssetSummary) {
  const { searchText: _, ...metadata } = asset;
  return {
    ...metadata, libraryId: target.id, libraryAlias: target.alias,
    cover: asset.cover ? path.join(target.path, asset.cover) : null,
  };
}

export function searchCatalog(query: AssetQuery, selector?: string, allLibraries = false) {
  if (allLibraries && selector) throw new Error('--all-libraries 和 --library 不能同时使用。');
  const targets: LibraryTarget[] = allLibraries
    ? registeredLibraries().sort((a, b) => a.alias.localeCompare(b.alias)).map(entry => ({ ...entry }))
    : [resolveCliLibrary(selector)];
  if (!targets.length) throw new Error('还没有注册素材库。使用 cea library add <目录> --alias <别名>。');
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  let offset = (page - 1) * limit;
  let total = 0;
  const items: ReturnType<typeof summary>[] = [];
  const errors: { libraryId: string; alias?: string; message: string }[] = [];
  for (const target of targets) {
    let lib: Library | undefined;
    try {
      if (allLibraries) {
        const status = libraryStatus({ ...target, alias: target.alias! });
        if (!status.available) throw new Error(status.error);
      }
      lib = Library.openExisting(target.path);
      const localPage = Math.floor(offset / limit) + 1;
      const batch = lib.repo.searchAssets({ ...query, page: localPage, limit });
      const count = batch.total;
      total += count;
      if (offset >= count) { offset -= count; continue; }
      const remaining = limit - items.length;
      if (remaining <= 0) continue;
      const start = offset % limit;
      const first = batch.items;
      const next = start + remaining > first.length && localPage * limit < count
        ? lib.repo.searchAssets({ ...query, page: localPage + 1, limit }).items : [];
      items.push(...[...first, ...next].slice(start, start + remaining).map(asset => summary(target, asset)));
      offset = 0;
    } catch (error) {
      if (!allLibraries) throw error;
      errors.push({ libraryId: target.id, alias: target.alias, message: error instanceof Error ? error.message : String(error) });
    } finally { lib?.close(); }
  }
  return { items, total, page, limit, complete: errors.length === 0, errors };
}

export function showComponent(id: string, selector?: string, framework?: string, metadataOnly = false) {
  const target = resolveCliLibrary(selector);
  const lib = Library.openExisting(target.path);
  try {
    const asset = lib.repo.getAsset(id);
    if (!asset || asset.deletedAt) throw new Error(`组件不存在或已移入回收站：${id}`);
    const variants = lib.repo.getVariants(id);
    const selected = framework ? variants.find(variant => variant.framework === framework) : variants[0];
    if (framework && !selected) throw new Error(`组件没有 ${framework} 实现：${id}`);
    const selectedFiles = lib.repo.listFiles(id).filter(file => file.framework === selected?.framework && file.role !== 'media');
    if (!metadataOnly) for (const file of selectedFiles) libraryFilePath(lib, file.path);
    return {
      library: target,
      asset: {
        ...asset, tags: lib.repo.getTags(id), texts: lib.repo.getTexts(id),
        frameworks: variants.map(variant => variant.framework),
        variants: metadataOnly ? variants : selected ? [lib.getPlayback(id, selected.framework).variant] : [],
        media: lib.repo.listFiles(id, 'media').map(file => ({ ...file, absolutePath: libraryFilePath(lib, file.path) })),
        resources: selectedFiles.filter(file => file.role === 'resource').map(file => ({ ...file, absolutePath: libraryFilePath(lib, file.path) })),
      },
    };
  } finally { lib.close(); }
}
