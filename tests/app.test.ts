import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.ts';
import { Library } from '../server/library.ts';
import { seedTestLibrary } from './helpers/library.ts';

let dir: string;
let lib: Library;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-http-test-'));
  lib = Library.open(dir);
  seedTestLibrary(lib);
  server = createApp({ lib }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server did not start');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  lib?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function request(route: string, method = 'GET', body?: unknown, trusted = true) {
  return fetch(base + route, {
    method,
    headers: {
      ...(trusted ? { 'x-cea-client': '1' } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('按需读取预览', () => {
  it('程序不再提供写入内置素材的接口', async () => {
    const count = lib.repo.countAssets();
    expect((await request('/api/library/examples', 'POST')).status).toBe(404);
    expect(lib.repo.countAssets()).toBe(count);
  });

  it('HTML 卡片只读取 HTML 源码，不读取其他框架或详情文案', async () => {
    const read = vi.spyOn(fs, 'readFileSync');
    const detail = vi.spyOn(lib, 'getAsset');
    try {
      const response = await request('/play/weather-day-switcher/html/');
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('cea:ready');
      expect(detail).not.toHaveBeenCalled();
      const codePaths = read.mock.calls.map(([file]) => String(file)).filter(file => /[/\\]code[/\\]/.test(file));
      expect(codePaths).toHaveLength(3);
      expect(codePaths.every(file => /[/\\]html[/\\]/.test(file))).toBe(true);
      expect((await request('/play/weather-day-switcher/missing/')).status).toBe(404);
    } finally {
      read.mockRestore();
      detail.mockRestore();
    }
  });
});

describe('标签接口', () => {
  it('译名通过独立字段保存，不重命名标签或改变素材关联', async () => {
    const tag = encodeURIComponent('天气');
    expect((await request(`/api/tags/${tag}`, 'PATCH', { labels: { en: 'Weather', zh: '天气' } })).status).toBe(204);
    expect(lib.getAsset('weather-day-switcher').tags).toContain('天气');
    const tags = await (await request('/api/tags')).json();
    expect(tags).toContainEqual(expect.objectContaining({ name: '天气', labels: { en: 'Weather', zh: '天气' } }));
    const category = lib.listCategories()[0];
    expect((await request(`/api/categories/${category.id}`, 'PATCH', { labels: { en: 'Cards', zh: '卡片' } })).status).toBe(200);
    expect(lib.getAsset('weather-day-switcher').categoryId).toBe(category.id);
    expect((await request(`/api/tags/${tag}`, 'PATCH', {})).status).toBe(400);
  });
  it('批量标签操作和批量组件操作返回结果，拒绝无效动作与 ID', async () => {
    const merge = await request('/api/tags/batch', 'POST', { names: ['天气', '数字动画'], action: 'merge', target: '动画' });
    expect(merge.status).toBe(200);
    expect(lib.getAsset('weather-day-switcher').tags).toContain('动画');
    expect((await request('/api/tags/batch', 'POST', { names: ['动画'], action: 'unknown' })).status).toBe(400);
    expect((await request('/api/assets/batch', 'POST', { ids: ['weather-day-switcher', 'missing'], action: 'delete' })).status).toBe(404);
    expect(lib.repo.countAssets()).toBe(1);
    expect((await request('/api/assets/batch', 'POST', { ids: ['weather-day-switcher'], action: 'tag', value: '精选' })).status).toBe(200);
    expect(lib.getAsset('weather-day-switcher').tags).toContain('精选');
  });

  it('分类批量删除、排序保持关联组件，分页搜索通过 HTTP 返回摘要', async () => {
    const first = lib.listCategories()[0];
    const next = lib.createCategory('Other');
    expect((await request('/api/categories/order', 'POST', { ids: [next.id, first.id] })).status).toBe(204);
    expect(lib.listCategories()[0].id).toBe(next.id);
    expect((await request('/api/categories/order', 'POST', { ids: [first.id] })).status).toBe(400);
    expect((await request('/api/categories/batch', 'POST', { ids: [first.id] })).status).toBe(200);
    expect(lib.getAsset('weather-day-switcher').categoryId).toBeNull();
    const page = await (await request('/api/assets?paged=1&q=weather&limit=1')).json();
    expect(page).toMatchObject({ total: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].searchText).toBe('');
  });
  it('中文标签可通过接口改名和合并，删除保留素材及代码', async () => {
    const rename = await request(`/api/tags/${encodeURIComponent('天气')}`, 'PATCH', { name: 'Weather' });
    expect(rename.status).toBe(204);
    const merge = await request('/api/tags/weather', 'PATCH', { name: '数字动画' });
    expect(merge.status).toBe(204);
    expect(await (await request('/api/tags')).json()).toHaveLength(3);
    expect(lib.getAsset('weather-day-switcher').tags.filter(t => t === '数字动画')).toHaveLength(1);

    const remove = await request(`/api/tags/${encodeURIComponent('数字动画')}`, 'DELETE');
    expect(remove.status).toBe(204);
    const detail = await (await request('/api/assets/weather-day-switcher')).json();
    expect(detail.tags).toEqual(['标签切换', '背景过渡']);
    expect(detail.variants).toHaveLength(3);
  });

  it('返回明确的输入错误并拒绝没有客户端请求头的写入', async () => {
    const missing = await request('/api/tags/missing', 'PATCH', { name: 'New' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: '标签不存在' });
    const empty = await request(`/api/tags/${encodeURIComponent('天气')}`, 'PATCH', { name: ' ' });
    expect(empty.status).toBe(400);
    const untrusted = await request(`/api/tags/${encodeURIComponent('天气')}`, 'DELETE', undefined, false);
    expect(untrusted.status).toBe(403);
    expect(lib.getAsset('weather-day-switcher').tags).toContain('天气');
  });
});

describe('导入导出接口', () => {
  it('导出后可预览，合并为副本并使导入令牌失效', async () => {
    const exported = await request('/api/export', 'POST', {});
    expect(exported.headers.get('content-type')).toContain('application/zip');
    const previewed = await fetch(base + '/api/import/preview', {
      method: 'POST',
      headers: { 'x-cea-client': '1', 'Content-Type': 'application/zip' },
      body: await exported.arrayBuffer(),
    });
    expect(previewed.status).toBe(200);
    const { token, preview } = await previewed.json();
    expect(preview).toMatchObject({ assetCount: 1, categoryCount: 1 });
    expect(preview.duplicates).toHaveLength(1);
    const imported = await request('/api/import', 'POST', { token, mode: 'merge', duplicates: 'copy' });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ copied: 1, created: 0 });
    expect(lib.listAssets()).toHaveLength(2);
    const reused = await request('/api/import', 'POST', { token, mode: 'merge', duplicates: 'copy' });
    expect(reused.status).toBe(400);
    expect(lib.listAssets()).toHaveLength(2);
  });
});

describe('主题声明接口', () => {
  it('保存、读取和播放采用同一份声明，拒绝不支持的版本', async () => {
    const asset = lib.getAsset('weather-day-switcher');
    expect(asset.variants.every(v => v.theme?.mode === 'original')).toBe(true);
    const theme = { version: 1, mode: 'light', default: 'light' };
    const saved = await request(`/api/assets/${asset.id}`, 'PUT', {
      ...asset, variants: asset.variants.map(v => ({ ...v, theme })),
    });
    expect(saved.status).toBe(200);
    const playback = await (await request(`/play/${asset.id}/html/`)).text();
    expect(playback).toContain('"mode":"light"');
    const rejected = await request(`/api/assets/${asset.id}`, 'PUT', {
      ...asset, variants: asset.variants.map(v => ({ ...v, theme: { ...theme, version: 99 } })),
    });
    expect(rejected.status).toBe(400);
    expect(lib.getAsset(asset.id).variants[0].theme).toEqual(theme);
    const draft = await request('/api/play/draft', 'POST', {
      ...asset.variants[0], theme, title: 'Draft',
    });
    expect(draft.status).toBe(200);
    expect(await (await request((await draft.json()).url)).text()).toContain('"mode":"light"');
  });
});
