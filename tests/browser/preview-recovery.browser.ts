import { expect, test } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('leaving an interacted card pauses it while another card runs', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/');
  const cards = page.locator('.card');
  await expect(cards.first().locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await cards.first().locator('.card-stage').hover();
  await cards.first().frameLocator('iframe').getByRole('button', { name: '0', exact: true }).click();
  await cards.nth(1).locator('.card-stage').hover();
  await expect.poll(async () => {
    const frame = cards.first().locator('iframe').contentFrame();
    return frame.locator('html').getAttribute('data-paused');
  }).toBe('');
});

test('a post-ready runtime failure exposes retry and recovers in place', async ({ page }) => {
  await mockLibrary(page);
  const playback = htmlPlayPage('Failure', [
    { path: 'markup.html', content: '<button id="crash">Crash</button>' },
    { path: 'script.js', content: 'crash.onclick=()=>{throw new Error("Synthetic runtime failure")};' },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  const card = page.locator('.card').first();
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await card.locator('.card-stage').hover();
  await card.frameLocator('iframe').getByRole('button', { name: 'Crash', exact: true }).click();
  await expect(card.locator('.preview-failure')).toBeVisible();
  await card.getByRole('button', { name: '重试预览', exact: true }).click();
  await expect(card.locator('.preview-failure')).toHaveCount(0);
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
});

test('WebGL contexts are bounded across many cards without changing ordinary preview retention', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  const template = structuredClone(assets.get('demo-a')!);
  assets.clear();
  for (let i = 0; i < 1000; i++) {
    const id = `gpu-${String(i).padStart(4, '0')}`;
    assets.set(id, { ...structuredClone(template), id, title: id, texts: {}, cover: `assets/${id}/cover.png` });
  }
  const playback = htmlPlayPage('GPU fixture', [
    { path: 'markup.html', content: '<canvas width="180" height="120"></canvas>' },
    { path: 'script.js', content: 'document.querySelector("canvas").getContext("webgl");' },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  for (let i = 0; i < 18; i++) {
    const card = page.locator('.card').nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.locator('.card-stage').hover();
    await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  }
  await expect.poll(() => page.locator('iframe').count()).toBeLessThanOrEqual(6);
  const last = page.locator('.card').nth(17);
  await expect(last.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.card').first().locator('.card-cover')).toBeVisible();
  const cardFrame = last.frameLocator('iframe');
  await cardFrame.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost')));
  await expect(last.locator('.preview-failure')).toBeVisible();
  await cardFrame.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextrestored')));
  await expect(last.locator('.preview-failure')).toHaveCount(0);
});

test('compile failures do not masquerade as ready previews', async ({ page }) => {
  await mockLibrary(page);
  const { bundlePlayPage } = await import('../../server/play.ts');
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: bundlePlayPage('Broken', '', 'Synthetic compile error') }));
  await page.goto('/');
  await expect(page.locator('.card').first().locator('.preview-failure')).toBeVisible();
  await expect(page.locator('.browse-progress')).not.toHaveAttribute('data-busy', 'true');
});
