import { expect, test } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import { PREVIEW_IDLE_MS, SCROLL_SETTLE_MS } from '../../src/components/PreviewActivity.tsx';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('scrolling and short pointer passes do not start cold previews', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  for (const asset of assets.values()) asset.cover = `assets/${asset.id}/cover.png`;
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/play/**', async route => { started.push(route.request().url()); await gate; await route.fallback(); });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(3);
  for (let index = 0; index < 6; index++) {
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(100);
  }
  expect(started).toHaveLength(0);
  await page.waitForTimeout(SCROLL_SETTLE_MS + 20);
  const stage = page.locator('.card-stage').first();
  await stage.hover();
  await page.waitForTimeout(30);
  await page.mouse.move(0, 0);
  expect(started).toHaveLength(0);
  await expect.poll(() => started.length).toBe(1);
  await page.waitForTimeout(PREVIEW_IDLE_MS + 100);
  expect(started).toHaveLength(1);
  release();
  await expect(page.locator('.card').first().locator('.fit-stage')).toHaveAttribute('data-display', 'true');
  await stage.hover();
  await page.locator('.card').first().frameLocator('iframe').getByRole('button', { name: '0', exact: true }).click();
  await expect(page.locator('.card').first().frameLocator('iframe').getByRole('button', { name: '1', exact: true })).toBeVisible();
});

test('scroll pauses a mounted preview without replacing its frame or interaction state', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  for (const asset of assets.values()) asset.cover = `assets/${asset.id}/cover.png`;
  const playback = htmlPlayPage('Scheduling', [
    { path: 'markup.html', content: '<button style="width:180px;height:80px">0</button>' },
    { path: 'script.js', content: 'window.ticks=0;setInterval(()=>window.ticks++,20);document.querySelector("button").onclick=e=>e.target.textContent=Number(e.target.textContent)+1;' },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  const card = page.locator('.card').first();
  await card.locator('.card-stage').hover();
  const frame = card.frameLocator('iframe');
  await frame.getByRole('button', { name: '0', exact: true }).click();
  await card.locator('iframe').evaluate(element => element.setAttribute('data-session', 'kept'));
  const ticks = () => frame.locator('html').evaluate(() => (window as unknown as { ticks: number }).ticks);
  for (let index = 0; index < 5; index++) {
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(80);
    await expect(frame.locator('html')).toHaveAttribute('data-paused', '');
  }
  const paused = await ticks();
  await page.waitForTimeout(60);
  expect(await ticks()).toBe(paused);
  await expect.poll(ticks).toBeGreaterThan(paused);
  await expect(card.locator('iframe')).toHaveAttribute('data-session', 'kept');
  await expect(frame.getByRole('button', { name: '1', exact: true })).toBeVisible();
  expect(await page.locator('iframe').count()).toBe(1);
});

test('changing pages waits for data and browser settling before warming the replacement', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let index = 0; index < 48; index++) {
    const id = `settle-${String(index).padStart(2, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: {}, cover: `assets/${id}/cover.png` });
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/assets\?/, async route => {
    if (new URL(route.request().url()).searchParams.get('page') === '2') await gate;
    await route.fallback();
  });
  await page.goto('/');
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(PREVIEW_IDLE_MS + 100);
  expect(await page.locator('iframe').count()).toBe(0);
  release();
  await expect(page.locator('.card').first()).toHaveAttribute('data-asset-id', 'settle-24');
  await expect(page.locator('.card-cover').first()).toBeVisible();
  expect(await page.locator('iframe').count()).toBe(0);
  await expect.poll(() => page.locator('iframe').count()).toBe(1);
});
