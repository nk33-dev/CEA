import { expect, test } from '@playwright/test';
import { htmlPlayPage } from '../../server/play.ts';
import { mockLibrary } from './fixtures/mockLibrary.ts';

for (const width of [1440, 390]) {
  test(`cover and live bounds share the same fractional position at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 901 });
    const { assets } = await mockLibrary(page);
    assets.delete('demo-b'); assets.delete('demo-c');
    assets.get('demo-a')!.cover = 'assets/demo-a/cover.png';
    await page.route('**/files/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="296" height="260"><rect width="296" height="260" fill="white"/></svg>' }));
    const playback = htmlPlayPage('Framing', [
      { path: 'markup.html', content: '<section data-preview-bounds style="box-sizing:border-box;width:296px;height:260px;background:#fff;border:1px solid #ddd"><button style="width:66px;height:48px;margin:106px 114px">Open</button></section>' },
    ]);
    await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
    await page.goto('/');
    await page.mouse.move(0, 0);
    const card = page.locator('.card');
    await expect(card.locator('.fit-stage')).toHaveAttribute('data-display', 'true');
    const expected = await card.locator('.card-cover').evaluate(async node => {
      const image = node as HTMLImageElement;
      await image.decode();
      const rect = image.getBoundingClientRect();
      const css = getComputedStyle(image);
      const pad = parseFloat(css.paddingLeft);
      const scale = Math.min(1, (rect.width - pad * 2) / image.naturalWidth, (rect.height - pad * 2) / image.naturalHeight);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: image.naturalWidth * scale, height: image.naturalHeight * scale };
    });
    const iframe = (await card.locator('iframe').boundingBox())!;
    const bounds = await card.frameLocator('iframe').locator('section').evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
    const actual = {
      x: iframe.x + (bounds.rect.x + bounds.rect.width / 2) * iframe.width / bounds.width,
      y: iframe.y + (bounds.rect.y + bounds.rect.height / 2) * iframe.height / bounds.height,
      width: bounds.rect.width * iframe.width / bounds.width,
      height: bounds.rect.height * iframe.height / bounds.height,
    };
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThan(0.03);
    await card.locator('.card-stage').hover();
    await expect(card.frameLocator('iframe').locator('html')).not.toHaveAttribute('data-paused', '');
    expect(await card.locator('iframe').boundingBox()).toEqual(iframe);
  });
}
