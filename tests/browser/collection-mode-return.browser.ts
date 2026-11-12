import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1550, height: 1000 }, deviceScaleFactor: 1.25 });

for (const framework of ['html', 'react', 'vue']) {
  test(`${framework} returning to component mode fits the current layout and keeps its header stable`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/collection-layout-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    const collection = frame.locator('.cl');
    await frame.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(collection).toHaveAttribute('data-phase', 'idle');
    await page.locator('iframe').evaluate(el => el.setAttribute('data-session', 'retained'));
    for (const mode of ['手机', '电脑', '手机']) {
      await page.getByRole('radio', { name: mode, exact: true }).check();
      await page.getByRole('radio', { name: '组件', exact: true }).check();
      await expect.poll(async () => {
        const host = (await page.locator('.device-preview').boundingBox())!;
        const component = (await collection.boundingBox())!;
        return {
          centered: Math.abs(component.x + component.width / 2 - host.x - host.width / 2) < 1,
          inside: component.x >= host.x + 30 && component.x + component.width <= host.x + host.width - 30 &&
            component.y >= host.y + 30 && component.y + component.height <= host.y + host.height - 30,
        };
      }).toEqual({ centered: true, inside: true });
      await expect(page.locator('iframe')).toHaveAttribute('data-session', 'retained');
      const rect = (await frame.locator('.cl-heading').boundingBox())!;
      const clip = { x: Math.floor(rect.x), y: Math.floor(rect.y) - 2, width: Math.ceil(rect.width), height: Math.ceil(rect.height) + 4 };
      const before = await page.screenshot({ clip });
      for (const name of ['Grid view', 'List view']) {
        await frame.getByRole('button', { name, exact: true }).click();
        for (let i = 0; i < 6; i++) {
          const during = await page.screenshot({ clip });
          if (!during.equals(before)) {
            await info.attach('header-before', { body: before, contentType: 'image/png' });
            await info.attach('header-during', { body: during, contentType: 'image/png' });
          }
          expect(during.equals(before), 'header pixels must remain stable after returning from another device').toBe(true);
        }
        await expect(collection).toHaveAttribute('data-phase', 'idle');
      }
    }
  });
}
