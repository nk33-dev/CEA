import { expect, test } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('a visited preview survives a full page scroll without loading again', async ({ page }) => {
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
  for (let index = 3; index < 24; index += 3) {
    const next = page.locator('.card').nth(index);
    await next.scrollIntoViewIfNeeded();
    await next.locator('.card-stage').hover();
    await expect(next.locator('.fit-stage')).toHaveAttribute('data-display', 'true');
  }
  await page.mouse.move(0, 0);
  await first.scrollIntoViewIfNeeded();
  await first.locator('.card-stage').hover();
  await expect(first.frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
  expect(requests.filter(url => url.includes('/retained-00/')).length).toBe(initialRequests);
  expect(await page.locator('iframe').count()).toBeLessThanOrEqual(24);
});

test('visible previews warm two at a time and a hovered card bypasses the queue', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let index = 0; index < 1000; index++) {
    const id = `warm-${String(index).padStart(4, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: {}, cover: `assets/${id}/media/cover.png` });
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  await page.route('**/play/**', async route => {
    started.push(new URL(route.request().url()).pathname);
    await gate;
    await route.fallback();
  });
  await page.goto('/');
  await page.mouse.move(0, 0);
  await expect.poll(() => started.length).toBe(2);
  await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
  expect(await page.locator('iframe').count()).toBe(2);
  const target = page.locator('[data-asset-id="warm-0002"]');
  await target.locator('.card-stage').hover();
  await expect.poll(() => started.length).toBe(3);
  expect(started.at(-1)).toContain('/warm-0002/');
  release();
  await expect(target.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await target.frameLocator('iframe').getByRole('button', { name: '0', exact: true }).click();
  await expect(target.frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
  await expect.poll(() => started.length).toBe(6);
  await expect(page.locator('iframe')).toHaveCount(6);
  await expect(page.locator('.fit-stage[data-display]')).toHaveCount(6);
  await expect(page.locator('.card-cover:visible')).toHaveCount(18);
  expect(started.some(url => url.includes('/warm-0006/'))).toBe(false);
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
  await page.locator('.card').last().scrollIntoViewIfNeeded();
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
  expect(scroll.top).toBeLessThan(260);
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

test('offscreen unfinished previews cannot block the current viewport', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let index = 0; index < 24; index++) {
    const id = `queue-${String(index).padStart(2, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: {} });
  }
  await page.route(/\/play\/queue-0[01]\//, route => route.fulfill({
    contentType: 'text/html', body: '<script>parent.postMessage({type:"cea:boot"},"*")</script>',
  }));
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveCount(2);
  const target = page.locator('[data-asset-id="queue-12"]');
  await target.locator('.card-stage').scrollIntoViewIfNeeded();
  await expect(target.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-asset-id="queue-00"] iframe')).toHaveCount(0);
  await target.locator('.card-stage').hover();
  await target.frameLocator('iframe').getByRole('button', { name: '0', exact: true }).click();
  await expect(target.frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
});

test('a stalled runtime exposes an unscaled retry and recovers without leaving the list', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  assets.delete('demo-b');
  assets.delete('demo-c');
  let recover = false;
  await page.route('**/play/**', route => recover ? route.fallback() : route.fulfill({
    contentType: 'text/html',
    body: '<script>parent.postMessage({type:"cea:boot"},"*")</script>',
  }));
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect.poll(() => page.frames().filter(frame => frame.url().includes('/play/')).length).toBe(1);
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
