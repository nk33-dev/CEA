import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1.25 });

for (const framework of ['html', 'react', 'vue']) {
  test(`${framework} grid transition restores its fractional natural height without a final jump`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/collection-layout-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
    await frame.locator('.cl').evaluate(element => {
      const samples: { phase?: string; height: number; footer: number }[] = [];
      (window as unknown as { finalHeightSamples: typeof samples }).finalHeightSamples = samples;
      const end = performance.now() + 1800;
      const sample = () => {
        samples.push({ phase: (element as HTMLElement).dataset.phase,
          height: element.querySelector('.cl-items')!.getBoundingClientRect().height,
          footer: element.querySelector('.cl-footer')!.getBoundingClientRect().y });
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      sample();
    });
    await frame.getByRole('button', { name: 'Grid view', exact: true }).click();
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
    const samples = await frame.locator('.cl').evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return (window as unknown as { finalHeightSamples: { phase?: string; height: number; footer: number }[] }).finalHeightSamples;
    });
    const lastMoving = samples.findLast(sample => sample.phase === 'moving')!;
    const end = samples.at(-1)!;
    expect(lastMoving).toBeDefined();
    expect(Math.abs(lastMoving.height - end.height)).toBeLessThan(0.02);
    expect(Math.abs(lastMoving.footer - end.footer)).toBeLessThan(0.02);
  });
  test(`${framework} collection header text stays pixel-stable during grid/list animation`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/collection-layout-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: 'Grid view', exact: true }).click();
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
    await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).fill('54');
    await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).press('Enter');
    const box = (await frame.locator('.cl-heading').boundingBox())!;
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y) - 3, width: Math.ceil(box.width), height: Math.ceil(box.height) + 6 };
    const baseline = await page.screenshot({ clip });
    for (const name of ['List view', 'Grid view', 'List view']) {
      await frame.getByRole('button', { name, exact: true }).click();
      for (let i = 0; i < 8; i++) {
        const pixels = await page.screenshot({ clip });
        if (!pixels.equals(baseline)) {
          await info.attach('heading-before', { body: baseline, contentType: 'image/png' });
          await info.attach('heading-during', { body: pixels, contentType: 'image/png' });
        }
        expect(pixels.equals(baseline), 'the brand and edition text must stay stationary during layout animation').toBe(true);
      }
      await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
    }
  });
}
