import { test, expect } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

const asset: AssetDetail = {
  id: 'studio-fixture', title: 'Studio Fixture', type: 'component', categoryId: null,
  tags: [], favorite: false, cover: null, sourceUrl: '', sourceName: '',
  frameworks: ['html'], locales: ['zh'], createdAt: '2026-01-01', updatedAt: '2026-01-01',
  texts: { zh: { summary: '一张浅色组件。', idea: '做一个带按钮的浅色卡片。' } }, media: [],
  variants: [{
    framework: 'html', entry: 'markup.html', dependencies: {},
    theme: { version: 1, mode: 'light', default: 'light' },
    files: [{ path: 'markup.html', content: '<section class="fixture">Original component</section>' },
      { path: 'style.css', content: '.fixture{width:300px;height:180px;background:white;color:#111}' },
      { path: 'script.js', content: '' }],
  }],
};

test('component inspection uses content bounds while device modes preserve real viewport and the iframe', async ({ page }) => {
  await page.route('**/api/assets/studio-fixture', route => route.fulfill({ json: asset }));
  await page.route('**/play/studio-fixture/**', route => route.fulfill({
    contentType: 'text/html', body: htmlPlayPage('Fixture', asset.variants[0].files, { theme: asset.variants[0].theme! }),
  }));
  await page.goto('/a/studio-fixture');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('radio', { name: '组件', exact: true })).toBeChecked();
  const frame = page.locator('iframe');
  await frame.evaluate(element => element.setAttribute('data-session', 'preserved'));
  const subject = page.frameLocator('iframe').locator('.fixture');
  await expect(subject).toHaveCSS('width', '300px');
  const contentScale = await page.locator('.device-stage').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
  expect(contentScale).toBe(1);
  await expect(page.locator('.device-titlebar')).toHaveCount(0);
  await page.getByRole('radio', { name: '电脑', exact: true }).check();
  await expect(page.locator('.device-screen')).toHaveCSS('width', '1440px');
  await expect(page.locator('.device-titlebar')).toBeVisible();
  await page.getByRole('radio', { name: '手机', exact: true }).check();
  await expect(page.locator('.device-screen')).toHaveCSS('width', '390px');
  await page.getByRole('radio', { name: '组件', exact: true }).check();
  await expect(frame).toHaveAttribute('data-session', 'preserved');
  await expect(page.locator('.device-preview')).toHaveClass(/is-content/);
});

test('a preview response without the playback runtime remains visible in component view', async ({ page }) => {
  await page.route('**/api/assets/studio-fixture', route => route.fulfill({ json: asset }));
  await page.route('**/play/studio-fixture/**', route => route.fulfill({
    contentType: 'text/html', body: '<p>Preview could not be compiled</p>',
  }));
  await page.goto('/a/studio-fixture');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.device-stage')).toHaveCSS('opacity', '1');
  await expect(page.frameLocator('iframe').getByText('Preview could not be compiled')).toBeVisible();
});

test('fixed preview, stage background and AI target are independent and source stays intact', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cea:locale', 'zh');
    localStorage.setItem('cea:framework', 'html');
    localStorage.setItem('cea:theme', 'light');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
      (window as unknown as { copied: string }).copied = text;
    } } });
  });
  await page.route('**/api/assets/studio-fixture', route => route.fulfill({ json: asset }));
  await page.route('**/play/studio-fixture/**', route => route.fulfill({
    contentType: 'text/html', body: htmlPlayPage('Fixture', asset.variants[0].files, { theme: asset.variants[0].theme! }),
  }));
  await page.goto('/a/studio-fixture');
  await expect(page.getByRole('radiogroup', { name: '组件主题' })).toHaveCount(0);
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const before = await page.locator('iframe').getAttribute('src');
  await page.getByRole('combobox', { name: 'AI 配色目标' }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '复制提示词', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('配色：只做深色');
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('background:white');
  await expect(page.locator('.preview-well')).not.toHaveClass(/theme-dark/);
  await page.getByRole('radiogroup', { name: '舞台背景' }).getByRole('radio', { name: '深色', exact: true }).check();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('html')).toHaveAttribute('data-background', 'dark');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(frame.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(frame.locator('body')).toHaveCSS('color-scheme', 'light');
  expect(await frame.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--stage-bg').trim())).toBe('#f7f7f8');
  expect(await page.locator('iframe').getAttribute('src')).toBe(before);
  await page.getByRole('tab', { name: '源码', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'AI 配色目标' })).toHaveCount(0);
  await page.getByRole('button', { name: '复制源码', exact: true }).click();
  const source = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(source).toContain('background:white');
  expect(source).not.toContain('配色：只做深色');
});

for (const height of [640, 720, 900]) {
  test(`detail uses natural content flow without a viewport-height filler at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height });
    await page.goto('/a/glyph-flow-background');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const layout = await page.evaluate(() => ({
      studio: document.querySelector('.studio')!.getBoundingClientRect().bottom,
      preview: document.querySelector('.preview-well')!.getBoundingClientRect().height,
      panels: [...document.querySelectorAll('.studio-body > .panel')].map(element => element.getBoundingClientRect().bottom),
    }));
    expect(layout.preview).toBeGreaterThanOrEqual(360);
    expect(layout.preview).toBeLessThanOrEqual(640);
    expect(Math.max(...layout.panels) - Math.min(...layout.panels)).toBeLessThan(1);
    expect(layout.studio - Math.max(...layout.panels)).toBeCloseTo(24, 0);
    if (height === 640) expect(Math.max(...layout.panels)).toBeGreaterThan(height);
    await page.screenshot({ path: `test-results/studio-${height}.png` });
  });
}

test('code is readable before the highlighting worker responds and copying keeps the full source', async ({ page }) => {
  const large = structuredClone(asset);
  large.variants[0].files[2].content = '/* vendored */\n' + 'window.libraryValue=1;'.repeat(12000) + '\n// COMPLETE_SOURCE_TAIL';
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
    (window as unknown as { copied: string }).copied = text;
  } } }));
  await page.route('**/api/assets/studio-fixture', route => route.fulfill({ json: large }));
  await page.route('**/play/studio-fixture/**', route => route.fulfill({
    contentType: 'text/html', body: htmlPlayPage('Fixture', asset.variants[0].files, { theme: asset.variants[0].theme! }),
  }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/highlight\.worker.*\.js/, async route => { await gate; await route.continue(); });
  await page.goto('/a/studio-fixture');
  const code = page.locator('.code-viewport');
  await expect(code).toContainText('Original component');
  await expect(page.getByText('正在整理代码…')).toHaveCount(0);
  await page.getByRole('button', { name: '复制提示词', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('COMPLETE_SOURCE_TAIL');
  release();
  await expect(code).not.toHaveAttribute('aria-busy', 'true');
});

test('real heatmap remains readable and separate detail panels share top and bottom alignment', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cea:locale', 'zh');
    localStorage.setItem('cea:framework', 'html');
  });
  await page.goto('/a/leetcode-heatmap');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const preview = page.locator('.device-preview');
  await expect(page.locator('.device-stage')).toHaveCSS('opacity', '1');
  await expect(page.frameLocator('iframe').locator('.hm')).toBeVisible();
  const layout = await page.locator('.studio-body').evaluate(element => {
    const panels = [...element.querySelectorAll(':scope > .panel')].map(panel => panel.getBoundingClientRect());
    return { top: panels[0].top - panels[1].top, bottom: panels[0].bottom - panels[1].bottom, gap: panels[1].left - panels[0].right };
  });
  expect(Math.abs(layout.top)).toBeLessThan(1);
  expect(Math.abs(layout.bottom)).toBeLessThan(1);
  expect(layout.gap).toBeGreaterThanOrEqual(12);
  for (const name of ['源码', '思路', '复刻']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(preview).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/heatmap-workbench.png', fullPage: true });
});

for (const width of [1440, 1100, 390]) {
  test(`editor file navigation stays compact and settings remain available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/a/glyph-flow-background/edit');
    await expect(page.getByRole('combobox', { name: '代码文件', exact: true })).toBeVisible();
    await page.locator('.editor-preview').scrollIntoViewIfNeeded();
    await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.code-editor')).toHaveCSS('background-color', 'rgb(247, 247, 248)');
    const nav = await page.locator('.file-tabs').boundingBox();
    expect(nav!.height).toBeLessThan(60);
    await expect(page.getByRole('combobox', { name: '组件配色', exact: true })).not.toBeVisible();
    await page.getByText('实现设置', { exact: true }).click();
    await expect(page.getByRole('combobox', { name: '组件配色', exact: true })).toBeVisible();
    await page.getByText('实现设置', { exact: true }).click();
    await page.getByRole('combobox', { name: '代码文件', exact: true }).click();
    await page.getByRole('option', { name: 'Styles', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '编辑 style.css' })).toBeVisible();
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(layout.content).toBeLessThanOrEqual(layout.viewport);
    const tabs = page.getByRole('tablist', { name: '编辑内容', exact: true });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(page.locator('.editor-info')).toBeHidden();
    await page.locator('iframe').evaluate(element => { element.setAttribute('data-session', 'preserved'); });
    const transform = await page.locator('.device-stage').evaluate(element => getComputedStyle(element).transform);
    const source = await page.locator('.code-editor').inputValue();
    await tabs.getByRole('tab', { name: '信息与提示词', exact: true }).click();
    await expect(page.locator('.editor-work')).toBeHidden();
    await expect(page.getByRole('textbox', { name: '默认名称', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: '简介', exact: true }).fill('Metadata draft preserved across tabs');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/editor-info-${width}.png` });
    await tabs.getByRole('tab', { name: '代码与预览', exact: true }).click();
    await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
    const transforms = await page.locator('.device-stage').evaluate(async element => {
      const values = [];
      for (let i = 0; i < 8; i++) {
        values.push(getComputedStyle(element).transform);
        await new Promise(requestAnimationFrame);
      }
      return values;
    });
    expect(new Set(transforms)).toEqual(new Set([transform]));
    await expect(page.locator('.code-editor')).toHaveValue(source);
    await expect(page.locator('.editor-info')).toBeHidden();
    await tabs.getByRole('tab', { name: '信息与提示词', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '简介', exact: true })).toHaveValue('Metadata draft preserved across tabs');
    await tabs.getByRole('tab', { name: '信息与提示词', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: '代码与预览', exact: true })).toBeFocused();
    await expect(page.locator('.editor-work')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/editor-${width}.png` });
  });
}

test('preview appearance is temporary and independent of website and content preferences', async ({ page }) => {
  const dual = structuredClone(asset);
  dual.variants[0].theme = { version: 1, mode: 'both', default: 'dark' };
  await page.addInitScript(() => {
    localStorage.setItem('cea:locale', 'zh');
    localStorage.setItem('cea:framework', 'html');
    localStorage.setItem('cea:theme', 'dark');
    localStorage.setItem('cea:component-theme', 'light');
    localStorage.setItem('cea:ui:theme', 'system');
    localStorage.setItem('cea:ui:locale', 'fr');
  });
  await page.route('**/api/assets/studio-fixture', route => route.fulfill({ json: dual }));
  await page.route(/\/api\/assets\?/, route => route.fulfill({ json: {
    items: [{ ...dual, summaries: {}, titles: {}, searchText: '' }], total: 1, page: 1, limit: 24,
    facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
  } }));
  await page.route('**/play/studio-fixture/**', route => route.fulfill({
    contentType: 'text/html', body: htmlPlayPage('Fixture', dual.variants[0].files, { theme: dual.variants[0].theme! }),
  }));
  await page.goto('/a/studio-fixture');
  const frame = page.frameLocator('iframe');
  const themes = page.getByRole('radiogroup', { name: '组件主题' });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.preview-well')).not.toHaveClass(/theme-dark/);
  await themes.getByRole('radio', { name: '浅色', exact: true }).check();
  await page.getByRole('radiogroup', { name: '舞台背景' }).getByRole('radio', { name: '深色', exact: true }).check();
  await expect(frame.locator('html')).toHaveAttribute('data-background', 'dark');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.locator('.card-stage').first()).toBeVisible();
  await expect(page.locator('.card-stage.theme-dark')).toHaveCount(0);
  await expect(page.locator('.card iframe').first()).toBeAttached();
  await expect(page.locator('.card').first().frameLocator('iframe').locator('html')).toHaveAttribute('data-background', 'light');
  await page.locator('.card-meta[href="/a/studio-fixture"]').click();
  await expect(frame.locator('html')).toHaveAttribute('data-background', 'light');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: '编辑', exact: true }).click();
  await expect(page.locator('.editor-preview .stage-host')).toHaveAttribute('aria-busy', 'false');
  await expect(themes.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
  await expect(page.locator('.preview-well')).not.toHaveClass(/theme-dark/);
  await page.getByRole('radiogroup', { name: '舞台背景' }).getByRole('radio', { name: '深色', exact: true }).check();
  await expect(page.locator('.preview-well')).toHaveClass(/theme-dark/);
  await page.getByRole('link', { name: '取消', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-background', 'light');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => ({
    theme: localStorage.getItem('cea:ui:theme'), ui: localStorage.getItem('cea:ui:locale'),
    content: localStorage.getItem('cea:locale'), legacy: localStorage.getItem('cea:theme'),
    legacyComponent: localStorage.getItem('cea:component-theme'),
  }))).toEqual({ theme: 'system', ui: 'fr', content: 'zh', legacy: 'dark', legacyComponent: 'light' });
});

test('saving reveals and focuses invalid fields in the information tab', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/assets/studio-fixture', route => {
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 500 }); }
    return route.fulfill({ json: asset });
  });
  await page.goto('/a/studio-fixture/edit');
  const tabs = page.getByRole('tablist', { name: '编辑内容', exact: true });
  await tabs.getByRole('tab', { name: '信息与提示词', exact: true }).click();
  const title = page.getByRole('textbox', { name: '默认名称', exact: true });
  await title.fill('');
  await tabs.getByRole('tab', { name: '代码与预览', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: '信息与提示词', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(title).toBeFocused();
  await title.fill('Valid title');
  const url = page.getByRole('textbox', { name: '来源地址', exact: true });
  await url.fill('invalid-url');
  await tabs.getByRole('tab', { name: '代码与预览', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(url).toBeFocused();
  expect(writes).toBe(0);
});
