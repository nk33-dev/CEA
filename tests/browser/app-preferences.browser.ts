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
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await page.getByRole('radiogroup', { name: '界面语言', exact: true }).getByRole('radio', { name: 'English', exact: true }).check();
  await page.keyboard.press('Escape');
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
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await page.getByRole('radiogroup', { name: '界面语言', exact: true }).getByRole('radio', { name: 'English', exact: true }).check();
  await page.keyboard.press('Escape');
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

for (const width of [1440, 800, 390]) {
  test(`language controls distinguish interface and content scope at ${width}px`, async ({ page }) => {
    const demo = await mockLibrary(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const first = page.locator('.card').first();
    await expect(first.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
    await first.locator('iframe').evaluate(frame => frame.setAttribute('data-retained', 'true'));
    await expect(page.locator('.results-bar [role=combobox]')).toHaveCount(0);
    await expect(page.locator('.filter-results [role=radiogroup]')).toHaveCount(0);
    await page.getByRole('button', { name: '语言', exact: true }).click();
    const content = page.getByRole('radiogroup', { name: '内容语言', exact: true });
    const menuRows = await page.locator('.app-language-section').evaluateAll(elements => {
      return elements.map(element => {
        const heading = element.querySelector('h2')!.getBoundingClientRect();
        const control = element.querySelector('[role=radiogroup]')!.getBoundingClientRect();
        return { aligned: Math.abs(heading.y + heading.height / 2 - control.y - control.height / 2) < 1, height: control.height };
      });
    });
    expect(menuRows).toHaveLength(2);
    expect(menuRows.every(row => row.aligned && row.height <= 40)).toBe(true);
    const choices = await page.locator('.app-language-section').evaluateAll(elements =>
      elements.map(element => [...element.querySelectorAll('.choice-option > span')].map(span => span.textContent)));
    expect(choices[0]).toEqual(choices[1]);
    await content.getByRole('radio', { name: 'English', exact: true }).check();
    expect(await page.evaluate(() => localStorage.getItem('cea:locale'))).toBe('en');
    await expect(page.getByRole('link', { name: '整理', exact: true })).toBeVisible();
    await expect(first.locator('iframe')).toHaveAttribute('data-retained', 'true');

    const interfaceLanguage = page.getByRole('radiogroup', { name: '界面语言', exact: true });
    await interfaceLanguage.getByRole('radio', { name: 'English', exact: true }).check();
    await expect(page.getByRole('link', { name: 'Organize', exact: true })).toBeVisible();
    const translated = page.getByRole('radiogroup', { name: 'Content language', exact: true });
    await expect(translated).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cea:locale'))).toBe('en');
    await expect(first.locator('iframe')).toHaveAttribute('data-retained', 'true');
    await expect(translated.getByRole('radio', { name: 'English', exact: true })).toBeChecked();
    await translated.getByRole('radio', { name: '中文', exact: true }).check();
    await expect(page.getByRole('link', { name: 'Organize', exact: true })).toBeVisible();
    const panel = (await page.getByRole('dialog', { name: 'Language', exact: true }).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(12);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width - 12);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Language', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Language', exact: true }).click();
    await expect(page.getByRole('radiogroup', { name: 'Content language', exact: true }).getByRole('radio', { name: '中文', exact: true })).toBeChecked();
    await page.getByRole('searchbox', { name: 'Search components', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Language', exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Dark interface', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
    const geometry = await page.locator('.filter-results').evaluate(element => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      controls: [...element.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, right: rect.right, width: rect.width, height: rect.height };
      }),
    }));
    expect(geometry.overflow).toBe(false);
    for (const rect of geometry.controls) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
      expect(rect.height).toBeGreaterThanOrEqual(32);
    }
    expect(demo.writes).toEqual([]);
  });
}

test('additional content locales stay selectable within the compact language panel', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: '搜索组件', exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('cea:locale', 'fr-CA');
    window.dispatchEvent(new Event('cea:pref'));
  });
  await page.getByRole('button', { name: '语言', exact: true }).click();
  const content = page.getByRole('combobox', { name: '内容语言', exact: true });
  await expect(content).toBeVisible();
  await content.click();
  await expect(page.getByRole('option', { selected: true })).toContainText('法语');
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '语言', exact: true })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '内容语言', exact: true }).getByRole('radio', { name: 'English', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '语言', exact: true })).toBeFocused();
});

test('touch language choices retain comfortable targets without widening the page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await mockLibrary(page);
    await page.goto(process.env.CEA_TEST_URL ?? 'http://127.0.0.1:5180');
    await page.getByRole('button', { name: '语言', exact: true }).click();
    const heights = await page.locator('.app-language-section .choice-option').evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().height));
    expect(heights).toHaveLength(4);
    expect(heights.every(height => height >= 44)).toBe(true);
    const panel = (await page.getByRole('dialog', { name: '语言', exact: true }).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(12);
    expect(panel.x + panel.width).toBeLessThanOrEqual(378);
  } finally {
    await context.close();
  }
});
