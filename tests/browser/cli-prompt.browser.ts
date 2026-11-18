import { expect, test } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

for (const width of [1440, 390]) {
  test(`CLI prompt can be inspected and copied at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLibrary(page);
    await page.goto('/transfer');
    await page.getByRole('radio', { name: '让 AI 使用 CLI', exact: true }).check();
    await page.getByRole('button', { name: '复制提示词', exact: true }).click();
    const prompt = await page.evaluate(() => (window as unknown as { copied: string }).copied);
    expect(prompt).toContain('--help');
    expect(prompt).toContain('X:\\CEA-Demo');
    expect(prompt).toContain('导入前检查和预演');
    await page.getByRole('button', { name: '查看提示词', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '让 AI 使用 CLI', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('pre')).toHaveText(prompt);
    const geometry = await dialog.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, screen: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry.width).toBeLessThanOrEqual(geometry.screen);
    expect(geometry.overflow).toBe(false);
    await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
    await page.screenshot({ path: `test-results/cli-prompt-${width}.png` });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('radio', { name: '让 AI 写组件', exact: true }).check();
    await expect(page.locator('.ai-card')).toContainText('把提示词附在需求后');
  });
}

test('format guide starts compact and reveals full rules on demand', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/guide');
  await expect(page.getByRole('heading', { name: '使用说明', exact: true })).toBeVisible();
  await expect(page.locator('.guide-sections details[open]')).toHaveCount(0);
  await page.locator('.guide-sections summary').filter({ hasText: 'asset.json' }).click();
  await expect(page.locator('.guide-sections details[open] pre')).toContainText('"previewEntry"');
  await page.locator('.guide-sections summary').filter({ hasText: 'asset.json' }).click();
  await expect(page.locator('.guide-sections details[open]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/guide-compact.png' });
});
