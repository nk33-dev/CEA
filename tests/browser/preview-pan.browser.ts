import { test, expect } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

test('focusing a clipped control cannot scroll the transformed canvas behind its pan state', async ({ page }) => {
  const asset: AssetDetail = {
    id: 'pan-fixture', title: 'Pan fixture', type: 'component', categoryId: null,
    tags: [], favorite: false, cover: null, sourceUrl: '', sourceName: '', frameworks: ['html'], locales: ['en'],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', texts: { en: { summary: '', idea: '' } }, media: [],
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [
      { path: 'markup.html', content: '<main><button id="top">Top</button><input aria-label="Right field"><button id="bottom">Bottom</button></main>' },
      { path: 'style.css', content: 'main{height:100vh;position:relative;background:#e1ebf7}#bottom{position:absolute;bottom:20px;right:20px}input{position:absolute;bottom:70px;right:20px;width:120px}' },
    ] }],
  };
  await page.route('**/api/assets/pan-fixture', route => route.fulfill({ json: asset }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage(asset.title, asset.variants[0].files) }));
  await page.goto('/a/pan-fixture');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).fill('200');
  await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).press('Enter');
  await page.frameLocator('iframe').locator('#top').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const scrolled = await page.locator('.preview-well,.device-preview,.device-screen,.zoom-stage').evaluateAll(elements =>
    elements.map(element => ({ name: element.className, x: element.scrollLeft, y: element.scrollTop })).filter(element => element.x || element.y));
  expect(scrolled).toEqual([]);
  await expect.poll(async () => {
    const control = (await page.frameLocator('iframe').locator('#bottom').boundingBox())!;
    const canvas = (await page.locator('.device-preview').boundingBox())!;
    return control.x >= canvas.x && control.y >= canvas.y && control.x + control.width <= canvas.x + canvas.width && control.y + control.height <= canvas.y + canvas.height;
  }).toBe(true);
  const beforeClick = await page.locator('.device-stage').getAttribute('style');
  await page.frameLocator('iframe').getByRole('textbox', { name: 'Right field', exact: true }).click();
  await page.frameLocator('iframe').getByRole('textbox', { name: 'Right field', exact: true }).fill('Keeps position');
  await expect(page.locator('.device-stage')).toHaveAttribute('style', beforeClick!);
});

test('scrolling reverses immediately after dragging the pan handle beyond its boundary', async ({ page }) => {
  await page.goto('/a/glyph-flow-background');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
  await zoom.fill('150');
  await zoom.press('Enter');
  const bar = page.locator('.device-pan-bar.is-y');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 800, { steps: 5 });
  await page.mouse.up();
  const y = () => page.locator('.device-stage').evaluate(element => new DOMMatrix((element as HTMLElement).style.transform).f);
  const before = await y();
  const next = (await bar.boundingBox())!;
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
  await page.mouse.wheel(0, 80);
  await expect.poll(y).toBeCloseTo(before - 80, 1);
});

for (const editor of [false, true]) {
  test(`${editor ? 'editor' : 'detail'} enlarged iframe can pan and the center and fit actions always recover the view`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
    await page.goto(`/a/weather-week-switcher${editor ? '/edit' : ''}`);
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.locator('iframe').evaluate(element => element.setAttribute('data-pan-session', 'preserved'));
    await page.getByRole('radio', { name: '电脑', exact: true }).check();
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    await zoom.fill('150');
    await zoom.press('Enter');
    const canvas = (await page.locator('.device-preview').boundingBox())!;
    const position = () => page.locator('.device-stage').evaluate(element => {
      const transform = new DOMMatrix((element as HTMLElement).style.transform);
      return { x: transform.e, y: transform.f, scale: transform.a };
    });
    const initial = await position();
    const pageScroll = await page.evaluate(() => scrollY);
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, 80);
    await expect.poll(async () => (await position()).y).toBeCloseTo(initial.y - 80, 1);
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
    await page.getByRole('button', { name: '移动画布', exact: true }).click();
    await expect(page.getByRole('button', { name: '移动画布', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const beforeDrag = await position();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 - 45, canvas.y + canvas.height / 2 - 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await position()).x).toBeCloseTo(beforeDrag.x - 45, 1);
    await expect.poll(async () => (await position()).y).toBeCloseTo(beforeDrag.y - 40, 1);
    await page.getByRole('button', { name: '移动画布', exact: true }).click();
    await page.getByRole('button', { name: '回到中央', exact: true }).click();
    await expect.poll(() => page.locator('.device-stage').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const host = element.closest('.device-preview')!.getBoundingClientRect();
      return Math.max(Math.abs(rect.x + rect.width / 2 - host.x - host.width / 2), Math.abs(rect.y + rect.height / 2 - host.y - host.height / 2));
    })).toBeLessThan(1);
    await expect(zoom).toHaveValue('150');
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -80);
    await page.keyboard.up('Control');
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(150);
    await page.getByRole('button', { name: '完整显示', exact: true }).click();
    const fits = () => page.locator('.device-stage').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const host = element.closest('.device-preview')!.getBoundingClientRect();
      return rect.x >= host.x - 1 && rect.y >= host.y - 1 && rect.right <= host.right + 1 && rect.bottom <= host.bottom + 1;
    });
    await expect.poll(fits).toBe(true);
    const fitted = await position();
    await page.getByRole('button', { name: '完整显示', exact: true }).click();
    await expect.poll(position).toEqual(fitted);
    await page.getByRole('button', { name: '回到中央', exact: true }).click();
    expect((await position()).scale).toBe(fitted.scale);
    for (const percent of ['50', '100', '150', '50']) {
      await zoom.fill(percent);
      await zoom.press('Enter');
      await expect.poll(async () => (await position()).scale).toBe(Number(percent) / 100);
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: '回到中央', exact: true }).click();
        await expect(zoom).toHaveValue(percent);
        expect((await position()).scale).toBe(Number(percent) / 100);
      }
    }
    await page.getByRole('button', { name: '完整显示', exact: true }).click();
    await expect(page.locator('iframe')).toHaveAttribute('data-pan-session', 'preserved');
    await page.locator('.panel-preview,.editor-preview').screenshot({ path: `test-results/preview-recover-${editor ? 'editor' : 'detail'}.png` });
  });
}

for (const id of ['glyph-flow-background', 'weather-forecast-detail', 'leetcode-heatmap']) {
  test(`${id} keeps enlarged preview geometry stable during wheel scrolling and focus`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
    await page.goto(`/a/${id}`);
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('radio', { name: '电脑', exact: true }).check();
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    await zoom.fill('150');
    await zoom.press('Enter');
    await page.locator('.device-stage').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await page.evaluate(() => {
      const samples: object[] = [];
      (window as unknown as { panSamples: object[] }).panSamples = samples;
      const end = performance.now() + 2500;
      const sample = () => {
        const stage = document.querySelector<HTMLElement>('.device-stage')!;
        const rect = stage.getBoundingClientRect();
        const host = document.querySelector('.device-preview')!.getBoundingClientRect();
        samples.push({
          x: rect.x - host.x, y: rect.y - host.y, target: stage.style.transform,
          transform: getComputedStyle(stage).transform, parent: scrollY,
          hidden: [...document.querySelectorAll('.preview-well,.device-preview,.device-screen,.zoom-stage')].map(element => ({
            name: element.className, x: element.scrollLeft, y: element.scrollTop,
          })),
        });
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const box = (await page.locator('.device-preview').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    for (const delta of [100, 100, -80, -80, 120, -120]) await page.mouse.wheel(0, delta);
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    await page.mouse.move(box.x + box.width - 3, box.y + Math.min(box.height / 2, 300));
    for (const delta of [120, 120, -90, -90]) await page.mouse.wheel(0, delta);
    const samples = await page.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      return (window as unknown as { panSamples: { hidden: { name: string; x: number; y: number }[] }[] }).panSamples;
    });
    await info.attach('pan-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    expect(samples.flatMap(sample => sample.hidden).filter(element => element.x !== 0 || element.y !== 0)).toEqual([]);
    await page.locator('.panel-preview').screenshot({ path: `test-results/preview-pan-${id}.png` });
  });
}
