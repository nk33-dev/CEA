import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';

for (const ratio of [1.25, 1.5, 2]) {
  test.describe(`fractional display scale ${ratio}`, () => {
    test.use({ deviceScaleFactor: ratio });
    test('weather text stays stable in the real window shape', async ({ page }, info) => {
      await page.setViewportSize({ width: 646, height: 807 });
      await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
      await page.goto('/a/weather-week-switcher');
      await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
      await page.locator('.preview-well').evaluate(element => element.scrollIntoView({ block: 'center' }));
      const frame = page.frameLocator('iframe');
      await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
      const menu = frame.locator('.wx-weather-menu');
      await expectStablePixels(page, menu, info);
      await menu.evaluate(element => { element.scrollTop = 83; });
      await expectStablePixels(page, menu, info);
      await page.locator('.panel-preview').screenshot({ path: info.outputPath('fractional-menu.png') });
    });
  });
}

async function expectStablePixels(page: Page, menu: Locator, info: TestInfo) {
  await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.mouse.move(0, 0);
  await menu.evaluate(async element => {
    await new Promise(requestAnimationFrame);
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
  const bounds = (await menu.boundingBox())!;
  const clip = { x: bounds.x + 12, y: bounds.y + 12, width: bounds.width - 24, height: bounds.height - 24 };
  const images: string[] = [];
  for (let i = 0; i < 16; i++) {
    images.push((await page.screenshot({ clip })).toString('base64'));
    await page.waitForTimeout(80);
  }
  const changes = await page.evaluate(async encoded => {
    const canvases = await Promise.all(encoded.map(async data => {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: 'image/png' }));
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      return context.getImageData(0, 0, image.width, image.height).data;
    }));
    return canvases.slice(1).map((pixels, index) => {
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ([0, 1, 2].some(channel => Math.abs(pixels[i + channel] - canvases[index][i + channel]) > 15)) changed++;
      }
      return changed / (pixels.length / 4);
    });
  }, images);
  await info.attach('menu-pixel-changes', { body: JSON.stringify(changes), contentType: 'application/json' });
  await info.attach('menu-start', { body: Buffer.from(images[0], 'base64'), contentType: 'image/png' });
  await info.attach('menu-end', { body: Buffer.from(images.at(-1)!, 'base64'), contentType: 'image/png' });
  expect(Math.max(...changes)).toBeLessThan(0.001);
}

test('standalone weather menu has stable text while the weather animates', async ({ page, request }, info) => {
  const asset = await (await request.get('/api/assets/weather-day-switcher')).json() as AssetDetail;
  const files = asset.variants.find(variant => variant.framework === 'html')!.files;
  const content = (path: string) => files.find(file => file.path === path)!.content;
  await page.route('**/standalone-weather', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center}${content('style.css')}</style></head><body>${content('markup.html')}<script>${content('script.js')}</script></body></html>`,
  }));
  await page.goto('/standalone-weather');
  await page.getByRole('button', { name: '选择预览天气', exact: true }).click();
  await expectStablePixels(page, page.locator('.wx-weather-menu'), info);
});

for (const [id, framework] of ['weather-day-switcher', 'weather-week-switcher', 'weather-forecast-detail']
  .flatMap(id => ['html', 'vue'].map(framework => [id, framework] as const))) {
test(`${id} ${framework} opening never flashes or shifts before its fade starts`, async ({ page }, info) => {
  await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
  await page.goto(`/a/${id}`);
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const frame = page.frameLocator('iframe');
  const menu = frame.locator('.wx-weather-menu');
  await menu.evaluate(element => {
    const samples: { opacity: number; x: number; y: number; width: number; height: number }[] = [];
    (window as unknown as { openingFrames: typeof samples }).openingFrames = samples;
    element.addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState !== 'open') return;
      let count = 0;
      samples.length = 0;
      const sample = () => {
        const rect = element.getBoundingClientRect();
        samples.push({ opacity: Number(getComputedStyle(element).opacity), x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        if (++count < 30) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
    await expect.poll(() => menu.evaluate(() => (window as unknown as { openingFrames: unknown[] }).openingFrames.length)).toBe(30);
    const samples = await menu.evaluate(() => (window as unknown as { openingFrames: { opacity: number; x: number; y: number; width: number; height: number }[] }).openingFrames);
    await info.attach(`opening-frames-${cycle}`, { body: JSON.stringify(samples), contentType: 'application/json' });
    for (let index = 1; index < samples.length; index++) expect(samples[index].opacity).toBeGreaterThanOrEqual(samples[index - 1].opacity - 0.001);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.max(...samples.map(sample => sample[key])) - Math.min(...samples.map(sample => sample[key]))).toBeLessThan(0.5);
    }
    await page.keyboard.press('Escape');
  }
});
}

for (const scenario of [
  { framework: 'html', zoom: '70', width: 1440 },
  { framework: 'html', zoom: '100', width: 1920 },
  { framework: 'vue', zoom: '100', width: 1440 },
  { framework: 'vue', zoom: '150', width: 1440 },
  { framework: 'html', zoom: '100', width: 390 },
]) {
  test(`${scenario.framework} weather menu text stays stable at ${scenario.zoom}% in a ${scenario.width}px preview`, async ({ page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: 1080 });
    await page.addInitScript(framework => localStorage.setItem('cea:framework', framework), scenario.framework);
    await page.goto('/a/weather-day-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    await zoom.fill(scenario.zoom);
    await zoom.press('Enter');
    if (await page.locator('.device-pan-bar.is-x').count()) {
      const bar = (await page.locator('.device-pan-bar.is-x').boundingBox())!;
      await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
      await page.mouse.wheel(1000, 0);
    }
    const frame = page.frameLocator('iframe');
    const menu = frame.locator('.wx-weather-menu');
    const trigger = frame.getByRole('button', { name: '选择预览天气', exact: true });
    await expect(menu).toHaveCSS('will-change', 'auto');
    await trigger.click();
    await expect(menu).toHaveCSS('will-change', 'transform');
    await expectStablePixels(page, menu, info);
    await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expectStablePixels(page, menu, info);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menu).toHaveCSS('will-change', 'auto');
    await trigger.click();
    await expectStablePixels(page, menu, info);
  });
}
