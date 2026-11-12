import { test, expect } from '@playwright/test';
import type { AssetSummary } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';
import { mockLibrary, PNG } from './fixtures/mockLibrary.ts';

const preview = htmlPlayPage('Preview', [
  { path: 'markup.html', content: '<button id="counter">0</button><div class="moving"></div>' },
  { path: 'style.css', content: '.moving{width:120px;height:100px;background:#568ee8;animation:float 2s infinite alternate} @keyframes float{to{transform:translateX(30px)}}' },
  { path: 'script.js', content: "document.querySelector('button').onclick=e=>e.target.textContent=Number(e.target.textContent)+1;" },
]);

const items: AssetSummary[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `fixture-${String(i).padStart(4, '0')}`, title: `Component ${i}`, type: 'component',
  categoryId: null, sourceName: '', sourceUrl: '', favorite: false, cover: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  tags: [], frameworks: ['html'], locales: ['en'], summaries: {}, titles: {}, searchText: '',
}));

for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`six cards keep two readable desktop rows at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'fixture', path: 'fixture', assetCount: 6 } }));
    await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
    await page.route(/\/api\/assets\?/, route => route.fulfill({ json: {
      items: items.slice(0, 6).map(item => ({ ...item, summaries: { en: 'A component summary with enough text to span two lines and check the reserved space.' } })),
      total: 6, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
    } }));
    await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
    await page.goto('/');
    await expect(page.locator('.card')).toHaveCount(6);
    const cards = await page.locator('.card').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { y: box.y, bottom: box.bottom };
    }));
    expect(new Set(cards.map(card => card.y)).size).toBe(2);
    expect(Math.min(...await page.locator('.card-stage').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(200);
    expect(cards[3].y - cards[0].bottom).toBeGreaterThanOrEqual(16);
    await expect(page.locator('.fit-stage[data-ready=true]')).toHaveCount(6);
    await page.screenshot({ path: `test-results/browse-six-${size.width}.png` });
  });
}

for (const locale of ['zh', 'en']) {
  test(`the seventh card stays below two complete desktop rows in ${locale}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:locale', value), locale);
    await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'seven', path: 'seven', assetCount: 7 } }));
    await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
    await page.route(/\/api\/assets\?/, route => route.fulfill({ json: {
      items: items.slice(0, 7).map(item => ({ ...item,
        summaries: { en: 'A longer description that wraps onto two lines without changing the card height.', zh: '随机上行字符、抽象环带与可连续点击的局部粒子拨动，支持替换透明图片轮廓。' },
        tags: ['Canvas', 'Particles', 'Mouse tracking'], frameworks: ['html', 'react', 'vue'],
      })),
      total: 7, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
    } }));
    await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
    await page.goto('/');
    for (const size of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2048, height: 1005 }, { width: 1440, height: 1200 }]) {
      await page.setViewportSize(size);
      await expect(page.locator('.card')).toHaveCount(7);
      const geometry = () => page.locator('.card').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }));
      await expect.poll(async () => (await geometry())[6].top).toBeGreaterThanOrEqual(size.height);
      const cards = await geometry();
      expect(new Set(cards.slice(0, 6).map(card => card.top)).size).toBe(2);
      expect(cards[3].top - cards[0].bottom).toBeGreaterThanOrEqual(16);
      await page.screenshot({ path: `test-results/browse-seven-${locale}-${size.width}-${size.height}.png` });
    }
    const seventh = page.locator('.card').nth(6);
    await seventh.scrollIntoViewIfNeeded();
    await expect(seventh.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  });
}

test('one thousand records keep page and live-document counts bounded', async ({ page }) => {
  let listRequests = 0;
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'fixture', path: 'fixture', assetCount: 1000 } }));
  await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/assets\?/, route => {
    listRequests++;
    const number = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
    return route.fulfill({ json: {
      items: items.slice((number - 1) * 24, number * 24), total: 1000, page: number, limit: 24,
      facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
    } });
  });
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await expect(page.locator('.stage-host[aria-busy=false]').first()).toBeVisible();
  await expect.poll(() => page.locator('iframe').count()).toBeGreaterThan(2);
  expect(await page.locator('iframe').count()).toBeLessThan(13);
  expect(listRequests).toBe(1);

  const first = page.locator('.card').first();
  const frame = first.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveAttribute('data-paused', '', { timeout: 5000 });
  await first.locator('.card-stage').hover();
  await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');
  await frame.getByRole('button', { name: '0', exact: true }).click();
  await expect(frame.getByRole('button', { name: '1', exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await first.getByRole('button', { name: '暂停预览', exact: true }).click();
  await frame.getByRole('button', { name: '1', exact: true }).click();
  await expect(frame.getByRole('button', { name: '2', exact: true })).toBeVisible();
  await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');

  await page.getByRole('button', { name: '下一页', exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const frame = first.locator('iframe');
    if (!await frame.count()) return true;
    return first.frameLocator('iframe').locator('html').getAttribute('data-paused', { timeout: 500 }).then(value => value === '', () => true);
  }).toBe(true);
  expect(await page.locator('iframe').count()).toBeLessThan(13);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.card-title').first()).toHaveText('Component 24');
  expect(listRequests).toBe(2);
  await expect(page.locator('.card')).toHaveCount(24);
});

test('visible previews load together and language changes preserve frames', async ({ page }) => {
  await mockLibrary(page);
  const started: number[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/play/')) started.push(Date.now()); });
  await page.goto('/');
  await expect(page.locator('.card')).not.toHaveCount(0);
  await expect.poll(async () => {
    const count = await page.locator('.card').count();
    return count > 0 && await page.locator('.fit-stage[data-ready=true]').count() === count;
  }).toBe(true);
  expect(Math.max(...started) - Math.min(...started)).toBeLessThan(1000);
  const before = await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getAttribute('src')));
  const languages = page.getByRole('radiogroup', { name: '内容语言', exact: true });
  await languages.getByRole('radio').last().check();
  expect(await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getAttribute('src')))).toEqual(before);
});

test('phone scrolling keeps covers and bounds retained preview instances', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLibrary(page);
  await page.goto('/');
  await expect(page.locator('.card')).not.toHaveCount(0);
  await expect(page.locator('.stage-host[aria-busy=false]').first()).toBeVisible();
  const first = page.locator('.card').first();
  await page.locator('.card').last().scrollIntoViewIfNeeded();
  expect(await page.locator('iframe').count()).toBeLessThanOrEqual(12);
  await expect(first.frameLocator('iframe').locator('html')).toHaveAttribute('data-paused', '');
  const widths = await page.evaluate(() => ({ layout: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.layout);
});

test('framework switches, replay and content language preserve bounded preview state', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
  await page.goto('/a/leetcode-heatmap');
  await expect(page.locator('.stage-host[aria-busy=false]')).toHaveCount(1);
  const select = page.getByRole('combobox', { name: '实现框架', exact: true });
  for (const name of ['Vue', 'React', 'HTML', 'Vue', 'HTML']) {
    await select.click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(page.locator('.preview-stages')).toHaveAttribute('aria-busy', 'false');
  }
  await expect(page.locator('iframe')).toHaveCount(3);
  const html = page.frameLocator('iframe[src*="/html/"]');
  const year = html.getByRole('combobox', { name: 'Range' });
  const options = await year.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  await year.selectOption(options.at(-1)!);
  await page.getByRole('radiogroup', { name: '内容语言' }).getByRole('radio').last().check();
  await expect(year).toHaveValue(options.at(-1)!);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '重播', exact: true }).click();
    await expect(page.locator('.preview-layer:not([hidden]) .stage-host')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('iframe')).toHaveCount(3);
  }
});

test('entry transforms do not resize the thumbnail and loading stays at display scale', async ({ page }) => {
  const animated = htmlPlayPage('Animated', [
    { path: 'markup.html', content: '<section class="component">Preview</section>' },
    { path: 'style.css', content: '.component{width:300px;height:280px;background:#568ee8;animation:enter 700ms both}@keyframes enter{from{transform:scale(.25)}to{transform:scale(1)}}' },
  ]);
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'fixture', path: 'fixture', assetCount: 1 } }));
  await page.route('**/files/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/assets\?/, route => route.fulfill({ json: {
    items: [{ ...items[0], cover: 'assets/fixture/media/differently-cropped-cover.png' }], total: 1, page: 1, limit: 24,
    facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
  } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/play/**', async route => {
    await gate;
    await route.fulfill({ contentType: 'text/html', body: animated });
  });
  await page.goto('/');
  await expect(page.locator('.card-cover')).toHaveCount(1);
  await page.locator('.card-stage').hover();
  await expect(page.locator('.fit-stage > .stage-loading')).toHaveCount(0);
  const loading = page.locator('.browse-progress[data-busy=true]');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveCSS('opacity', '1');
  const size = await loading.boundingBox();
  expect(size!.width).toBeGreaterThan(300);
  expect(size!.height).toBe(2);
  await page.locator('.home').screenshot({ path: 'test-results/preview-loading.png' });
  release();
  await expect(page.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.fit-stage-inner')).toHaveCSS('transition-property', 'opacity');
  await expect(page.locator('.fit-stage-inner')).toHaveCSS('opacity', '1');
  const geometry = await page.locator('.fit-stage-inner').evaluate(async element => {
    const values = new Set<string>();
    const until = performance.now() + 1900;
    while (performance.now() < until) {
      values.add((element as HTMLElement).style.transform);
      await new Promise(requestAnimationFrame);
    }
    return [...values];
  });
  expect(geometry).toHaveLength(1);
});
