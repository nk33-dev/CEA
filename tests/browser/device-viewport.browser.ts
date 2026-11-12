import { test, expect, type Page } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

const asset: AssetDetail = {
  id: 'viewport-device', title: 'Viewport device', type: 'component', categoryId: null,
  tags: [], favorite: false, cover: null, sourceUrl: '', sourceName: '', frameworks: ['html'], locales: ['en'],
  createdAt: '2026-01-01', updatedAt: '2026-01-01', texts: { en: { summary: '', idea: '' } }, media: [],
  variants: [{
    framework: 'html', entry: 'markup.html', dependencies: {},
    files: [
      { path: 'markup.html', content: '<main><div class="units"></div><section class="grid"><div>One</div><div>Two</div></section><button id="bottom">Bottom control</button></main>' },
      { path: 'style.css', content: 'main{width:100%;min-height:1800px;background:#eef3fa;position:relative}.units{width:50vw;height:50vh}.grid{display:grid;grid-template-columns:1fr 1fr}@media(max-width:600px){.grid{grid-template-columns:1fr}}#bottom{position:absolute;bottom:20px;left:20px}' },
      { path: 'script.js', content: "document.querySelector('button').onclick=e=>e.target.textContent='Clicked';" },
    ],
  }],
};
const playback = htmlPlayPage(asset.title, asset.variants[0].files);

function viewportSnapshot() {
  const units = document.querySelector('.units')!.getBoundingClientRect();
  return {
    width: innerWidth, height: innerHeight, units: { width: units.width, height: units.height },
    columns: getComputedStyle(document.querySelector('.grid')!).gridTemplateColumns,
    landscape: matchMedia('(orientation: landscape)').matches,
  };
}

async function openFixture(page: Page, editor = false) {
  await page.route('**/api/assets/viewport-device', route => route.fulfill({ json: asset }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
  await page.route('**/api/play/draft', route => route.fulfill({ json: { url: '/play/~draft/html/viewport-device' } }));
  await page.goto(`/a/viewport-device${editor ? '/edit' : ''}`);
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  await page.locator('iframe').evaluate(element => element.setAttribute('data-session', 'preserved'));
}

for (const editor of [false, true]) {
  test(`${editor ? 'editor' : 'detail'} device viewport matches a same-size browser, including zoom and rotation`, async ({ page, context }) => {
    await openFixture(page, editor);
    const direct = await context.newPage();
    await direct.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: playback }));
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('body')).toHaveCSS('padding', '24px');
    const compare = async (width: number, height: number) => {
      await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
      await expect(frame.locator('body')).toHaveCSS('padding', '0px');
      await expect(frame.locator('body')).toHaveCSS('display', 'block');
      const available = await frame.locator('html').evaluate(element => element.clientWidth);
      expect(await frame.locator('main').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      })).toEqual({ x: 0, y: 0, width: available });
      await direct.setViewportSize({ width, height });
      const url = new URL((await page.locator('iframe').getAttribute('src'))!, page.url());
      url.searchParams.set('framing', 'device');
      url.searchParams.set('device', await frame.locator('html').getAttribute('data-device') ?? 'desktop');
      await direct.goto(url.href);
      expect(await frame.locator('html').evaluate(viewportSnapshot)).toEqual(await direct.evaluate(viewportSnapshot));
      await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
    };
    try {
      await page.getByRole('radio', { name: '电脑', exact: true }).check();
      await compare(1440, 900);
      await page.getByRole('radio', { name: '手机', exact: true }).check();
      await compare(390, 844);
      const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
      await zoom.fill('50');
      await zoom.press('Enter');
      await compare(390, 844);
      for (const [width, height] of [[844, 390], [390, 844], [844, 390], [390, 844]]) {
        await page.getByRole('button', { name: '向右旋转设备 90°', exact: true }).click();
        await compare(width, height);
      }
      await page.getByRole('button', { name: '预览设置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '预览设置', exact: true });
      await dialog.getByRole('spinbutton', { name: '宽度', exact: true }).fill('412');
      await dialog.getByRole('spinbutton', { name: '高度', exact: true }).fill('915');
      await dialog.getByRole('button', { name: '应用尺寸', exact: true }).click();
      await compare(412, 915);
      await page.getByRole('button', { name: '完整显示', exact: true }).click();
      await page.locator('.panel-preview, .editor-preview').screenshot({ path: `test-results/device-viewport-${editor ? 'editor' : 'detail'}.png` });
      await page.getByRole('button', { name: '旋转设置', exact: true }).click();
      await page.getByRole('checkbox', { name: '画面自动转正', exact: true }).uncheck();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '向右旋转设备 90°', exact: true }).click();
      await compare(412, 915);
      await page.getByRole('radio', { name: '组件', exact: true }).check();
      await expect(frame.locator('body')).toHaveCSS('padding', '24px');
      await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
    } finally {
      await direct.close();
    }
  });
}

test('phone content scrolls within the device, and fullscreen fills the actual viewport', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('radio', { name: '手机', exact: true }).check();
  const frame = page.frameLocator('iframe');
  const parentScroll = await page.evaluate(() => scrollY);
  await frame.locator('main').hover({ position: { x: 50, y: 50 } });
  await page.mouse.wheel(0, 700);
  await expect.poll(() => frame.locator('html').evaluate(() => scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(parentScroll);
  await frame.locator('html').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await frame.getByRole('button', { name: 'Bottom control', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Clicked', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全屏预览', exact: true }).click();
  await expect(page.locator('.fullscreen-frame')).toHaveClass(/is-active/);
  await expect(page.locator('.phone-status')).toHaveCount(0);
  await expect(frame.locator('body')).toHaveCSS('padding', '0px');
  await expect.poll(async () => {
    const size = await page.locator('.device-preview').evaluate(element => ({ width: Math.round(element.clientWidth), height: Math.round(element.clientHeight) }));
    const viewport = await frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return { viewport, expanded: size.width > 1000 && size.height > 600 };
  }).toEqual({ viewport: { width: 1440, height: 900 }, expanded: true });
  await expect(page.getByRole('button', { name: '完整显示', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '展开预览工具', exact: true }).click();
  await expect(page.getByRole('button', { name: '完整显示', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 390, height: 844 });
  await expect(page.locator('iframe')).toHaveAttribute('data-session', 'preserved');
});

test('device layout preserves spacing and alignment authored by the asset', async ({ page }) => {
  const custom = structuredClone(asset);
  custom.variants[0].files[1].content += 'body{padding:13px;display:flex;justify-content:flex-start}main{margin:7px;width:200px}';
  await page.route('**/api/assets/viewport-device', route => route.fulfill({ json: custom }));
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage(custom.title, custom.variants[0].files) }));
  await page.goto('/a/viewport-device');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const frame = page.frameLocator('iframe');
  for (const name of ['电脑', '手机']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await expect(frame.locator('html')).toHaveAttribute('data-framing', 'device');
    await expect(frame.locator('body')).toHaveCSS('padding', '13px');
    await expect(frame.locator('body')).toHaveCSS('display', 'flex');
    await expect(frame.locator('main')).toHaveCSS('margin', '7px');
    expect(await frame.locator('main').evaluate(element => element.getBoundingClientRect().x)).toBe(20);
  }
});

for (const framework of ['html', 'vue']) {
  test(`the actual ${framework} weather detail uses the full mobile width without preview padding`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('cea:framework', value), framework);
    await page.goto('/a/weather-forecast-detail');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('radio', { name: '手机', exact: true }).check();
    const frame = page.frameLocator('iframe');
    await expect.poll(() => frame.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 390, height: 844 });
    await expect(frame.locator('.wx')).toBeVisible();
    await expect(frame.locator('body')).toHaveCSS('padding', '0px');
    await expect(frame.locator('.wx')).toHaveCSS('width', '390px');
    expect(await frame.locator('.wx').evaluate(element => element.getBoundingClientRect().x)).toBe(0);
    await page.locator('.panel-preview').screenshot({ path: `test-results/weather-mobile-viewport-${framework}.png` });
  });
}
