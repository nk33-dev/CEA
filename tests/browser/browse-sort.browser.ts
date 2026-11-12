import { test, expect } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import type { AssetSummary } from '../../shared/types.ts';
import { mockLibrary } from './fixtures/mockLibrary.ts';

const items: AssetSummary[] = Array.from({ length: 6 }, (_, i): AssetSummary => ({
  id: `sorted-${i}`, title: `Component ${i}`, type: 'component', categoryId: null,
  sourceName: '', sourceUrl: '', favorite: false, cover: null, createdAt: '2026-01-01',
  updatedAt: '2026-01-01', tags: [], frameworks: ['html'], locales: ['en'],
  summaries: i % 3 === 0 ? {} : { en: i % 3 === 1 ? 'Short summary.' : 'A much longer component summary that wraps onto a second line and tests stable card sizing.' },
  titles: {}, searchText: '',
}));
const preview = htmlPlayPage('Counter', [
  { path: 'markup.html', content: '<button id="counter">0</button>' },
  { path: 'script.js', content: 'counter.onclick=()=>counter.textContent=Number(counter.textContent)+1;' },
]);

for (const width of [1440, 1000]) {
  test(`sorting preserves preview documents and geometry at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'sorting', path: 'sorting', assetCount: 6 } }));
    await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
    let release: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    await page.route(/\/api\/assets\?/, async route => {
      const sort = new URL(route.request().url()).searchParams.get('sort');
      const sorted = sort === 'created' ? [...items].reverse() : sort === 'title' ? [items[2], items[0], items[4], items[1], items[5], items[3]] : items;
      const results = new URL(route.request().url()).searchParams.get('q') ? sorted.filter(item => item.id === 'sorted-0') : sorted;
      if (gate) await gate;
      await route.fulfill({ json: { items: results, total: results.length, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 } } });
    });
    let loads = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/play/')) loads++; });
    await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
    await page.goto('/');
    await expect(page.locator('.fit-stage[data-ready=true]')).toHaveCount(6);
    const frame = page.locator('.card').filter({ has: page.locator('a[href="/a/sorted-0"]') }).frameLocator('iframe');
    await frame.locator('#counter').evaluate(element => { element.textContent = '7'; });
    const geometry = () => page.evaluate(() => {
      const grid = document.querySelector('.results .grid')!.getBoundingClientRect();
      return { top: grid.top, height: grid.height, width: grid.width, documentHeight: document.documentElement.scrollHeight, scroll: scrollY };
    });
    const initial = await geometry();
    const initialLoads = loads;
    await page.evaluate(() => {
      const state = { running: true, samples: [] as { top: number; height: number; width: number; documentHeight: number; scroll: number }[] };
      (window as unknown as { sorting: typeof state }).sorting = state;
      const sample = () => {
        const grid = document.querySelector('.results .grid')!.getBoundingClientRect();
        state.samples.push({ top: grid.top, height: grid.height, width: grid.width, documentHeight: document.documentElement.scrollHeight, scroll: scrollY });
        if (state.running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    for (const [label, first] of [['最近添加', 'Component 5'], ['最近更新', 'Component 0'], ['按名称', 'Component 2']]) {
      gate = new Promise(resolve => { release = resolve; });
      await page.getByRole('combobox', { name: '排序', exact: true }).click();
      await expect(page.locator('body')).not.toHaveCSS('overflow-y', 'hidden');
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'true');
      for (const [key, value] of Object.entries(await geometry())) expect(Math.abs(value - initial[key as keyof typeof initial])).toBeLessThanOrEqual(.25);
      release!();
      gate = undefined;
      await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.card-title').first()).toHaveText(first);
      await expect(frame.locator('#counter')).toHaveText('7');
      expect(loads).toBe(initialLoads);
      for (const [key, value] of Object.entries(await geometry())) expect(Math.abs(value - initial[key as keyof typeof initial])).toBeLessThanOrEqual(.25);
    }
    const samples = await page.evaluate(() => {
      const state = (window as unknown as { sorting: { running: boolean; samples: object[] } }).sorting;
      state.running = false;
      return state.samples;
    });
    for (const sample of samples) for (const [key, value] of Object.entries(sample)) expect(Math.abs(Number(value) - initial[key as keyof typeof initial])).toBeLessThanOrEqual(.25);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.screenshot({ path: `test-results/browse-sort-${width}.png` });
    await page.getByRole('searchbox', { name: '搜索组件', exact: true }).fill('Component 0');
    await expect(page.locator('.card')).toHaveCount(1);
    await expect(frame.locator('#counter')).toHaveText('7');
    await page.getByRole('button', { name: '清空搜索', exact: true }).click();
    await expect(page.locator('.card')).toHaveCount(6);
    await expect(frame.locator('#counter')).toHaveText('7');
    expect(errors).toEqual([]);
  });
}

test('sorting saved-shaped fixture records keeps the loaded preview documents', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/');
  await expect(page.locator('.card')).not.toHaveCount(0);
  const hosts = page.locator('.stage-host');
  await expect.poll(async () => await hosts.count() > 0 && await hosts.locator('iframe.is-loaded').count() === await hosts.count()).toBe(true);
  for (const frame of page.frames().filter(frame => frame.url().includes('/play/'))) {
    await frame.evaluate(() => document.documentElement.dataset.sortSession = 'preserved');
  }
  for (const label of ['最近添加', '按名称', '最近更新']) {
    await page.getByRole('combobox', { name: '排序', exact: true }).click();
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assets');
    await page.getByRole('option', { name: label, exact: true }).click();
    await response;
    await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
    for (const frame of page.frames().filter(frame => frame.url().includes('/play/'))) {
      await expect(frame.locator('html')).toHaveAttribute('data-sort-session', 'preserved');
    }
  }
});
