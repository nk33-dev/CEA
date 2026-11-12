import { test, expect } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test.beforeEach(async ({ page }) => {
  const demo = await mockLibrary(page);
  const asset = structuredClone(demo.assets.get('demo-a')!);
  asset.id = 'weather-day-switcher';
  asset.title = 'Weather Day Switcher';
  asset.sourceName = 'Demo collection';
  asset.sourceUrl = 'https://example.com/reference';
  demo.assets.set(asset.id, asset);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 900 }, { width: 1440, height: 720 }]) {
  test(`editor tabs share workspace bounds at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/a/weather-day-switcher/edit');
    await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
    const bounds = (selector: string) => page.locator(selector).evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top + scrollY, bottom: rect.bottom + scrollY, height: rect.height };
    });
    const code = await bounds('.editor-work');
    const panelBounds = await Promise.all(['.editor-code-panel', '.editor-preview'].map(bounds));
    expect(Math.abs(panelBounds[0].bottom - panelBounds[1].bottom)).toBeLessThan(1);
    await page.locator('iframe').evaluate(element => element.setAttribute('data-session', 'preserved'));
    const tabs = page.getByRole('tablist', { name: '编辑内容', exact: true });
    await tabs.getByRole('tab', { name: '信息与提示词', exact: true }).click();
    const info = await bounds('.editor-info');
    expect(info).toEqual(code);
    const metadata = await page.locator('.editor-col-meta').evaluate(element => {
      const source = element.querySelector('input[type=url]')!.getBoundingClientRect();
      return { sourceBottom: source.bottom, bottom: element.getBoundingClientRect().bottom };
    });
    expect(metadata.sourceBottom).toBeLessThanOrEqual(metadata.bottom);
    const fields = await page.locator('.editor-idea-fields textarea').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }));
    expect(Math.abs(fields[0].top - fields[1].top)).toBeLessThan(1);
    expect(Math.abs(fields[0].bottom - fields[1].bottom)).toBeLessThan(1);
    expect(fields[0].height).toBeGreaterThan(100);
    await page.screenshot({ path: `test-results/editor-aligned-info-${viewport.width}-${viewport.height}.png`, fullPage: true });
    await page.getByRole('textbox', { name: '简介', exact: true }).fill('Long draft summary.\n'.repeat(100));
    expect(await page.locator('.editor-summary-field textarea').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await bounds('.editor-info')).toEqual(info);
    await tabs.getByRole('tab', { name: '代码与预览', exact: true }).click();
    await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
    expect(await bounds('.editor-work')).toEqual(code);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/editor-aligned-code-${viewport.width}-${viewport.height}.png`, fullPage: true });
  });
}

test('editor information flows naturally on a phone and every field remains reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/a/weather-day-switcher/edit');
  await page.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  const versions = page.getByRole('radiogroup', { name: '思路版本', exact: true });
  await expect(versions.locator('[title]')).toHaveCount(0);
  await versions.getByRole('radio', { name: '浅色', exact: true }).check();
  await expect(versions.getByRole('radio', { name: '浅色', exact: true })).toBeChecked();
  await versions.getByRole('radio', { name: '通用', exact: true }).check();
  for (const name of ['默认名称', '来源地址', '简介', '参照描述', '关键差异与交互']) {
    const field = page.getByRole('textbox', { name, exact: true });
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/editor-aligned-info-phone.png', fullPage: true });
});

test('card appearance only shows the sample and live preview retains its zoom controls', async ({ page }) => {
  await page.goto('/a/weather-day-switcher/edit');
  const preview = page.locator('.editor-preview');
  await expect(preview.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const before = await preview.boundingBox();
  await page.getByRole('radio', { name: '卡片外观', exact: true }).check();
  await expect(page.getByRole('article', { name: '列表卡片预览', exact: true })).toBeVisible();
  await expect(preview.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('radiogroup', { name: '展示方式', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '卡片内缩放', exact: true })).toHaveCount(0);
  await expect(preview.locator('.card-look-settings')).toHaveCount(0);
  expect((await preview.boundingBox())!.height).toBe(before!.height);
  await page.screenshot({ path: 'test-results/editor-card-sample-only.png', fullPage: true });
  await page.getByRole('radio', { name: '实时预览', exact: true }).check();
  await expect(page.getByRole('spinbutton', { name: '缩放比例', exact: true })).toBeVisible();
});
