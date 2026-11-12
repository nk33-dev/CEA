import { test, expect } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import type { AssetDetail } from '../../shared/types.ts';

test('component animation does not continually refit the outer preview', async ({ page }) => {
  await page.setViewportSize({ width: 646, height: 807 });
  const files = [
    { path: 'markup.html', content: '<section id="fixture"><button id="grow">Grow</button><p>Stable text while the content grows.</p></section>' },
    { path: 'style.css', content: '#fixture{width:1000px;height:500px;background:white;font:24px Arial;box-sizing:border-box;padding:30px}' },
    { path: 'script.js', content: 'document.querySelector("#grow").onclick=()=>document.querySelector("#fixture").animate([{height:"500px"},{height:"820px"}],{duration:650,fill:"forwards"})' },
  ];
  const asset: AssetDetail = {
    id: 'motion-framing', title: 'Motion framing', type: 'component', categoryId: null,
    sourceName: '', sourceUrl: '', favorite: false, cover: null, createdAt: '', updatedAt: '',
    tags: [], frameworks: ['html'], locales: ['en'], titles: {},
    texts: {}, media: [], previewViewport: { width: 1080, height: 900 },
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files }],
  };
  await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'framing', path: 'framing', assetCount: 1 } }));
  await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
  await page.route('**/api/assets/motion-framing', route => route.fulfill({ json: asset }));
  await page.route('**/play/motion-framing/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage('Motion framing', files) }));
  await page.goto('/a/motion-framing');
  const frame = page.frameLocator('.preview-layer:not([inert]) iframe:not([aria-hidden="true"])');
  const stage = page.locator('.device-stage');
  await expect(frame.locator('#fixture')).toBeVisible();
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '完整显示', exact: true }).click();
  const initial = await stage.evaluate(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  });
  await stage.evaluate(element => {
    const samples: { scale: number; x: number; y: number }[] = [];
    (window as unknown as { framingSamples: typeof samples }).framingSamples = samples;
    const end = performance.now() + 1100;
    const sample = () => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      samples.push({ scale: matrix.a, x: matrix.e, y: matrix.f });
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await frame.getByRole('button', { name: 'Grow', exact: true }).click();
  await expect.poll(() => frame.locator('#fixture').evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(820);
  const samples = await page.evaluate(() => (window as unknown as { framingSamples: { scale: number; x: number; y: number }[] }).framingSamples);
  expect(samples.length).toBeGreaterThan(5);
  expect(samples.every(sample => Math.abs(sample.scale - initial.scale) < 0.0001 && Math.abs(sample.x - initial.x) < 0.1 && Math.abs(sample.y - initial.y) < 0.1)).toBe(true);
  await page.getByRole('button', { name: '完整显示', exact: true }).click();
  await expect.poll(() => stage.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeLessThan(initial.scale);
});
