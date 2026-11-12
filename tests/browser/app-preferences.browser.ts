import { expect, test } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

test('CEA language and dark mode leave content preferences and preview identity unchanged', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/');
  const first = page.locator('.card').first();
  await expect(first.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const before = await first.locator('iframe').getAttribute('src');
  await page.getByRole('radio', { name: '深色界面', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  const language = page.getByRole('combobox', { name: '界面语言', exact: true });
  await language.click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Organize', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search components', exact: true })).toBeVisible();
  expect(await first.locator('iframe').getAttribute('src')).toBe(before);
  expect(await page.evaluate(() => localStorage.getItem('cea:locale'))).toBe('zh');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/cea-dark-en.png', fullPage: true });
});

test('organize exposes translations, missing names and component links without hover', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/organize');
  await expect(page.getByText('名称与中英译名').first()).toBeVisible();
  await expect(page.locator('.organize-translations [data-missing]').first()).toBeVisible();
  await page.getByRole('button', { name: '编辑译名 动效', exact: true }).click();
  await page.getByRole('textbox', { name: '中文译名', exact: true }).fill('动效');
  await page.getByRole('textbox', { name: '英文译名', exact: true }).fill('Motion');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.organize-translations').filter({ hasText: 'Motion' })).toBeVisible();
  await page.getByRole('link', { name: '查看 动效 的组件', exact: true }).click();
  await expect(page).toHaveURL(/tags=/);
});

test('UI language updates not-found content and translated deletion titles', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/missing');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Organize', exact: true }).click();
  await page.getByRole('button', { name: 'Delete 动效', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete 1 tags?', exact: true })).toBeVisible();
});

test('English CEA controls preserve user category names and fit a narrow header', async ({ page }) => {
  const demo = await mockLibrary(page);
  await page.route('**/api/categories', route => route.fulfill({ json: [{ id: 'named-settings', name: '设置', count: 3 }] }));
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem('cea:ui:locale', 'en'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?select=1');
  const brand = await page.locator('.brand').boundingBox();
  const preferences = await page.locator('.app-preferences').boundingBox();
  expect(Math.abs(brand!.y + brand!.height / 2 - preferences!.y - preferences!.height / 2)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Select page', exact: true }).click();
  await page.getByRole('button', { name: 'Move to category', exact: true }).click();
  await page.getByRole('combobox', { name: 'Move to category', exact: true }).click();
  await expect(page.getByRole('option', { name: '设置', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(demo.writes).toEqual([]);
});
