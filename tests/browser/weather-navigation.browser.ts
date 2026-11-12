import { test, expect } from '@playwright/test';

for (const width of [630, 390, 1440]) {
  test(`weather option navigation only scrolls its own menu at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 790 });
    await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
    await page.goto('/a/weather-week-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.locator('.preview-well').evaluate(element => element.scrollIntoView({ block: 'center' }));
    const frame = page.frameLocator('iframe');
    const trigger = frame.getByRole('button', { name: '选择预览天气', exact: true });
    const before = await page.evaluate(() => scrollY);
    await trigger.click();
    const menu = frame.locator('.wx-weather-menu:popover-open');
    await expect(menu).toBeVisible();
    await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    expect(await page.evaluate(() => scrollY)).toBe(before);
    const positions = [];
    for (const key of ['End', 'Home', 'End', 'ArrowLeft', 'Home']) {
      await page.keyboard.press(key);
      positions.push(await page.evaluate(() => scrollY));
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
    }
    await info.attach('outer-scroll', { body: JSON.stringify({ before, positions }), contentType: 'application/json' });
    await page.locator('.panel-preview').screenshot({ path: info.outputPath('weather-navigation.png') });
  });
}

test('scrolling at weather menu boundaries cannot move the enlarged preview', async ({ page }) => {
  await page.setViewportSize({ width: 646, height: 807 });
  await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
  await page.goto('/a/weather-week-switcher');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.locator('.preview-well').evaluate(element => element.scrollIntoView({ block: 'center' }));
  const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
  await zoom.fill('200');
  await zoom.press('Enter');
  const bar = (await page.locator('.device-pan-bar.is-y').boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.wheel(0, -1000);
  const horizontal = (await page.locator('.device-pan-bar.is-x').boundingBox())!;
  await page.mouse.move(horizontal.x + horizontal.width / 2, horizontal.y + horizontal.height / 2);
  await page.mouse.wheel(1000, 0);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
  const menu = frame.locator('.wx-weather-menu');
  await expect(menu).toBeVisible();
  await menu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const before = await page.locator('.device-stage').getAttribute('style');
  for (const direction of [1, -1]) {
    await menu.evaluate((element, sign) => { element.scrollTop = sign > 0 ? element.scrollHeight : 0; }, direction);
    const rect = (await menu.boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, direction * 400);
    await page.waitForTimeout(200);
    await expect(page.locator('.device-stage')).toHaveAttribute('style', before!);
  }
});
