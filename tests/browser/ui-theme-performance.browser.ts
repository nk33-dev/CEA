import { expect, test } from '@playwright/test';
import { mockLibrary, PNG } from './fixtures/mockLibrary.ts';

test.use({ deviceScaleFactor: 1.25 });

test('theme switching on a large collection keeps paint work bounded without snapshots', async ({ page }, info) => {
  const demo = await mockLibrary(page);
  const template = demo.assets.get('demo-a')!;
  demo.assets.clear();
  for (let index = 0; index < 1000; index++) {
    const asset = structuredClone(template);
    asset.id = `theme-${index}`;
    asset.title = `Component ${index}`;
    asset.cover = `assets/${asset.id}/cover.png`;
    demo.assets.set(asset.id, asset);
  }
  await page.route('**/files/**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.evaluate(() => Promise.all([...document.images].filter(image => image.getBoundingClientRect().top < innerHeight)
    .map(image => image.decode().catch(() => {}))));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const state = { intervals: [] as number[], stop: false, snapshots: 0 };
    (window as unknown as { themePerformance: typeof state }).themePerformance = state;
    document.startViewTransition = () => { state.snapshots++; throw Error('Unexpected document capture'); };
    let previous = performance.now();
    const sample = (now: number) => {
      state.intervals.push(now - previous);
      previous = now;
      if (!state.stop) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const name of ['深色界面', '浅色界面', '深色界面', '浅色界面']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await expect.poll(() => page.locator('html').getAttribute('data-ui-theme-changing')).toBeNull();
  }
  const observation = await page.evaluate(() => {
    const state = (window as unknown as { themePerformance: { intervals: number[]; stop: boolean; snapshots: number } }).themePerformance;
    state.stop = true;
    const sorted = [...state.intervals].sort((a, b) => a - b);
    return { count: sorted.length, p95: sorted[Math.floor(sorted.length * .95)]!, max: sorted.at(-1)!,
      over50ms: sorted.filter(value => value > 50).length, snapshots: state.snapshots,
      cards: document.querySelectorAll('.card').length, frames: document.querySelectorAll('iframe').length };
  });
  await info.attach('theme-performance', { body: JSON.stringify(observation), contentType: 'application/json' });
  expect(observation.snapshots).toBe(0);
  expect(observation.cards).toBe(24);
  expect(observation.frames).toBe(0);
  expect(observation.count).toBeGreaterThan(30);
  expect(observation.p95, JSON.stringify(observation)).toBeLessThan(34);
  expect(demo.writes).toEqual([]);
});
