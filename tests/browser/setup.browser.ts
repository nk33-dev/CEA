import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`first use selects a library before loading data at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let ready = false;
    const libraryPath = 'X:\\My Components';
    let error = true;
    await page.route('**/api/library', async route => {
      if (route.request().method() === 'PUT') {
        expect(route.request().postDataJSON()).toEqual({ path: libraryPath });
        if (error) return route.fulfill({ status: 400, json: { error: '文件夹无法使用，请选择空文件夹或已有素材库' } });
        ready = true;
      }
      return route.fulfill({ contentType: 'application/json',
        body: JSON.stringify(ready ? { path: libraryPath, libraryId: 'setup-test', assetCount: 0, schemaVersion: 1 } : null) });
    });
    const premature: string[] = [];
    await page.route(/\/api\/(?:assets|categories|tags)(?:\?|$)/, route => {
      if (!ready) premature.push(route.request().url());
      return route.fulfill({ json: route.request().url().includes('/assets')
        ? { items: [], total: 0, page: 1, limit: 24, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 } } : [] });
    });
    await page.route('**/api/fs?*', route => {
      const selected = new URL(route.request().url()).searchParams.get('path') === libraryPath;
      return route.fulfill({ json: {
        path: selected ? libraryPath : '', parent: selected ? '' : null, kind: selected ? 'empty' : null, home: 'X:\\',
        entries: selected ? [] : [{ name: 'My Components', path: libraryPath, library: false }],
      } });
    });
    await page.goto('/new');
    await expect(page.getByRole('heading', { name: '选择素材库位置' })).toBeVisible();
    expect(premature).toEqual([]);
    await expect(page.getByRole('button', { name: '打开素材库' })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('setup.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '浏览', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: '浏览', exact: true }).click();
    await page.getByRole('button', { name: 'My Components', exact: true }).click();
    await page.getByRole('button', { name: '使用此文件夹', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: '打开素材库' }).click();
    await expect(page.getByRole('alert')).toContainText('文件夹无法使用');
    await expect(page.getByLabel('素材库文件夹', { exact: true })).toHaveValue(libraryPath);
    error = false;
    await page.getByRole('button', { name: '打开素材库' }).click();
    await expect(page.getByRole('heading', { name: '添加素材' })).toBeVisible();
    await expect(page.getByRole('button', { name: '粘贴代码', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '信息与提示词' }).click();
    await expect(page.getByText('来源名称', { exact: true })).toBeVisible();
    await expect(page.getByText('来源地址', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '添加素材' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '选择素材库位置' })).toHaveCount(0);
  });
}

test('pasting an unbranded HTML snippet keeps editable source fields', async ({ page }) => {
  await page.route('**/api/library', route => route.fulfill({ json: {
    path: 'X:\\Library', libraryId: 'paste-test', assetCount: 0, schemaVersion: 1,
  } }));
  await page.route(/\/api\/(categories|tags)$/, route => route.fulfill({ json: [] }));
  await page.route('**/api/play/draft', route => route.fulfill({ json: { url: '/play/~draft/test' } }));
  await page.route('**/play/~draft/test*', route => route.fulfill({ contentType: 'text/html', body: '<p>Test</p>' }));
  await page.goto('/new');
  await page.getByRole('button', { name: '粘贴代码', exact: true }).click();
  const text = page.getByLabel('HTML 代码或复刻提示词');
  await text.fill('Just a description');
  await page.getByRole('button', { name: '填入表单' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('没有找到 HTML');
  await text.fill('<!doctype html><title>Test Card</title><div>Test</div><style>div{color:red}</style>');
  await page.getByRole('button', { name: '填入表单' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('tab', { name: '信息与提示词' }).click();
  await expect(page.getByLabel('来源名称', { exact: true })).toBeVisible();
  await page.getByLabel('来源名称', { exact: true }).fill('Original author');
  await page.getByLabel('来源地址', { exact: true }).fill('https://example.com/component');
  await expect(page.getByLabel('来源名称', { exact: true })).toHaveValue('Original author');
  await expect(page.locator('body')).not.toContainText('transitions.dev');
});
