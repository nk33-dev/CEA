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
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.card-title').first()).toHaveText('paged-24');
  await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
  const scroll = await page.evaluate(() => ({ top: document.querySelector('.results')!.getBoundingClientRect().top, y: scrollY }));
  expect(scroll.top).toBeGreaterThanOrEqual(60);
  expect(scroll.top).toBeLessThan(180);
});
