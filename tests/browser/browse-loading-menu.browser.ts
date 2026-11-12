import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`sort menu stays compact and preserves page geometry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('.card')).not.toHaveCount(0);
    const sort = page.getByRole('combobox', { name: '排序', exact: true });
    await sort.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 64));
    const geometry = () => page.evaluate(() => {
      const home = document.querySelector('.home')!.getBoundingClientRect();
      const grid = document.querySelector('.grid')!.getBoundingClientRect();
      return { x: home.x, width: home.width, top: grid.y, scroll: scrollY };
    });
    const before = await geometry();
    const bodyPosition = await page.locator('body').evaluate(element => getComputedStyle(element).position);
    await page.evaluate(() => {
      const values: { x: number; width: number; top: number; scroll: number }[] = [];
      (window as unknown as { menuGeometry: typeof values }).menuGeometry = values;
      const until = performance.now() + 1200;
      const sample = () => {
        const home = document.querySelector('.home')!.getBoundingClientRect();
        const grid = document.querySelector('.grid')!.getBoundingClientRect();
        values.push({ x: home.x, width: home.width, top: grid.y, scroll: scrollY });
        if (performance.now() < until) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await sort.click();
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.locator('body')).toHaveCSS('position', bodyPosition);
    const samples = await page.evaluate(async () => {
      const values = [];
      for (let i = 0; i < 12; i++) {
        const home = document.querySelector('.home')!.getBoundingClientRect();
        const grid = document.querySelector('.grid')!.getBoundingClientRect();
        values.push({ x: home.x, width: home.width, top: grid.y, scroll: scrollY });
        await new Promise(requestAnimationFrame);
      }
      return values;
    });
    const initial = await page.evaluate(() => (window as unknown as { menuGeometry: typeof samples }).menuGeometry);
    for (const sample of [...initial, ...samples]) {
      expect(sample.x).toBeCloseTo(before.x, 0);
      expect(sample.width).toBeCloseTo(before.width, 0);
      expect(sample.top).toBeCloseTo(before.top, 0);
      expect(sample.scroll).toBe(before.scroll);
    }
    const menu = (await page.getByRole('listbox').boundingBox())!;
    expect(menu.width).toBeLessThanOrEqual(200);
    expect(menu.x).toBeGreaterThanOrEqual(12);
    expect(menu.x + menu.width).toBeLessThanOrEqual(width - 12);
    const firstOption = page.getByRole('option').first();
    await firstOption.hover();
    await expect(firstOption).toHaveCSS('outline-style', 'none');
    await expect(firstOption).toHaveCSS('box-shadow', 'none');
    await page.screenshot({ path: `test-results/sort-menu-${width}.png` });
    await page.keyboard.press('ArrowDown');
    const keyboardOption = page.getByRole('option', { name: '最近添加', exact: true });
    await expect(keyboardOption).toBeFocused();
    await expect(keyboardOption).toHaveCSS('box-shadow', 'rgb(75, 75, 80) 2px 0px 0px 0px inset');
    await page.keyboard.press('Escape');
    await expect(sort).toBeFocused();
    const after = await geometry();
    expect(after).toEqual(before);
    await sort.click();
    await page.getByRole('option', { name: '最近添加', exact: true }).click();
    await expect(page).toHaveURL(/sort=created/);
    await expect(sort).toContainText('最近添加');
    await expect(page.locator('.results')).toHaveAttribute('aria-busy', 'false');
    expect(await geometry()).toEqual(before);
  });
}
