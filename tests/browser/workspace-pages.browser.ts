import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const path = 'E:\\CEA-Assets\\Design collections\\' + 'Components and interaction references\\'.repeat(3);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/library', route => route.fulfill({ json: {
    libraryId: 'workspace-fixture', path, schemaVersion: 1, assetCount: 4,
  } }));
  await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
});

for (const width of [1440, 1000, 390]) {
  test(`settings groups stay connected and configuration round-trips at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings');
    await expect(page.locator('.lib-card-main code')).toHaveText(path);
    const columns = await page.locator('.settings-layout > .settings-section').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
    }));
    expect(columns[2].y).toBeGreaterThanOrEqual(columns[1].bottom);
    expect(columns[2].x).toBeCloseTo(columns[1].x, 0);
    const controls = await page.locator('.settings-preferences .choice-control').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return rect.left;
    }));
    expect(controls[0]).toBeCloseTo(controls[1], 0);
    const emphasis = await page.evaluate(() => {
      const title = getComputedStyle(document.querySelector('.workspace-head h1')!);
      const section = getComputedStyle(document.querySelector('.settings-heading h2')!);
      const row = document.querySelector('.settings-preferences .settings-row')!;
      const label = row.querySelector('.settings-row-label')!.getBoundingClientRect();
      const control = row.querySelector('.choice-control')!.getBoundingClientRect();
      return { titleSize: parseFloat(title.fontSize), sectionSize: parseFloat(section.fontSize),
        titleWeight: Number(title.fontWeight), sectionWeight: Number(section.fontWeight), fieldGap: control.left - label.right };
    });
    expect(emphasis.titleSize / emphasis.sectionSize).toBeGreaterThan(1.4);
    expect(emphasis.titleWeight).toBeGreaterThan(emphasis.sectionWeight);
    expect(emphasis.fieldGap).toBeLessThanOrEqual(300);
    const settingsWidth = await page.locator('.settings-layout').evaluate(element => element.getBoundingClientRect().width);
    expect(settingsWidth).toBeLessThanOrEqual(960);
    const sections = await page.locator('.settings-section').evaluateAll(elements => elements.map(element => {
      const heading = element.querySelector('h2')!.getBoundingClientRect();
      const description = element.querySelector('.settings-heading p')!.getBoundingClientRect();
      const content = element.querySelector('.settings-content')!.getBoundingClientRect();
      return { headingX: heading.x, headingRight: heading.right, headingY: heading.y, contentX: content.x, gap: content.y - heading.bottom,
        descriptionX: description.x, descriptionY: description.y, descriptionGap: description.y - heading.bottom };
    }));
    for (const section of sections) {
      expect(section.headingX).toBeCloseTo(section.contentX, 0);
      expect(section.gap).toBeLessThan(80);
      if (section.descriptionX > section.headingRight) expect(Math.abs(section.descriptionY - section.headingY)).toBeLessThan(4);
      else {
        expect(section.descriptionX).toBeCloseTo(section.headingX, 0);
        expect(section.descriptionGap).toBeGreaterThanOrEqual(3);
      }
    }
    await page.getByRole('radiogroup', { name: '默认框架', exact: true }).getByRole('radio', { name: 'Vue', exact: true }).check();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出配置', exact: true }).click();
    const download = await downloadPromise;
    const config = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(config.preferences.framework).toBe('vue');
    config.preferences.framework = 'react';
    await page.locator('input[type=file]').setInputFiles({
      name: 'cea-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)),
    });
    await expect(page.getByRole('dialog', { name: '导入配置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '应用配置', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '导入配置', exact: true })).toBeHidden();
    await expect(page.getByRole('radiogroup', { name: '默认框架', exact: true }).getByRole('radio', { name: 'React', exact: true })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/settings-${width}.png`, fullPage: true });
  });

  test(`transfer keeps import and export controls grouped at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/transfer');
    await expect(page.locator('.workspace-head code')).toHaveText(path);
    const sections = await page.locator('.transfer-layout > .settings-section').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, bottom: box.bottom };
    }));
    if (width > 900) {
      expect(sections[0].y).toBeCloseTo(sections[1].y, 0);
      expect(sections[1].x).toBeGreaterThan(sections[0].x);
    } else expect(sections[1].y).toBeGreaterThanOrEqual(sections[0].bottom);
    const formats = page.getByRole('radiogroup', { name: '导出格式', exact: true });
    await expect(formats.locator('.transfer-format-text small')).toHaveCount(2);
    await formats.getByRole('radio', { name: '完整备份', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(formats.getByRole('radio', { name: '素材文件夹', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: '保存到文件夹', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '选择部分组件', exact: true })).toHaveAttribute('href', '/?select=1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/transfer-${width}.png`, fullPage: true });
    await page.route('**/api/import/preview?*', route => route.fulfill({ json: {
      token: 'preview-fixture', preview: { source: 'folder', assetCount: 1, fileCount: 3, duplicates: [], problems: [],
        items: [{ id: 'fixture', title: 'Imported component', frameworks: ['html'] }] },
    } }));
    await page.locator('input[type=file][accept^=".zip"]').setInputFiles({
      name: 'components.zip', mimeType: 'application/zip', buffer: Buffer.from('mock'),
    });
    await expect(page.getByRole('button', { name: '导入 1 个组件', exact: true })).toBeEnabled();
    await expect(page.locator('.import-items')).toContainText('Imported component');
    await page.getByRole('button', { name: '换一个', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeVisible();
    await page.route('**/api/export', route => route.fulfill({ status: 500, json: { error: '测试导出失败，请重试' } }));
    await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
    await expect(page.locator('.transfer-export').getByRole('alert')).toContainText('测试导出失败');
    await expect(formats.getByRole('radio', { name: '素材文件夹', exact: true })).toBeChecked();
  });
}

for (const width of [1440, 1000, 390]) {
  test(`management routes keep the same shell and organizing stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/tags', route => route.fulfill({ json: Array.from({ length: 1000 }, (_, i) => ({
      name: `Tag ${i}`, count: i % 5, labels: {},
    })) }));
    await page.route('**/api/categories', route => route.fulfill({ json: [
      { id: 'first', name: 'First category', count: 2, sort: 0 },
      { id: 'second', name: 'Second category', count: 2, sort: 1 },
    ] }));
    await page.goto('/organize');
    await expect(page.getByRole('button', { name: '删除所选', exact: true })).toHaveCount(0);
    const shell = () => page.locator('.workspace-head').evaluate(element => {
      const box = element.getBoundingClientRect();
      const title = element.querySelector('h1')!.getBoundingClientRect();
      return { x: box.x, width: box.width, titleY: title.y };
    });
    const initial = await shell();
    const brandX = await page.locator('.brand').evaluate(element => element.getBoundingClientRect().x);
    expect(initial.x).toBeCloseTo(brandX, 0);
    expect(await page.locator('.organize-row').count()).toBeLessThan(30);
    await page.getByRole('textbox', { name: '搜索标签', exact: true }).fill('Tag 999');
    await expect(page.locator('.organize-row')).toHaveCount(1);
    await page.getByRole('checkbox', { name: '选择 Tag 999', exact: true }).check();
    await expect(page.getByRole('button', { name: '删除所选', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '重命名 Tag 999', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '重命名', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('tab', { name: '分类 2', exact: true }).click();
    await expect(page.locator('.organize-row')).toHaveCount(2);
    expect(await page.locator('.organize-list').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    await page.getByRole('button', { name: '新建分类', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建分类', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建分类', exact: true })).toBeHidden();
    await page.screenshot({ path: `test-results/organize-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const name of ['导入导出', '设置']) {
      await page.locator('.topnav').getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
      await expect.poll(shell).toEqual(initial);
    }
  });
}
