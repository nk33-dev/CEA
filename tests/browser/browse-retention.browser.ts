import { expect, test } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('a cover remains visible and a visited preview survives scrolling away and back', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let index = 0; index < 48; index++) {
    const id = `retained-${String(index).padStart(2, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: { zh: { title: id, summary: '', idea: '' } }, cover: `assets/${id}/media/cover.png` });
  }
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/play/')) requests.push(request.url()); });
  await page.goto('/');
  const first = page.locator('.card').first();
  await expect(first.locator('.card-cover')).toBeVisible();
  await first.locator('.card-stage').hover();
  await expect(first.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const counter = first.frameLocator('iframe').getByRole('button', { name: '0', exact: true });
  await counter.click();
  await expect(first.frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
  const initialRequests = requests.filter(url => url.includes('/retained-00/')).length;
  await page.locator('.card').nth(12).scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await first.scrollIntoViewIfNeeded();
  await first.locator('.card-stage').hover();
  await expect(first.frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
  expect(requests.filter(url => url.includes('/retained-00/')).length).toBe(initialRequests);
  expect(await page.locator('iframe').count()).toBeLessThanOrEqual(12);
});

test('a page change keeps the current cards until the replacement is ready', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let index = 0; index < 48; index++) {
    const id = `paged-${String(index).padStart(2, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: { zh: { title: id, summary: '', idea: '' } }, cover: `assets/${id}/media/cover.png` });
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/assets\?/, async route => {
    if (new URL(route.request().url()).searchParams.get('page') === '2') await gate;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.getByRole('button', { name: '下一页', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const state = window as unknown as { pageSamples: { count: number; height: number; y: number }[]; stopSamples: boolean };
    state.pageSamples = [];
    state.stopSamples = false;
    const sample = () => {
      state.pageSamples.push({ count: document.querySelectorAll('.card').length, height: document.documentElement.scrollHeight, y: scrollY });
      if (!state.stopSamples) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.card-title').first()).toHaveText('paged-00');
  const waitingY = await page.evaluate(() => scrollY);
  expect(waitingY).toBeGreaterThan(1000);
  release();
  await expect(page.locator('.card-title').first()).toHaveText('paged-24');
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
  const scroll = await page.evaluate(() => ({ top: document.querySelector('.results')!.getBoundingClientRect().top, y: scrollY }));
  expect(scroll.top).toBeGreaterThanOrEqual(60);
  expect(scroll.top).toBeLessThan(180);
  const samples = await page.evaluate(() => {
    const state = window as unknown as { pageSamples: { count: number; height: number; y: number }[]; stopSamples: boolean };
    state.stopSamples = true;
    return state.pageSamples;
  });
  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every(sample => sample.count === 24)).toBe(true);
  expect(Math.max(...samples.map(sample => sample.height)) - Math.min(...samples.map(sample => sample.height))).toBeLessThan(2);
  expect(samples.filter((sample, index) => index > 0 && Math.abs(sample.y - samples[index - 1].y) > 100).length).toBeLessThanOrEqual(1);
});

test('a broken cover falls back to a live preview', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  assets.get('demo-a')!.cover = 'assets/demo-a/missing.png';
  await page.route('**/files/**', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  const first = page.locator('.card').first();
  await expect(first.locator('.card-cover')).toHaveCount(0);
  await expect(first.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
});

test('a stalled runtime exposes an unscaled retry and recovers without leaving the list', async ({ page }) => {
  await mockLibrary(page);
  let recover = false;
  await page.route('**/play/**', route => recover ? route.fallback() : route.fulfill({
    contentType: 'text/html',
    body: '<script>parent.postMessage({type:"cea:boot"},"*")</script>',
  }));
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveCount(3);
  await expect.poll(() => page.frames().filter(frame => frame.url().includes('/play/')).length).toBe(3);
  await page.clock.runFor(13000);
  const failure = page.locator('.card').first().locator('.preview-failure');
  await expect(failure).toBeVisible();
  await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
  expect((await failure.getByRole('button', { name: '重试预览', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(28);
  recover = true;
  await failure.getByRole('button', { name: '重试预览', exact: true }).click();
  await page.clock.resume();
  await expect(page.locator('.card').first().locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(failure).toHaveCount(0);
});
