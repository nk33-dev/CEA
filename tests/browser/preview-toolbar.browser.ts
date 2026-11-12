import { test, expect, type Page } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

const asset: AssetDetail = {
  id: 'toolbar-fixture', title: 'Preview controls', type: 'component', categoryId: null, tags: [],
  sourceName: '', sourceUrl: '', favorite: false, cover: null, media: [], frameworks: ['html'], locales: ['en'],
  createdAt: '2026-01-01', updatedAt: '2026-01-01', texts: { en: { summary: '', idea: '' } },
  variants: [{ framework: 'html', entry: 'markup.html', dependencies: {},
    files: [
      { path: 'markup.html', content: '<main><button id="counter">Count 0</button><section><div>One</div><div>Two</div><div>Three</div></section></main>' },
      { path: 'style.css', content: 'main{width:1100px;max-width:100%;height:820px;background:#eff4f8;color:#20252b;padding:24px;box-sizing:border-box}section{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:24px}section div{height:200px;background:#fff;border:1px solid #dae2ea;border-radius:6px;padding:16px}' },
      { path: 'script.js', content: "let n=0;document.querySelector('#counter').onclick=e=>e.target.textContent='Count '+(++n);" },
    ] }],
};

async function open(page: Page, editor = false) {
  await page.addInitScript(() => localStorage.setItem('cea:framework', 'html'));
  await page.route('**/api/assets/toolbar-fixture', route => route.fulfill({ json: asset }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage(asset.title, asset.variants[0].files) }));
  await page.route('**/api/play/draft', route => route.fulfill({ json: { url: '/play/~draft/toolbar' } }));
  await page.goto(`/a/toolbar-fixture${editor ? '/edit' : ''}`);
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.locator('iframe').evaluate(el => el.setAttribute('data-session', 'retained'));
}

for (const editor of [false, true]) {
  test(`${editor ? 'editor' : 'detail'} zoom commits once and fullscreen fills the screen with explicitly opened tools`, async ({ page }, info) => {
    await open(page, editor);
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    const stage = page.locator('.device-stage');
    const scale = () => stage.evaluate(el => new DOMMatrix((el as HTMLElement).style.transform).a);
    const fitted = await scale();
    await zoom.click();
    await page.getByRole('button', { name: '回到中央', exact: true }).click();
    expect(await scale()).toBeCloseTo(fitted, 4);
    await zoom.fill('110');
    expect(await scale()).toBeCloseTo(fitted, 4);
    await zoom.press('Enter');
    await expect.poll(scale).toBeCloseTo(1.1, 4);
    await zoom.fill('80');
    await zoom.press('Escape');
    await expect(zoom).toHaveValue('110');
    expect(await scale()).toBeCloseTo(1.1, 4);
    await zoom.fill('');
    await zoom.press('Tab');
    await expect(zoom).toHaveValue('110');
    await page.locator('.zoom-control').hover();
    await page.getByRole('combobox', { name: '缩放预设', exact: true }).click();
    await page.getByRole('option', { name: '75%', exact: true }).click();
    await expect.poll(scale).toBe(.75);
    const frame = page.frameLocator('iframe');
    const size = await frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.getByRole('button', { name: '全屏预览', exact: true }).click();
    await expect(page.locator('.fullscreen-frame')).toHaveClass(/is-active/);
    const fullscreenSize = page.viewportSize()!;
    await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(fullscreenSize);
    await expect(page.locator('.panel-subbar')).toBeHidden();
    await page.locator('.device-preview').hover();
    await expect(page.locator('.panel-subbar')).toBeHidden();
    await frame.getByRole('button', { name: 'Count 0', exact: true }).click();
    await expect(frame.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '展开预览工具', exact: true }).click();
    await expect(zoom).toHaveValue('100');
    expect(await scale()).toBe(1);
    await page.locator('.zoom-control').hover();
    await page.getByRole('combobox', { name: '缩放预设', exact: true }).click();
    const option = page.getByRole('option', { name: '100%', exact: true });
    await expect(option).toBeVisible();
    expect(await option.evaluate(el => !!document.fullscreenElement?.contains(el))).toBe(true);
    await option.click();
    await expect.poll(scale).toBe(1);
    await expect(page.getByRole('button', { name: '回到中央', exact: true })).toBeVisible();
    await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(fullscreenSize);
    await page.getByRole('button', { name: '收起预览工具', exact: true }).click();
    await page.screenshot({ path: info.outputPath('fullscreen.png') });
    await page.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect(page.locator('.fullscreen-frame')).not.toHaveClass(/is-active/);
    await expect.poll(scale).toBe(.75);
    await expect(zoom).toHaveValue('75');
    await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size);
    await expect(page.locator('iframe')).toHaveAttribute('data-session', 'retained');
    await page.locator('.panel-preview').screenshot({ path: info.outputPath('toolbar.png') });
  });
}

for (const width of [1440, 1000, 390]) {
  test(`preview tools stay visible and separated at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page);
    for (const mode of ['组件', '电脑', '手机']) {
      await page.getByRole('radio', { name: mode, exact: true }).check();
      const tools = page.locator('.panel-subbar');
      await expect(page.getByRole('button', { name: '全屏预览', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '完整显示', exact: true })).toHaveText('适应');
      const outside = await tools.evaluate(el => {
        const host = el.getBoundingClientRect();
        return [...el.querySelectorAll('button,input:not([type=radio])')].filter(child => {
          const rect = child.getBoundingClientRect();
          return rect.width > 1 && (rect.left < host.left - 1 || rect.right > host.right + 1);
        }).map(el => el.getAttribute('aria-label'));
      });
      expect(outside).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.locator('.panel-preview').screenshot({ path: info.outputPath(`${mode}.png`) });
    }
  });
}

test('fullscreen fallback exits and retains the iframe', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('No fullscreen in this host'));
  });
  await open(page);
  await page.getByRole('button', { name: '全屏预览', exact: true }).click();
  await expect(page.locator('.fullscreen-frame')).toHaveClass(/is-active/);
  await expect.poll(() => page.locator('.fullscreen-frame').evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await page.getByRole('button', { name: '展开预览工具', exact: true }).click();
  await page.locator('.zoom-control').hover();
  await page.getByRole('combobox', { name: '缩放预设', exact: true }).click();
  const preset = page.getByRole('option', { name: '75%', exact: true });
  expect(await preset.evaluate(el => !!el.closest('.fullscreen-frame'))).toBe(true);
  await preset.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fullscreen-frame')).not.toHaveClass(/is-active/);
  await expect(page.getByRole('button', { name: '全屏预览', exact: true })).toBeFocused();
  await expect(page.locator('iframe')).toHaveAttribute('data-session', 'retained');
  await page.getByRole('button', { name: '全屏预览', exact: true }).click();
  await page.frameLocator('iframe').getByRole('button', { name: 'Count 0', exact: true }).press('Escape');
  await expect(page.locator('.fullscreen-frame')).not.toHaveClass(/is-active/);
});

test('zoom presets use the percent symbol and cannot overlap the zoom buttons', async ({ page }) => {
  await open(page);
  const arrow = page.getByRole('combobox', { name: '缩放预设', exact: true });
  await page.mouse.move(0, 0);
  await expect(arrow.locator('.cea-select-chevron')).toHaveCSS('display', 'none');
  const presetBox = (await arrow.boundingBox())!;
  const plus = page.getByRole('button', { name: '放大预览', exact: true });
  const plusBox = (await plus.boundingBox())!;
  expect(plusBox.x - presetBox.x - presetBox.width).toBeGreaterThanOrEqual(8);
  for (let i = 0; i < 4; i++) await plus.click({ position: { x: 2, y: plusBox.height / 2 } });
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.locator('.zoom-control').hover();
  await arrow.click();
  await page.getByRole('option', { name: '125%', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '缩放比例', exact: true })).toHaveValue('125');
  await expect(arrow).toBeFocused();
});

test.describe('touch toolbar', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('touch targets fit without clipping', async ({ page }, info) => {
    await open(page);
    const tools = page.locator('.panel-subbar');
    const boxes = await tools.locator('button').evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      const host = el.closest('.panel-subbar')!.getBoundingClientRect();
      return { width: rect.width, height: rect.height, inside: rect.left >= host.left && rect.right <= host.right + 1 };
    }));
    expect(boxes.filter(box => box.width > 0).every(box => box.inside && box.height >= 32)).toBe(true);
    await tools.screenshot({ path: info.outputPath('touch-tools.png') });
  });
});

test('a genuinely long document scrolls with the wheel even at 30% display scale', async ({ page }) => {
  await open(page);
  const frame = page.frameLocator('iframe');
  await frame.locator('main').evaluate(el => { (el as HTMLElement).style.height = '1600px'; });
  await expect.poll(() => page.locator('.device-stage').evaluate(el => parseFloat((el as HTMLElement).style.height))).toBeGreaterThan(820);
  const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
  await zoom.fill('30');
  await zoom.press('Enter');
  await expect(frame.locator('html')).not.toHaveCSS('overflow-y', 'clip');
  const transform = () => page.locator('.device-stage').evaluate(el => {
    const matrix = new DOMMatrix((el as HTMLElement).style.transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a };
  });
  const before = await transform();
  const pageScroll = await page.evaluate(() => scrollY);
  await frame.locator('main').hover({ position: { x: 80, y: 90 } });
  await page.mouse.wheel(0, 240);
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBeGreaterThan(0);
  const after = await transform();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.scale).toBe(before.scale);
  expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
  await frame.locator('html').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bottom = await frame.locator('html').evaluate(() => scrollY);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBeLessThan(bottom);
});
