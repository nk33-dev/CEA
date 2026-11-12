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
