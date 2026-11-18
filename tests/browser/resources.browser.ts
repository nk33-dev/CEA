import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

for (const width of [1440, 390]) {
  test(`resources remain separate from copied text and editable source at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const demo = await mockLibrary(page);
    const asset = demo.assets.get('demo-a')!;
    asset.variants[0].resources = [
      { path: 'images/original-artwork.webp', mime: 'image/webp', size: 23000 },
      { path: `fonts/${'long-descriptive-name-'.repeat(5)}.woff2`, mime: 'font/woff2', size: 48000 },
    ];
    asset.variants[0].files[0].content = '<img src="./images/original-artwork.webp" alt="Original artwork">';
    await page.goto('/a/demo-a');
    const resources = page.locator('.resource-files');
    await expect(resources).toBeVisible();
    await expect(resources.locator('details')).not.toHaveAttribute('open');
    await resources.locator('summary').click();
    await expect(resources.getByText('images/original-artwork.webp')).toBeVisible();
    const geometry = await resources.evaluate(element => ({
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    await page.getByRole('button', { name: '复制提示词', exact: true }).click();
    const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
    expect(copied).toContain('资源文件');
    expect(copied).toContain('images/original-artwork.webp');
    expect(copied).toContain('<img');
    expect(copied).not.toContain('base64');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载源码与资源', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('cea-demo.zip');
    await page.screenshot({ path: path.join(os.tmpdir(), `cea-resources-detail-${width}.png`) });
    const draftRequest = page.waitForRequest(request => request.url().endsWith('/api/play/draft'));
    await page.getByRole('link', { name: '编辑', exact: true }).click();
    expect((await draftRequest).postDataJSON().assetId).toBe(asset.id);
    await expect(page.locator('.resource-files')).toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page).toHaveURL(/\/a\/demo-a$/);
    expect(demo.assets.get('demo-a')!.variants[0].resources).toEqual(asset.variants[0].resources);
    expect(demo.unexpected).toEqual([]);
  });
}
