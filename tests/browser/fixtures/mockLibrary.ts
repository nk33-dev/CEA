import type { Page } from '@playwright/test';
import type { AssetDetail, AssetInput, Category } from '../../../shared/types.ts';
import { slugify } from '../../../shared/paths.ts';
import { htmlPlayPage } from '../../../server/play.ts';

export const DEMO_ROOT = 'X:\\CEA-Demo';
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=', 'base64');

function demoAsset(id: string, title: string, categoryId: string, tag: string): AssetDetail {
  return {
    id, title, type: 'component', categoryId, tags: [tag, '共享'], favorite: false,
    cover: null, sourceName: '', sourceUrl: '', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    frameworks: ['html', 'vue'], locales: ['zh', 'en'], media: [],
    texts: { zh: { title, summary: '用于操作验收的假数据，不修改真实素材。', idea: '做一个可以点击计数的卡片。' }, en: { summary: 'A demo card.', idea: 'Create a counter card.' } },
    variants: ['html', 'vue'].map(framework => ({
      framework, entry: framework === 'html' ? 'markup.html' : 'App.vue', dependencies: {},
      theme: { version: 1, mode: 'both', default: 'light' },
      files: [{ path: framework === 'html' ? 'markup.html' : 'App.vue', content: '<button>Demo</button>' }],
    })),
  };
}

export async function mockLibrary(page: Page) {
  const assets = new Map([
    ['demo-a', demoAsset('demo-a', '演示卡片 A', 'cards', '动效')],
    ['demo-b', demoAsset('demo-b', '演示卡片 B', 'sections', '地图')],
    ['demo-c', demoAsset('demo-c', '演示卡片 C', 'cards', '动效')],
  ]);
  let categories: Category[] = [{ id: 'cards', name: '卡片', sort: 0, count: 2 }, { id: 'sections', name: '区块', sort: 1, count: 1 }];
  const labels = new Map<string, Record<string, string>>();
  const writes: string[] = [];
  const unexpected: string[] = [];
  const failures = new Set<string>();
  let currentPath = DEMO_ROOT;
  let recent = [{ path: `${DEMO_ROOT}\\Recent`, available: true }];
  let sequence = 0;
  const touch = (asset: AssetDetail) => {
    asset.updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, ++sequence)).toISOString();
    return asset;
  };
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('cea:locale', 'zh');
    localStorage.setItem('cea:framework', 'html');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    } } });
  });
  const playback = htmlPlayPage('Demo', [
    { path: 'markup.html', content: '<button id="counter" style="width:180px;height:120px;background:#edf4ff;border:1px solid #a8bbdc;border-radius:6px">0</button>' },
    { path: 'script.js', content: 'counter.onclick=()=>counter.textContent=Number(counter.textContent)+1;' },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.route('**/files/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method();
    const operation = `${method} ${pathname}`;
    if (method !== 'GET') writes.push(operation);
    if (failures.delete(operation)) return route.fulfill({ status: 500, json: { error: '演示请求失败，请重试' } });
    const json = (value: unknown) => route.fulfill({ json: value });
    const done = () => route.fulfill({ status: 204 });
    const body = request.headers()['content-type']?.includes('application/json') ? request.postDataJSON() ?? {} : {};
    const all = [...assets.values()];
    if (pathname === '/api/library') {
      if (method === 'PUT') currentPath = body.path;
      return json({ libraryId: currentPath, path: currentPath, assetCount: assets.size, schemaVersion: 1, configDir: `${DEMO_ROOT}\\Config`,
        recent });
    }
    if (pathname === '/api/library/recent' && method === 'DELETE') { recent = recent.filter(entry => entry.path !== body.path); return json({}); }
    if (pathname === '/api/fs/reveal') return done();
    if (pathname === '/api/fs/mkdir') return json({ path: `${body.parent}\\${body.name}` });
    if (pathname === '/api/fs') {
      const path = url.searchParams.get('path') ?? '';
      return json({ path, parent: path ? '' : null, home: DEMO_ROOT, kind: path === currentPath ? 'library' : 'empty',
        entries: path ? [] : [{ name: '演示工作区', path: DEMO_ROOT, library: true }] });
    }
    if (pathname === '/api/play/draft') return json({ url: `/play/~draft/demo-${++sequence}` });
    if (pathname === '/api/export' || pathname.endsWith('/package')) {
      return body.format === 'folder' && body.targetDir ? json({ path: `${body.targetDir}\\CEA-Export` })
        : route.fulfill({ contentType: 'application/zip', headers: { 'content-disposition': "attachment; filename*=UTF-8''cea-demo.zip" }, body: Buffer.from('demo-zip') });
    }
    if (pathname === '/api/import/preview' || pathname === '/api/import/folder') return json({ token: 'demo-import', preview: {
      source: pathname.endsWith('folder') ? 'folder' : 'backup', formatVersion: 1, exportedAt: '2026-01-01',
      assetCount: 1, categoryCount: 1, fileCount: 3, problems: [],
      duplicates: [{ id: 'demo-a', title: '演示卡片 A', existingTitle: '演示卡片 A' }],
      items: [{ id: 'demo-a', title: '演示卡片 A', frameworks: ['html'] }],
    } });
    if (pathname === '/api/import') return json({ created: 0, overwritten: body.duplicates === 'overwrite' ? 1 : 0,
      copied: body.duplicates === 'copy' ? 1 : 0, skipped: body.duplicates === 'skip' ? 1 : 0, libraryPath: currentPath });
    if (pathname === '/api/categories') {
      if (method === 'POST') { const category = { id: `category-${++sequence}`, name: body.name, count: 0, sort: categories.length }; categories.push(category); return json(category); }
      return json(categories.map(category => ({ ...category, count: all.filter(asset => asset.categoryId === category.id).length })));
    }
    if (pathname === '/api/categories/order') { categories = body.ids.map((id: string) => categories.find(category => category.id === id)!); return done(); }
    if (pathname === '/api/categories/batch') {
      categories = categories.filter(category => !body.ids.includes(category.id));
      for (const asset of all) if (body.ids.includes(asset.categoryId)) asset.categoryId = null;
      return json({ changed: body.ids.length });
    }
    if (pathname.startsWith('/api/categories/')) { const category = categories.find(category => category.id === decodeURIComponent(pathname.split('/').at(-1)!))!; Object.assign(category, body); return json(category); }
    const tags = [...new Set(all.flatMap(asset => asset.tags))];
    if (pathname === '/api/tags') return json(tags.map(name => ({ name, count: all.filter(asset => asset.tags.includes(name)).length, labels: labels.get(name) })));
    if (pathname === '/api/tags/batch') {
      for (const asset of all) {
        const matches = asset.tags.some(tag => body.names.includes(tag));
        asset.tags = asset.tags.filter(tag => !body.names.includes(tag));
        if (matches && body.action === 'merge') asset.tags.push(body.target);
      }
      return json({ changed: body.names.length });
    }
    if (pathname.startsWith('/api/tags/')) {
      const tag = decodeURIComponent(pathname.split('/').at(-1)!);
      if (body.labels) labels.set(tag, body.labels);
      else for (const asset of all) asset.tags = asset.tags.map(value => value === tag ? body.name : value);
      return done();
    }
    if (pathname === '/api/assets/batch') {
      for (const id of body.ids) {
        const asset = assets.get(id)!;
        if (body.action === 'delete') assets.delete(id);
        else if (body.action === 'tag') asset.tags = [...new Set([...asset.tags, body.value])];
        else if (body.action === 'untag') asset.tags = asset.tags.filter(tag => tag.toLowerCase() !== body.value.toLowerCase());
        else asset.categoryId = body.value || null;
      }
      return json({ changed: body.ids.length });
    }
    if (pathname === '/api/assets' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const category = url.searchParams.get('category');
      const framework = url.searchParams.get('fw');
      const selectedTags: string[] = JSON.parse(url.searchParams.get('tags') ?? '[]');
      const filtered = all.filter(asset => (!q || asset.title.toLowerCase().includes(q)) && (!category || asset.categoryId === category)
        && (!framework || asset.frameworks.includes(framework)) && (url.searchParams.get('fav') !== '1' || asset.favorite)
        && selectedTags.every(tag => asset.tags.some(value => value.toLowerCase() === tag.toLowerCase())));
      const sort = url.searchParams.get('sort');
      filtered.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      return json({ items: filtered.slice((pageNumber - 1) * 24, pageNumber * 24).map(asset => ({ ...asset, summaries: { zh: asset.texts.zh?.summary ?? '' }, titles: { zh: asset.texts.zh?.title ?? '' }, searchText: '' })),
        total: filtered.length, page: pageNumber, limit: 24, facets: {
          categories: Object.fromEntries(categories.map(category => [category.id, all.filter(asset => asset.categoryId === category.id).length])),
          frameworks: { html: all.length, vue: all.length }, tags: Object.fromEntries(tags.map(tag => [tag, all.filter(asset => asset.tags.includes(tag)).length])),
          favorite: all.filter(asset => asset.favorite).length,
        } });
    }
    if (pathname === '/api/assets' && method === 'POST') {
      const input = body as AssetInput;
      const id = input.id || slugify(input.title);
      const next = touch({ ...demoAsset(id, input.title, input.categoryId ?? 'cards', ''), ...input, id,
        frameworks: input.variants.map(variant => variant.framework), locales: Object.keys(input.texts), media: [] });
      assets.set(id, next);
      return json(next);
    }
    const match = /^\/api\/assets\/([^/]+)(?:\/(.*))?$/.exec(pathname);
    if (match) {
      const asset = assets.get(decodeURIComponent(match[1]))!;
      if (!asset) return route.fulfill({ status: 404, json: { error: '组件不存在' } });
      const action = match[2];
      if (action === 'favorite') { asset.favorite = body.favorite; return json({ favorite: asset.favorite }); }
      if (action === 'media') {
        const name = url.searchParams.get('name')!;
        asset.media.push({ id: ++sequence, role: 'media', path: `assets/${asset.id}/media/${name}`, mime: 'image/png', label: '', size: PNG.length });
        return json(touch(asset));
      }
      if (action?.startsWith('media/')) {
        const id = Number(action.split('/')[1]);
        if (method === 'DELETE') asset.media = asset.media.filter(file => file.id !== id);
        else if (body.cover) asset.cover = asset.media.find(file => file.id === id)!.path;
        else asset.media.find(file => file.id === id)!.label = body.label;
        return json(touch(asset));
      }
      if (!action && method === 'DELETE') { assets.delete(asset.id); return done(); }
      if (!action && method === 'PUT') { Object.assign(asset, body, { frameworks: body.variants.map((variant: { framework: string }) => variant.framework), locales: Object.keys(body.texts) }); return json(touch(asset)); }
      if (!action && method === 'GET') return json(asset);
    }
    unexpected.push(operation);
    return route.fulfill({ status: 501, json: { error: `未模拟的请求：${operation}` } });
  });
  return { assets, writes, unexpected, failures, labels };
}
