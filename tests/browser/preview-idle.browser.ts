import { expect, test } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import { BACKGROUND_RELEASE_MS } from '../../src/components/PreviewActivity.tsx';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('covered frames stay renderable while warming and accept the first hover and click', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  for (const asset of assets.values()) asset.cover = `assets/${asset.id}/cover.png`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/play/**', async route => { await gate; await route.fallback(); });
  await page.goto('/');
  await page.mouse.move(0, 0);
  const card = page.locator('.card').first();
  await expect(card.locator('iframe')).toHaveCount(1);
  await expect(card.locator('.card-cover')).toBeVisible();
  await expect(card.locator('iframe')).toHaveCSS('visibility', 'visible');
  const hit = await card.locator('.card-stage').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('card-cover');
  });
  expect(hit).toBe(true);
  release();
  await card.locator('.card-stage').hover();
  const frame = card.frameLocator('iframe');
  await frame.getByRole('button', { name: '0', exact: true }).click();
  await expect(frame.getByRole('button', { name: '1', exact: true })).toBeVisible();
  await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');
});

for (const width of [1440, 390]) {
  test(`idle and interactive thumbnails share one sharp frame at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { assets } = await mockLibrary(page);
    assets.get('demo-a')!.cover = 'assets/demo-a/old-cover.png';
    const playback = htmlPlayPage('Stable button', [
      { path: 'markup.html', content: '<button style="width:180px;height:80px;border:2px solid #222;border-radius:6px;background:#fff;color:#111;font:18px Arial">Sharp text</button>' },
      { path: 'script.js', content: 'document.querySelector("button").onclick=event=>event.currentTarget.dataset.clicked="true";' },
    ]);
    await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
    await page.goto('/');
    await page.mouse.move(0, 0);
    const card = page.locator('.card').first();
    await expect(card.locator('.fit-stage')).toHaveAttribute('data-display', 'true');
    await expect(card.locator('.card-cover')).toBeHidden();
    const frame = card.frameLocator('iframe');
    await expect(frame.locator('html')).toHaveAttribute('data-paused', '');
    const before = await card.locator('.fit-stage-inner').getAttribute('style');
    await card.locator('.card-stage').screenshot({ path: info.outputPath('idle.png') });
    const idle = await card.locator('.card-stage').screenshot();
    await card.locator('.card-stage').hover({ position: { x: 5, y: 5 } });
    await expect(frame.locator('html')).not.toHaveAttribute('data-paused', '');
    expect(await card.locator('.fit-stage-inner').getAttribute('style')).toBe(before);
    expect(await card.locator('.card-stage').screenshot()).toEqual(idle);
    await frame.getByRole('button', { name: 'Sharp text', exact: true }).click();
    await expect(frame.locator('button')).toHaveAttribute('data-clicked', 'true');
    await page.mouse.move(0, 0);
    await expect(frame.locator('html')).toHaveAttribute('data-paused', '');
  });
}

test('paused timers stop work and resumed animation clocks agree with performance.now', async ({ page }) => {
  await mockLibrary(page);
  const playback = htmlPlayPage('Timer fixture', [
    { path: 'markup.html', content: '<button style="width:180px;height:80px">Count</button>' },
    { path: 'script.js', content: `window.ticks=0;window.clockGap=0;
      setInterval(()=>window.ticks++,20);
      function draw(time){window.clockGap=performance.now()-time;requestAnimationFrame(draw)}requestAnimationFrame(draw);
      document.querySelector('button').onclick=event=>event.currentTarget.dataset.clicked='true';` },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  await page.mouse.move(0, 0);
  const card = page.locator('.card').first();
  const frame = card.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveAttribute('data-paused', '');
  const ticks = () => frame.locator('html').evaluate(() => (window as unknown as { ticks: number }).ticks);
  const before = await ticks();
  await page.waitForTimeout(2200);
  expect(await ticks()).toBe(before);
  await card.locator('.card-stage').hover();
  await expect.poll(ticks).toBeGreaterThan(before);
  expect(await frame.locator('html').evaluate(() => (window as unknown as { clockGap: number }).clockGap)).toBeLessThan(500);
  await frame.getByRole('button', { name: 'Count', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(frame.locator('html')).toHaveAttribute('data-paused', '');
  const stopped = await ticks();
  await page.waitForTimeout(300);
  expect(await ticks()).toBe(stopped);
});

test('declared content retains room for painted overflow above its layout box', async ({ page }) => {
  await mockLibrary(page);
  const playback = htmlPlayPage('Overflow fixture', [
    { path: 'markup.html', content: '<div data-preview-bounds="children"><div id="button" style="position:relative;width:56px;height:56px"><svg style="position:absolute;left:-17px;top:-17px;width:90px;height:90px"><circle cx="45" cy="45" r="35" fill="#222"/></svg></div></div>' },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  const frame = page.locator('.card').first().frameLocator('iframe');
  await expect(frame.locator('svg')).toBeVisible();
  expect(await frame.locator('svg').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
});

test('long background stays release frames and restore only current visible cards', async ({ page }) => {
  const { assets } = await mockLibrary(page);
  for (const asset of assets.values()) asset.cover = `assets/${asset.id}/cover.png`;
  await page.goto('/?sort=title');
  await page.mouse.move(0, 0);
  await expect(page.locator('iframe')).toHaveCount(3);
  await expect(page.locator('.fit-stage[data-display]')).toHaveCount(3);
  await page.clock.install();
  const visibility = (hidden: boolean) => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await visibility(true);
  await page.clock.runFor(5000);
  await expect(page.locator('iframe')).toHaveCount(3);
  await visibility(false);
  await page.clock.runFor(500);
  await expect(page.locator('iframe')).toHaveCount(3);
  await visibility(true);
  await page.clock.runFor(BACKGROUND_RELEASE_MS + 100);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.card-cover:visible')).toHaveCount(3);
  await visibility(false);
  await page.clock.resume();
  await expect(page.locator('.fit-stage[data-display]')).toHaveCount(3);
  await expect(page).toHaveURL(/[?&]sort=title(?:&|$)/);
});

test('custom dropdown options scroll inside the visible thumbnail without replacing the control', async ({ page }) => {
  await mockLibrary(page);
  const playback = htmlPlayPage('Custom menu', [
    { path: 'markup.html', content: `<div data-preview-bounds="children"><div style="position:relative;width:160px">
      <button aria-expanded="false" aria-controls="choices" style="width:160px;height:32px">Choose</button>
      <div id="menu-surface" style="position:absolute;top:38px;padding:4px;background:white"><div id="choices" role="listbox" hidden>
      ${Array.from({ length: 20 }, (_, index) => `<button role="option" style="display:block;width:152px;height:30px">Option ${index}</button>`).join('')}
      </div></div></div></div>` },
    { path: 'script.js', content: `const trigger=document.querySelector('[aria-controls]'),list=document.querySelector('[role=listbox]');
      trigger.onclick=()=>{list.hidden=!list.hidden;trigger.setAttribute('aria-expanded',String(!list.hidden))};
      list.onpointerdown=event=>{trigger.dataset.chosenIndex=String(Math.floor((event.clientY-list.getBoundingClientRect().top)/30))};
      list.onclick=event=>{trigger.textContent=event.target.textContent;list.hidden=true;trigger.setAttribute('aria-expanded','false')};` },
  ]);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.goto('/');
  const card = page.locator('.card').first();
  const frame = card.frameLocator('iframe');
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-display', 'true');
  await frame.getByRole('button', { name: 'Choose', exact: true }).click();
  const list = frame.getByRole('listbox');
  const surface = frame.locator('#menu-surface');
  await expect(surface).toHaveCSS('overflow-y', 'auto');
  const stage = (await card.locator('.card-stage').boundingBox())!;
  const menu = (await surface.boundingBox())!;
  expect(menu.y + menu.height).toBeLessThan(stage.y + stage.height);
  const last = frame.getByRole('option', { name: 'Option 19', exact: true });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(frame.getByRole('button', { name: 'Option 19', exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Option 19', exact: true })).toHaveAttribute('data-chosen-index', '19');
  await expect(list).toBeHidden();
  await expect(surface).toHaveCSS('overflow-y', 'visible');
});
