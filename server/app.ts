import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { framework as frameworkInfo } from '../shared/frameworks.ts';
import { mimeOf, normalizeRelPath } from '../shared/paths.ts';
import { readTagQuery } from '../shared/search.ts';
import type { AssetInput, DuplicateStrategy, Variant } from '../shared/types.ts';
import { bundle } from './bundler.ts';
import { bundlePlayPage, htmlPlayPage } from './play.ts';
import { configDir, forgetLibrary, LOCAL_CLI, readConfig, rememberLibrary } from './config.ts';
import { listDir, makeDir, reveal } from './fsBrowse.ts';
import { badRequest, HttpError, notFound } from './errors.ts';
import { Library } from './library.ts';
import { folderFiles, parseFolderFiles, readFolder, writeFolder, type FolderPackage } from './transfer/folder.ts';
import { exportLibrary, exportReferencePackage, importPackage, isBackupPackage, parsePackageFiles, previewImport, unzipSafe, type ParsedPackage } from './transfer/zip.ts';
import { zipSync } from 'fflate';
import { parseThemeContract, resolveTheme } from '../shared/theme.ts';

export interface AppState {
  lib: Library | null;
}

/** 文本文件统一按 UTF-8 返回，素材没写 <meta charset> 时也不会乱码 */
function withCharset(mime: string) {
  return /^text\/|json|svg/.test(mime) ? `${mime}; charset=utf-8` : mime;
}

function asyncRoute(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve().then(() => fn(req, res)).catch(next);
  };
}

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v.join('/') : String(v ?? '');
}

function sendZip(res: Response, data: Uint8Array, fileName: string) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

function safeFileName(title: string) {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 60) || 'asset';
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

/** revalidate：地址带内容版本时，浏览器每次先问一下，内容没变就用本地副本（304） */
async function sendPlay(res: Response, key: string, title: string, variant: Variant, revalidate = false) {
  let html: string;
  if (variant.framework === 'html') {
    html = htmlPlayPage(title, variant.files, { theme: resolveTheme(variant) });
  } else {
    const result = await bundle(variant.framework, key, variant.files, variant.entry);
    html = bundlePlayPage(title, result.code, result.error, { theme: resolveTheme(variant) });
  }
  res.setHeader('Cache-Control', revalidate ? 'private, no-cache' : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('text/html; charset=utf-8').send(html);
}

export function createApp(current: AppState, options: { distDir?: string } = {}) {
  // 文件夹选择在未配置时也可使用，依赖素材库的路由统一拒绝未配置状态。
  const state = {
    get lib(): Library {
      if (!current.lib) throw new HttpError(409, '请先选择素材库位置');
      return current.lib;
    },
    set lib(next: Library) { current.lib = next; },
  };
  const app = express();
  app.disable('x-powered-by');

  // 预览 iframe 运行在无同源权限的沙箱里。修改类请求要求自定义请求头，
  // 跨源页面带不上这个头（会触发预检并失败），沙箱里的素材代码就改不了库。
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-cea-client') !== '1') {
      res.status(403).json({ error: '请求来源不被允许' });
      return;
    }
    next();
  });

  const json = express.json({ limit: '8mb' });
  const raw = express.raw({ type: () => true, limit: '2gb' });
  const pendingImports = new Map<string, { pkg: ParsedPackage; at: number }>();

  /** 备份包按原样恢复；其他 ZIP 和文件夹按素材文件夹格式解析 */
  const stage = (files: Record<string, Uint8Array>, name: string) => {
    const pkg: ParsedPackage | FolderPackage = isBackupPackage(files) ? parsePackageFiles(files) : parseFolderFiles(files, name);
    const token = crypto.randomUUID();
    const cutoff = Date.now() - 30 * 60_000;
    for (const [k, v] of pendingImports) if (v.at < cutoff) pendingImports.delete(k);
    pendingImports.set(token, { pkg, at: Date.now() });
    const problems = (pkg as Partial<FolderPackage>).problems ?? [];
    return { token, preview: { ...previewImport(state.lib, pkg), source: pkg.formatVersion ? 'backup' as const : 'folder' as const, problems } };
  };

  const libraryInfo = () => {
    const current = state.lib.root.toLowerCase();
    const recent = (readConfig().recentLibraries ?? [])
      .filter(p => path.resolve(p).toLowerCase() !== current)
      .map(p => ({ path: p, available: Library.check(p) === 'library' }));
    return { ...state.lib.info(), recent, configDir: configDir(), cli: LOCAL_CLI };
  };

  // ---- 素材库 ----

  app.get('/api/library', (_req, res) => {
    res.json(current.lib ? libraryInfo() : null);
  });

  app.delete('/api/library/recent', json, (req, res) => {
    forgetLibrary(String(req.body?.path ?? ''));
    res.json(libraryInfo());
  });

  app.put('/api/library', json, asyncRoute((req, res) => {
    const target = String(req.body?.path ?? '').trim();
    if (!target || !path.isAbsolute(target)) throw badRequest('请填写素材库目录的完整路径');
    const kind = Library.check(target);
    if (kind === 'occupied') throw badRequest('该目录已有其他文件。请选择空目录或已有素材库。');
    if (current.lib?.root === path.resolve(target)) {
      rememberLibrary(current.lib.root);
      res.json(libraryInfo());
      return;
    }
    const next = Library.open(target);
    try {
      rememberLibrary(next.root);
    } catch (e) {
      next.close();
      throw e;
    }
    current.lib?.close();
    state.lib = next;
    res.json(libraryInfo());
  }));

  // ---- 本机文件夹 ----

  app.get('/api/fs', asyncRoute((req, res) => {
    res.json(listDir(String(req.query.path ?? '')));
  }));
  app.post('/api/fs/mkdir', json, asyncRoute((req, res) => {
    res.json({ path: makeDir(String(req.body?.parent ?? ''), String(req.body?.name ?? '')) });
  }));
  app.post('/api/fs/reveal', json, asyncRoute((req, res) => {
    reveal(String(req.body?.path ?? '') || state.lib.root);
    res.status(204).end();
  }));

  // ---- 素材 ----

  app.get('/api/assets', (req, res) => {
    if (req.query.paged !== '1') { res.json(state.lib.listAssets()); return; }
    const num = (v: unknown, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;
    const tags = readTagQuery(String(req.query.tags ?? ''));
    if (tags.length > 30) { res.status(400).json({ error: '最多同时筛选 30 个标签' }); return; }
    res.json(state.lib.repo.searchAssets({
      q: String(req.query.q ?? '').slice(0, 200),
      category: String(req.query.category ?? ''),
      framework: String(req.query.fw ?? ''),
      tags,
      favorite: req.query.fav === '1',
      sort: req.query.sort === 'title' ? 'title' : req.query.sort === 'created' ? 'created' : 'updated',
      page: num(req.query.page, 1), limit: num(req.query.limit, 24),
    }));
  });

  app.post('/api/assets', json, asyncRoute((req, res) => {
    res.status(201).json(state.lib.createAsset(req.body as AssetInput));
  }));
  app.post('/api/assets/batch', json, asyncRoute((req, res) => {
    if (!Array.isArray(req.body?.ids) || !req.body.ids.every((id: unknown) => typeof id === 'string')) throw badRequest('请选择组件');
    if (!['delete', 'tag', 'category'].includes(req.body.action)) throw badRequest('不支持的批量操作');
    res.json(state.lib.manageAssets(req.body.ids, req.body.action, String(req.body.value ?? '')));
  }));

  app.get('/api/assets/:id', asyncRoute((req, res) => {
    res.json(state.lib.getAsset(param(req, 'id')));
  }));

  app.put('/api/assets/:id', json, asyncRoute((req, res) => {
    res.json(state.lib.updateAsset(param(req, 'id'), req.body as AssetInput));
  }));

  app.delete('/api/assets/:id', asyncRoute((req, res) => {
    state.lib.deleteAsset(param(req, 'id'));
    res.status(204).end();
  }));

  app.put('/api/assets/:id/favorite', json, asyncRoute((req, res) => {
    state.lib.setFavorite(param(req, 'id'), req.body?.favorite === true);
    res.json({ favorite: req.body?.favorite === true });
  }));

  app.post('/api/assets/:id/media', raw, asyncRoute((req, res) => {
    const name = String(req.query.name ?? '');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('文件为空');
    res.status(201).json(state.lib.addMedia(param(req, 'id'), name, req.body, String(req.query.label ?? '')));
  }));

  app.patch('/api/assets/:id/media/:fileId', json, asyncRoute((req, res) => {
    res.json(state.lib.updateMedia(param(req, 'id'), Number(param(req, 'fileId')), req.body ?? {}));
  }));

  app.delete('/api/assets/:id/media/:fileId', asyncRoute((req, res) => {
    res.json(state.lib.deleteMedia(param(req, 'id'), Number(param(req, 'fileId'))));
  }));

  app.get('/api/assets/:id/package', asyncRoute((req, res) => {
    const id = param(req, 'id');
    const asset = state.lib.getAsset(id);
    sendZip(res, exportReferencePackage(state.lib, id), `${safeFileName(asset.title)}-参考包.zip`);
  }));

  // ---- 分类与标签 ----

  app.get('/api/categories', (_req, res) => {
    res.json(state.lib.listCategories());
  });
  app.post('/api/categories/batch', json, asyncRoute((req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || !ids.every((id: unknown) => typeof id === 'string')) throw badRequest('请选择分类');
    if (ids.some((id: string) => !state.lib.repo.getCategory(id))) throw notFound('部分分类已不存在');
    state.lib.repo.transaction(() => { for (const id of new Set(ids as string[])) state.lib.repo.deleteCategory(id); });
    res.json({ changed: new Set(ids).size });
  }));
  app.post('/api/categories/order', json, asyncRoute((req, res) => {
    const ids = req.body?.ids;
    const categories = state.lib.repo.listCategories();
    if (!Array.isArray(ids) || ids.length !== categories.length || new Set(ids).size !== ids.length || ids.some(id => !categories.some(c => c.id === id))) throw badRequest('分类顺序已变化，请刷新后重试');
    state.lib.repo.transaction(() => ids.forEach((id: string, sort: number) => {
      state.lib.repo.updateCategory(id, categories.find(c => c.id === id)!.name, sort);
    }));
    res.status(204).end();
  }));

  app.post('/api/categories', json, asyncRoute((req, res) => {
    res.status(201).json(state.lib.createCategory(String(req.body?.name ?? '')));
  }));

  app.patch('/api/categories/:id', json, asyncRoute((req, res) => {
    res.json(state.lib.updateCategory(param(req, 'id'), req.body ?? {}));
  }));

  app.delete('/api/categories/:id', asyncRoute((req, res) => {
    state.lib.deleteCategory(param(req, 'id'));
    res.status(204).end();
  }));

  app.get('/api/tags', (_req, res) => {
    res.json(state.lib.repo.listTags());
  });
  app.post('/api/tags/batch', json, asyncRoute((req, res) => {
    if (!Array.isArray(req.body?.names) || !req.body.names.every((n: unknown) => typeof n === 'string')) throw badRequest('请选择标签');
    if (!['delete', 'merge'].includes(req.body.action)) throw badRequest('不支持的标签操作');
    res.json(state.lib.manageTags(req.body.names, req.body.action, String(req.body.target ?? '')));
  }));

  app.patch('/api/tags/:name', json, asyncRoute((req, res) => {
    const name = param(req, 'name');
    if (req.body?.name !== undefined) state.lib.renameTag(name, String(req.body.name), req.body.labels);
    else if (req.body?.labels !== undefined) state.lib.setTagLabels(name, req.body.labels);
    else throw badRequest('请填写标签名称或译名');
    res.status(204).end();
  }));

  app.delete('/api/tags/:name', asyncRoute((req, res) => {
    state.lib.deleteTag(param(req, 'name'));
    res.status(204).end();
  }));

  // ---- 导入导出 ----

  app.post('/api/export', json, asyncRoute((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String) : undefined;
    for (const id of ids ?? []) if (!state.lib.repo.getAsset(id)) throw notFound(`素材不存在：${id}`);
    const label = ids?.length ? `素材导出-${ids.length}项-${stamp()}` : `素材库-${stamp()}`;
    // folder：每个素材一个文件夹，人和 AI 都能直接读改；默认是完整备份
    if (req.body?.format === 'folder') {
      const files = folderFiles(state.lib, ids);
      const target = String(req.body?.targetDir ?? '').trim();
      if (target) {
        if (!path.isAbsolute(target)) throw badRequest('请选择导出位置');
        res.json({ path: writeFolder(target, label, files) });
        return;
      }
      sendZip(res, zipSync(Object.fromEntries(Object.entries(files).map(([p, d]) => [`${label}/${p}`, d])), { level: 6 }), `${label}.zip`);
      return;
    }
    sendZip(res, exportLibrary(state.lib, ids), `${label}.zip`);
  }));

  app.post('/api/import/preview', raw, asyncRoute((req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('请选择要导入的 ZIP 文件');
    const name = String(req.query.name ?? '').replace(/.zip$/i, '') || 'asset';
    res.json(stage(unzipSafe(new Uint8Array(req.body)), name));
  }));

  app.post('/api/import/folder', json, asyncRoute((req, res) => {
    const dir = String(req.body?.path ?? '').trim();
    if (!dir || !path.isAbsolute(dir)) throw badRequest('请选择要导入的文件夹');
    if (path.resolve(dir).toLowerCase() === state.lib.root.toLowerCase()) throw badRequest('这是当前素材库本身，不用导入');
    res.json(stage(readFolder(dir), path.basename(dir)));
  }));

  app.post('/api/import', json, asyncRoute((req, res) => {
    const pending = pendingImports.get(String(req.body?.token ?? ''));
    if (!pending) throw badRequest('导入文件已过期，请重新选择');
    const duplicates = (['skip', 'overwrite', 'copy'] as DuplicateStrategy[]).find(s => s === req.body?.duplicates) ?? 'skip';
    if (req.body?.mode === 'new') {
      const target = String(req.body?.targetPath ?? '').trim();
      if (!target || !path.isAbsolute(target)) throw badRequest('请填写新素材库目录的完整路径');
      if (Library.check(target) !== 'empty') throw badRequest('新素材库需要一个不存在或为空的目录');
      const lib = Library.open(target);
      let result;
      try {
        result = importPackage(lib, pending.pkg, 'skip');
      } catch (e) {
        lib.close();
        throw e;
      }
      if (req.body?.switchTo !== false) {
        state.lib.close();
        state.lib = lib;
        rememberLibrary(lib.root);
      } else lib.close();
      pendingImports.delete(String(req.body.token));
      res.json(result);
      return;
    }
    const result = importPackage(state.lib, pending.pkg, duplicates);
    pendingImports.delete(String(req.body.token));
    res.json(result);
  }));

  // ---- 文件与预览 ----

  // 素材库内的媒体和代码文件，路径必须在库目录内
  app.get('/files/*rel', (req, res) => {
    const abs = state.lib.resolve(param(req, 'rel'));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', withCharset(mimeOf(abs)));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(abs);
  });

  // 统一播放地址：/play/<id>/<framework>/；不写框架时播放第一个实现
  const playSaved = asyncRoute(async (req, res) => {
    const { asset, variant } = state.lib.getPlayback(param(req, 'id'), req.params.framework ? param(req, 'framework') : undefined);
    const fw = variant.framework;
    await sendPlay(res, `${asset.id}:${fw}:${asset.updatedAt}`, asset.title, variant, typeof req.query.v === 'string');
  });

  // 编辑页的草稿预览：先 POST 代码拿到一次性地址，再在 iframe 里打开
  const drafts = new Map<string, { title: string; variant: Variant; at: number }>();
  app.post('/api/play/draft', json, asyncRoute((req, res) => {
    const info = frameworkInfo(String(req.body?.framework ?? ''));
    if (!info) throw badRequest('不支持的框架');
    const files = Array.isArray(req.body?.files)
      ? (req.body.files as Variant['files']).flatMap(f => {
          const p = normalizeRelPath(String(f?.path ?? ''));
          return p ? [{ path: p, content: String(f?.content ?? '') }] : [];
        })
      : [];
    const entry = info.fixed ? info.entry : normalizeRelPath(String(req.body?.entry ?? '')) ?? info.entry;
    const token = crypto.randomUUID();
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of drafts) if (v.at < cutoff) drafts.delete(k);
    let theme: Variant['theme'];
    try { theme = parseThemeContract(req.body?.theme); } catch (e) { throw badRequest((e as Error).message); }
    drafts.set(token, { title: String(req.body?.title ?? '草稿'), variant: { framework: info.id, entry, dependencies: {}, files, ...(theme ? { theme } : {}) }, at: Date.now() });
    res.json({ url: `/play/~draft/${token}` });
  }));
  app.get('/play/~draft/:token', asyncRoute(async (req, res) => {
    const draft = drafts.get(param(req, 'token'));
    if (!draft) {
      res.status(404).type('text/plain').send('草稿预览已过期');
      return;
    }
    await sendPlay(res, 'draft:' + param(req, 'token'), draft.title, draft.variant);
  }));
  // 草稿地址先注册，免得 ~draft 被当成素材 ID
  app.get('/play/:id/', playSaved);
  app.get('/play/:id/:framework/', playSaved);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  if (options.distDir && fs.existsSync(options.distDir)) {
    app.use(express.static(options.distDir));
    app.get('/*any', (_req, res) => res.sendFile(path.join(options.distDir!, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status === 413) {
      res.status(413).json({ error: '文件太大' });
      return;
    }
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: '请求格式不正确' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: '服务器出错了，请查看终端日志' });
  });

  return app;
}
