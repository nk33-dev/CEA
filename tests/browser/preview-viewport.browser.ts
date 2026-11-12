import { test, expect, type Page } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import type { AssetDetail, AssetSummary } from '../../shared/types.ts';

const items: AssetSummary[] = Array.from({ length: 7 }, (_, i) => ({
  id: `viewport-${i}`, title: `Component ${i}`, type: 'component',
  categoryId: null, sourceName: '', sourceUrl: '', favorite: false, cover: null,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  tags: [], frameworks: ['html'], locales: ['en'],
  summaries: { en: 'A component preview with a short summary beneath its title.' }, titles: {}, searchText: '',
}));

const files = [
  { path: 'markup.html', content: '<section class="fixture"><div class="inner"><div class="spacer"></div><button>Last control</button></div></section>' },
  { path: 'style.css', content: '.fixture{width:100%;height:calc(100vh + 40px);background:#e5edf9}.inner{width:220px;height:90px;overflow:auto;scrollbar-width:thin}.spacer{height:300px}' },
];
const preview = htmlPlayPage('Viewport fixture', files);

async function mockList(page: Page, records = items) {
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'viewport', path: 'viewport', assetCount: records.length } }));
  await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/assets\?/, route => route.fulfill({ json: {
    items: records, total: records.length, page: 1, limit: 24,
    facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
  } }));
}

for (const edge of ['outside', 'sliver'] as const) {
  test(`browse progress ignores the seventh preview ${edge} of the viewport`, async ({ page }) => {
    await mockList(page);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/play/**', async route => {
      if (new URL(route.request().url()).pathname.includes('/viewport-6/')) await gate;
      await route.fulfill({ contentType: 'text/html', body: preview });
    });
    try {
      await page.goto(edge === 'outside' ? '/?fw=html' : '/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.fit-stage[data-ready=true]')).toHaveCount(6);
      const seventh = page.locator('[data-asset-id="viewport-6"]');
      await expect(seventh.locator('iframe')).toHaveCount(1);
      if (edge === 'sliver') await seventh.locator('.card-stage').evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + scrollY - innerHeight + 4));
      const top = (await seventh.locator('.card-stage').boundingBox())!.y;
      if (edge === 'outside') expect(top).toBeGreaterThanOrEqual(900);
      else {
        expect(top).toBeLessThan(900);
        expect(top).toBeGreaterThan(890);
      }
      await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
      await expect(page.locator('.browse-progress')).toHaveCSS('opacity', '0');
      await page.screenshot({ path: `test-results/preview-visible-loading-${edge}.png` });

      await seventh.scrollIntoViewIfNeeded();
      await expect(page.locator('.browse-progress')).toHaveAttribute('data-busy', 'true');
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator('.fit-stage[data-ready=true]')).toHaveCount(6);
      await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
      await seventh.scrollIntoViewIfNeeded();
      await expect(page.locator('.browse-progress')).toHaveAttribute('data-busy', 'true');
      release();
      await expect(seventh.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
      await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
    } finally {
      release();
    }
  });
}

test('thumbnail document scrollbars are hidden without changing inner scrolling or detail scrolling', async ({ page }) => {
  await mockList(page, items.slice(0, 1));
  const detail: AssetDetail = {
    ...items[0], texts: { en: { summary: '', idea: '' } }, media: [],
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files }],
  };
  await page.route('**/api/assets/viewport-0', route => route.fulfill({ json: detail }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: preview }));
  await page.goto('/');
  await expect(page.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveCSS('scrollbar-width', 'none');
  await expect(frame.locator('body')).toHaveCSS('scrollbar-width', 'none');
  await expect(frame.locator('.inner')).toHaveCSS('scrollbar-width', 'thin');
  await frame.getByRole('button', { name: 'Last control' }).click();
  expect(await frame.locator('.inner').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await frame.locator('html').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

  await page.getByRole('link', { name: /Component 0/ }).click();
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(frame.locator('html')).not.toHaveAttribute('data-thumbnail', '');
  await expect(frame.locator('html')).toHaveCSS('scrollbar-width', 'thin');
  expect(await frame.locator('html').evaluate(element => {
    element.scrollTop = 30;
    return element.scrollTop;
  })).toBeGreaterThan(0);
});

test('the actual map thumbnail has no document scrollbar and still responds to pointer input', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-asset-id="china-map-hero"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const frame = card.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveCSS('scrollbar-width', 'none');
  await frame.locator('.cm').click();
  await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');
  await card.screenshot({ path: 'test-results/map-thumbnail-scrollbar.png' });
});
