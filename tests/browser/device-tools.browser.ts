import { test, expect } from '@playwright/test';

test('quick rotation stays outside the menu and continuous rotation tracks without transitions or reloads', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cea:framework', 'html');
    localStorage.setItem('cea:locale', 'zh');
  });
  let loads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/play/')) loads++; });
  await page.goto('/a/weather-day-switcher');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  const quick = page.getByRole('button', { name: '向右旋转设备 90°', exact: true });
  const shell = page.locator('.device-shell');
  await quick.click();
  await expect(shell).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await expect(page.locator('.rotate-pop')).toHaveCount(0);
  await page.getByRole('button', { name: '旋转设置', exact: true }).click();
  await page.locator('.rotate-pop').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.locator('.panel-preview').screenshot({ path: 'test-results/rotation-controls.png' });
  await page.getByRole('button', { name: '回正', exact: true }).click();
  const range = page.getByRole('slider', { name: '旋转角度', exact: true });
  await expect(range).toHaveValue('0');
  const box = (await range.boundingBox())!;
  const center = box.x + box.width / 2;
  await page.mouse.move(center, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.device-preview')).toHaveClass(/is-direct/);
  for (let step = 1; step <= 16; step++) {
    await page.mouse.move(center + box.width * .4 * step / 16, box.y + box.height / 2);
  }
  await expect(shell).toHaveCSS('transition-duration', '0s');
  await expect.poll(async () => {
    const angle = await range.inputValue();
    const transform = await shell.evaluate(element => (element as HTMLElement).style.transform);
    return transform.includes(`rotate(${angle}deg)`);
  }).toBe(true);
  await page.mouse.up();
  expect(loads).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.rotate-pop')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '旋转设置', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'AI 配色目标' }).click();
  await expect(page.getByRole('option')).toHaveCount(4);
  await expect(page.getByRole('option', { name: '沿用原配色', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '原配色', exact: true })).toHaveCount(0);
});

test('editor uses the same quick rotation and preview isolation', async ({ page }) => {
  await page.goto('/a/weather-day-switcher/edit');
  await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  const title = page.getByRole('textbox', { name: '默认名称', exact: true });
  const before = await title.inputValue();
  await page.getByRole('tab', { name: '代码与预览', exact: true }).click();
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('button', { name: '向右旋转设备 90°', exact: true }).click();
  await expect(page.locator('.device-shell')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await page.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  await expect(title).toHaveValue(before);
});

test('rotation controls and popup fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/a/weather-day-switcher');
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await page.getByRole('button', { name: '旋转设置', exact: true }).click();
  await page.locator('.rotate-pop').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const box = (await page.locator('.rotate-pop').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(11);
  expect(box.x + box.width).toBeLessThanOrEqual(379);
  const widths = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.width);
  await page.screenshot({ path: 'test-results/rotation-mobile.png' });
});
