import { test, expect } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

test.use({ channel: 'chrome' });

const fixture: AssetDetail = {
  id: 'prompt-fixture', title: 'Prompt Fixture', type: 'component', categoryId: null,
  tags: [], favorite: false, cover: null, sourceUrl: '', sourceName: '',
  frameworks: ['html'], locales: ['zh', 'en'], createdAt: '2026-01-01', updatedAt: '2026-01-01',
  texts: {
    zh: { summary: '', idea: '像终端字符流一样的浅色背景，点击时粒子散开。' },
    en: { summary: '', idea: 'A light terminal-glyph background with local particle impulses.' },
  },
  media: [],
  variants: [{
    framework: 'html', entry: 'markup.html', dependencies: {},
    theme: { version: 1, mode: 'light', default: 'light' },
    files: [
      { path: 'markup.html', content: '<div class="fixture">Particle background<button data-demo-only>Preview settings</button></div>' },
      { path: 'style.css', content: '.fixture{width:240px;height:120px;background:#f7f8fa;color:#2563eb}' },
      { path: 'script.js', content: 'document.querySelector(".fixture").dataset.ready="true";' },
    ],
  }],
};

for (const width of [1440, 390]) {
  test(`idea and replica copy the displayed theme request with the right code contract at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('cea:locale', 'zh');
      localStorage.setItem('cea:framework', 'html');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => { (window as unknown as { copiedText: string }).copiedText = text; } },
      });
    });
    await page.route('**/api/library', route => route.fulfill({ json: { libraryId: 'fixture', path: 'fixture', assetCount: 1 } }));
    await page.route(/\/api\/(tags|categories)$/, route => route.fulfill({ json: [] }));
    await page.route('**/api/assets/prompt-fixture', route => route.fulfill({ json: fixture }));
    await page.route('**/play/prompt-fixture/**', route => route.fulfill({
      contentType: 'text/html',
      body: htmlPlayPage('Fixture', fixture.variants[0].files, { theme: fixture.variants[0].theme! }),
    }));
    await page.goto('/a/prompt-fixture');
    await page.getByRole('tab', { name: '思路', exact: true }).click();
    const toolbarLayout = () => page.locator('.reuse-top').evaluate(element => {
      const bar = element.getBoundingClientRect();
      const palette = element.querySelector('[role=combobox]')!.getBoundingClientRect();
      const copy = element.querySelector('button.reuse-copy')!.getBoundingClientRect();
      return { height: bar.height, right: bar.right, paletteRight: palette.right, copyLeft: copy.left, copyRight: copy.right, deltaY: Math.abs(palette.y + palette.height / 2 - copy.y - copy.height / 2) };
    });
    const before = await toolbarLayout();
    expect(before.height).toBeLessThanOrEqual(40);
    expect(before.deltaY).toBeLessThan(1);
    expect(before.paletteRight).toBeLessThanOrEqual(before.copyLeft);
    expect(before.copyRight).toBeLessThanOrEqual(before.right);
    await page.getByRole('combobox', { name: 'AI 配色目标' }).click();
    await page.getByRole('option', { name: '深色', exact: true }).click();
    const idea = page.getByLabel('思路内容', { exact: true });
    await expect(idea).toContainText('配色：只做深色');
    await expect(idea).not.toContainText('参考代码');
    await expect(idea).not.toContainText('CSS');
    await expect(idea).not.toContainText('data-demo-only');
    await expect(idea).not.toContainText('演示控件');
    await page.getByRole('button', { name: '复制思路', exact: true }).click();
    const copied = () => page.evaluate(() => (window as unknown as { copiedText: string }).copiedText);
    expect(await copied()).toBe(await idea.textContent());
    await page.locator('.panel-reuse').screenshot({ path: `test-results/reuse-idea-${width}.png` });
    await page.getByRole('tab', { name: '复刻', exact: true }).click();
    const after = await toolbarLayout();
    expect(after.height).toBe(before.height);
    expect(after.paletteRight).toBeCloseTo(before.paletteRight, 0);
    expect(after.copyRight).toBeCloseTo(before.copyRight, 0);
    await page.getByRole('button', { name: '复制提示词', exact: true }).click();
    expect(await copied()).toContain('参考代码是浅色');
    expect(await copied()).toContain('data-demo-only 标记的控件仅用于素材预览演示');
    expect(await copied()).toContain('完整保留所有业务状态、强度档位及对应的渲染逻辑、动效和业务交互');
    for (const file of fixture.variants[0].files) expect(await copied()).toContain(file.content);
  });
}
