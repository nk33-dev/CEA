import { test, expect } from '@playwright/test';

for (const framework of ['html', 'react', 'vue']) {
  test(`${framework} collection waits for user input instead of cycling layouts`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/collection-layout-switcher');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('[data-auto-cycle],[data-demo-only]')).toHaveCount(0);
    const observed = await frame.locator('.cl').evaluate(async element => {
      const states = [{ view: (element as HTMLElement).dataset.view, phase: (element as HTMLElement).dataset.phase }];
      const observer = new MutationObserver(() => states.push({
        view: (element as HTMLElement).dataset.view, phase: (element as HTMLElement).dataset.phase,
      }));
      observer.observe(element, { attributes: true, attributeFilter: ['data-view', 'data-phase'] });
      await new Promise(resolve => setTimeout(resolve, 5800));
      observer.disconnect();
      return states;
    });
    expect(observed).toEqual([{ view: 'grid', phase: 'idle' }]);
    await frame.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(frame.locator('.cl')).toHaveAttribute('data-view', 'list');
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
    await frame.getByRole('button', { name: 'List view', exact: true }).press('ArrowLeft');
    await expect(frame.locator('.cl')).toHaveAttribute('data-view', 'grid');
    await expect(frame.locator('.cl')).toHaveAttribute('data-phase', 'idle');
  });
}
