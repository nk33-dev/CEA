import { test, expect } from '@playwright/test';

for (const width of [1440, 1000]) {
  test(`import and export share content and action rows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/transfer');
    await expect(page.locator('.transfer-layout')).toHaveClass(/is-idle/);
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width, center: rect.top + rect.height / 2 };
      };
      return {
        drop: box('.transfer-drop'), formats: box('.transfer-export .choice-list'),
        ai: box('.ai-card'), footer: box('.transfer-export-footer'),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(layout.drop.width).toBeCloseTo(layout.formats.width, 0);
    expect(layout.drop.top).toBeCloseTo(layout.formats.top, 0);
    expect(layout.drop.bottom).toBeCloseTo(layout.formats.bottom, 0);
    expect(layout.ai.center).toBeCloseTo(layout.footer.center, 0);
    expect(layout.overflow).toBe(false);
  });
}
