import { test, expect } from '@playwright/test';

for (const framework of ['html', 'react', 'vue']) {
test(`${framework} collection layout transitions do not create transient document scrollbars`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
  await page.goto('/a/collection-layout-switcher');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
  await zoom.fill('30');
  await zoom.press('Enter');
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Grid view', exact: true }).click();
  await frame.locator('.cl').evaluate(el => {
    const values: object[] = [];
    (window as unknown as { overflowSamples: object[] }).overflowSamples = values;
    const end = performance.now() + 6500;
    const sample = () => {
      const rect = el.getBoundingClientRect();
      const body = document.body.getBoundingClientRect();
      values.push({
        phase: (el as HTMLElement).dataset.phase, view: (el as HTMLElement).dataset.view,
        progress: (el as HTMLElement).dataset.progress, y: rect.y, bottom: rect.bottom, height: rect.height,
        bodyHeight: body.height, viewport: innerHeight, scrollHeight: document.documentElement.scrollHeight,
        scrollbar: innerWidth - document.documentElement.clientWidth, width: rect.width,
        overflow: getComputedStyle(document.documentElement).overflowY,
      });
      if (performance.now() < end) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  for (const name of ['List view', 'Grid view', 'List view', 'Grid view']) {
    await frame.getByRole('button', { name, exact: true }).click();
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
  }
  const samples = await frame.locator('.cl').evaluate(() => (window as unknown as { overflowSamples: { viewport: number; bottom: number; scrollHeight: number; scrollbar: number; bodyHeight: number; overflow: string }[] }).overflowSamples);
  await info.attach('overflow-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
  const falseOverflow = samples.filter(s => s.bodyHeight <= s.viewport + 1 && s.scrollHeight > s.viewport + 1);
  console.log('collection overflow', { samples: samples.length, transient: falseOverflow.length,
    maxBody: Math.max(...samples.map(s => s.bodyHeight)), maxScroll: Math.max(...samples.map(s => s.scrollHeight)) });
  expect(falseOverflow).toHaveLength(0);
  expect(samples.filter(s => s.bottom <= s.viewport && s.scrollbar > 0 && s.overflow !== 'clip')).toHaveLength(0);
  await page.locator('.panel-preview').screenshot({ path: info.outputPath('collection.png') });
  if (framework === 'html') {
    await page.getByRole('button', { name: '全屏预览', exact: true }).click();
    await expect(page.locator('.panel-subbar')).toBeHidden();
    await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight })))
      .toEqual({ width: 1600, height: 1000 });
    await page.screenshot({ path: info.outputPath('collection-fullscreen.png') });
    await page.getByRole('button', { name: '展开预览工具', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: '缩放比例', exact: true })).toHaveValue('100');
    await page.screenshot({ path: info.outputPath('collection-fullscreen-tools.png') });
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect(zoom).toHaveValue('30');
  }
});
}
