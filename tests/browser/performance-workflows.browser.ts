import { test, expect } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

const asset: AssetDetail = {
  id: 'performance-fixture', title: 'Performance Fixture', type: 'component', categoryId: null,
  tags: [], favorite: false, cover: null, sourceUrl: '', sourceName: '', frameworks: ['html', 'vue'],
  locales: ['en'], createdAt: '2026-01-01', updatedAt: '2026-01-01', media: [],
  texts: { en: { summary: 'Preview fixture', idea: '' } },
  variants: ['html', 'vue'].map(framework => ({
    framework, entry: framework === 'html' ? 'markup.html' : 'App.vue', dependencies: {},
    theme: { version: 1, mode: 'light', default: 'light' },
    files: [{ path: framework === 'html' ? 'markup.html' : 'App.vue', content: '<section>Preview fixture</section>' }],
  })),
};
const preview = htmlPlayPage('Fixture', [
  { path: 'markup.html', content: '<button id="counter">0</button>' },
  { path: 'script.js', content: 'counter.onclick=()=>counter.textContent=Number(counter.textContent)+1;' },
]);

test('failed list refresh preserves previews and retry stays local to the list', async ({ page }) => {
  let fail = false;
  let writes = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes++; });
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'performance', path: 'fixture', assetCount: 1 } }));
  await page.route(/\/api\/(categories|tags)$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/assets\?/, route => route.fulfill(fail ? { status: 500, json: { error: '测试服务暂时不可用' } } : { json: {
    items: [{ ...asset, summaries: { en: 'Fixture' }, titles: {}, searchText: '' }],
    total: 1, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
  } }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.goto('/');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const frame = page.frameLocator('iframe');
  await frame.locator('#counter').evaluate(element => { element.textContent = '7'; });
  fail = true;
  await page.getByRole('combobox', { name: '排序', exact: true }).click();
  await page.getByRole('option', { name: '最近添加', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('列表未更新');
  await expect(frame.locator('#counter')).toHaveText('7');
  await page.screenshot({ path: 'test-results/list-refresh-recovery.png' });
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(frame.locator('#counter')).toHaveText('7');
  expect(writes).toBe(0);
});

test('search waits for composition to finish before sending a query', async ({ page }) => {
  const queries: string[] = [];
  await page.route(/\/api\/assets\?/, route => {
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    return route.fulfill({ json: { items: [], total: 0, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 } } });
  });
  await page.goto('/');
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
  const search = page.getByRole('searchbox', { name: '搜索组件', exact: true });
  await search.dispatchEvent('compositionstart');
  await search.fill('tian');
  await page.getByRole('combobox', { name: '排序', exact: true }).click();
  await page.getByRole('option', { name: '最近添加', exact: true }).click();
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
  expect(queries.every(query => query === '')).toBe(true);
  await search.fill('天气');
  await search.dispatchEvent('compositionend');
  await expect(page).toHaveURL(/q=/);
  await expect.poll(() => queries.at(-1)).toBe('天气');
  await expect(search).toHaveValue('天气');
});

test('switching libraries does not mount old records against the new library', async ({ page }) => {
  let library = 'first';
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: library, path: library, assetCount: 1 } }));
  await page.route(/\/api\/(categories|tags)$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/assets\?/, async route => {
    const selected = library;
    if (selected === 'second') await gate;
    await route.fulfill({ json: {
      items: [{ ...asset, id: selected, summaries: {}, titles: {}, searchText: '' }],
      total: 1, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
    } });
  });
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.route('**/api/export', route => {
    library = 'second';
    return route.fulfill({ contentType: 'application/zip', body: Buffer.from('fixture') });
  });
  await page.goto('/');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await page.getByRole('button', { name: '选择本页', exact: true }).click();
  await page.getByRole('button', { name: '导出所选', exact: true }).click();
  await expect(page.locator('.card-meta[href="/a/first"]')).toHaveCount(0);
  await expect(page.locator('iframe[src*="/play/first/"]')).toHaveCount(0);
  release();
  await expect(page.locator('.card-meta[href="/a/second"]')).toBeVisible();
});

test('editor reuses unchanged draft URLs and exposes preview failures with retry', async ({ page }) => {
  await page.route('**/api/assets/performance-fixture', route => route.fulfill({ json: asset }));
  const submissions: string[] = [];
  let fail = false;
  await page.route('**/api/play/draft', route => {
    const body = route.request().postDataJSON();
    submissions.push(body.framework);
    return route.fulfill(fail ? { status: 500, json: { error: '测试预览失败' } } : { json: { url: `/play/~draft/${body.framework}-${submissions.length}` } });
  });
  await page.route('**/play/~draft/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.goto('/a/performance-fixture/edit');
  const host = page.locator('.editor-preview .stage-host');
  await expect(host).toHaveAttribute('aria-busy', 'false');
  const original = await page.locator('iframe').getAttribute('src');
  await page.getByRole('tab', { name: 'Vue', exact: true }).click();
  await expect(page.locator('iframe[src*="vue-"]')).toHaveCount(1);
  await expect(host).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('tab', { name: 'HTML', exact: true }).click();
  await expect(page.locator(`iframe[src="${original}"]`)).toHaveCount(1);
  await expect(host).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('iframe')).toHaveCount(1);
  expect(submissions).toEqual(['html', 'vue']);
  const submissionsBeforeMetadata = submissions.length;
  await page.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  await page.getByRole('textbox', { name: '简介', exact: true }).fill('Metadata only');
  await page.getByRole('tab', { name: '代码与预览', exact: true }).click();
  expect(submissions.length).toBe(submissionsBeforeMetadata);
  fail = true;
  await page.getByRole('textbox', { name: '编辑 markup.html', exact: true }).fill('<section>Updated fixture</section>');
  await expect(page.getByRole('alert')).toContainText('预览未更新');
  await expect(page.locator('iframe')).toHaveAttribute('src', original!);
  await page.screenshot({ path: 'test-results/editor-preview-recovery.png', fullPage: true });
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('iframe[src*="html-4"]')).toHaveCount(1);
  expect(submissions).toEqual(['html', 'vue', 'html', 'html']);
});

test('a late draft response cannot replace a newer framework preview', async ({ page }) => {
  await page.route('**/api/assets/performance-fixture', route => route.fulfill({ json: asset }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let posted!: () => void;
  const started = new Promise<void>(resolve => { posted = resolve; });
  await page.route('**/api/play/draft', async route => {
    const framework = route.request().postDataJSON().framework;
    if (framework === 'html') { posted(); await gate; }
    await route.fulfill({ json: { url: `/play/~draft/${framework}` } });
  });
  await page.route('**/play/~draft/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.goto('/a/performance-fixture/edit');
  await started;
  await page.getByRole('tab', { name: 'Vue', exact: true }).click();
  await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('iframe')).toHaveAttribute('src', /~draft\/vue/);
  release();
  await expect(page.locator('iframe')).toHaveAttribute('src', /~draft\/vue/);
});

test('organize retains selections outside the search and shows partial selection', async ({ page }) => {
  await page.route('**/api/tags', route => route.fulfill({ json: [
    { name: 'Alpha', count: 1 }, { name: 'Beta', count: 1 }, { name: 'Gamma', count: 1 },
  ] }));
  await page.goto('/organize');
  await page.getByRole('checkbox', { name: '选择 Alpha', exact: true }).check();
  const all = page.getByRole('checkbox', { name: '选择全部筛选结果', exact: true });
  expect(await all.evaluate(element => (element as HTMLInputElement).indeterminate)).toBe(true);
  await page.getByRole('textbox', { name: '搜索标签', exact: true }).fill('Beta');
  await expect(page.locator('.organize-row')).toHaveCount(1);
  await all.check();
  await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空整理搜索', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '选择 Alpha', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择 Beta', exact: true })).toBeChecked();
});

test('route loading gives feedback and tooltip stays within the phone viewport', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/assets/weather-day-switcher', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await page.locator('.card-meta[href="/a/weather-day-switcher"]').click();
  await expect(page.getByRole('status', { name: '正在打开页面', exact: true })).toBeVisible();
  release();
  await expect(page.locator('.studio-detail .stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('status', { name: '正在打开页面', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const more = page.getByRole('button', { name: '更多操作', exact: true });
  await more.evaluate(element => element.setAttribute('title', '组件的更多操作和可用的参考资料'));
  await more.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const bounds = (await tooltip.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(383);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});
