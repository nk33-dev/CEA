import { expect, test, type Locator } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';

async function contrast(target: Locator) {
  return target.evaluate(element => {
    const context = document.createElement('canvas').getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    let background = element;
    while (background.parentElement && rgba(getComputedStyle(background).backgroundColor)[3] === 0) background = background.parentElement;
    const luminance = (channels: number[]) => channels.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
    const foreground = getComputedStyle(element).color;
    const field = getComputedStyle(background).backgroundColor;
    const a = luminance(rgba(foreground)), b = luminance(rgba(field));
    return { foreground, background: field, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
}

for (const theme of ['light', 'dark']) {
  test(`${theme} reuse prose and highlighted source remain readable without changing the source or preview`, async ({ page }, info) => {
    const demo = await mockLibrary(page);
    const asset = demo.assets.get('demo-a')!;
    asset.variants[0]!.files.push(
      { path: 'style.css', content: '.demo { color: #263238; width: 180px; }' },
      { path: 'script.js', content: '// Keep data intact.\nfunction greet(name) {\n  const message = "Hello";\n  return name.length > 2 ? message : 42;\n}\ngreet("CEA");' },
    );
    await page.addInitScript(theme => localStorage.setItem('cea:ui:theme', theme), theme);
    await page.goto('/a/demo-a');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    await page.locator('iframe').evaluate(element => element.setAttribute('data-retained', 'true'));
    for (const name of ['思路', '复刻', '源码']) {
      await page.getByRole('tab', { name, exact: true }).click();
      const text = page.locator('.reuse-text');
      const reading = await contrast(text);
      expect(reading.ratio, `${name}: ${JSON.stringify(reading)}`).toBeGreaterThanOrEqual(4.5);
      if (name === '源码') {
        await expect(text).not.toHaveAttribute('aria-busy', 'true');
        for (const token of ['.hl-comment', '.hljs-comment', '.hljs-tag', '.hljs-attr', '.hljs-property', '.hljs-string', '.hljs-number', '.hljs-keyword', '.hljs-title', '.hljs-params']) {
          const target = text.locator(token).first();
          if (!await target.count()) continue;
          const ink = await contrast(target);
          expect(ink.ratio, `${token}: ${JSON.stringify(ink)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      await expect(page.locator('iframe')).toHaveAttribute('data-retained', 'true');
    }
    await page.getByRole('button', { name: '复制源码', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain(asset.variants[0]!.files[2]!.content);
    await page.getByRole('tab', { name: '思路', exact: true }).click();
    await page.screenshot({ path: `test-results/theme-${theme}-detail.png` });
    await info.attach(`${theme}-detail`, { body: await page.screenshot(), contentType: 'image/png' });
    expect(demo.writes).toEqual([]);
  });

  test(`${theme} selected filter glyphs and counts stay readable when hovered`, async ({ page }) => {
    await mockLibrary(page);
    await page.addInitScript(theme => localStorage.setItem('cea:ui:theme', theme), theme);
    await page.goto('/');
    await page.getByRole('button', { name: '标签', exact: true }).click();
    await page.getByRole('option', { name: /动效/ }).click();
    const selected = page.locator('.fmenu-item[aria-selected=true]').first();
    await selected.hover();
    for (const selector of ['.fmenu-check', '.count']) {
      const ink = await contrast(selected.locator(selector));
      expect(ink.ratio, `${selector}: ${JSON.stringify(ink)}`).toBeGreaterThanOrEqual(selector === '.count' ? 4.5 : 3);
    }
  });

  test(`${theme} import status and format selection use their own surface colors`, async ({ page }) => {
    const demo = await mockLibrary(page);
    await page.addInitScript(theme => localStorage.setItem('cea:ui:theme', theme), theme);
    await page.goto('/transfer');
    const check = page.locator('.choice-option:has(input:checked) .transfer-format-check');
    expect((await contrast(check)).ratio).toBeGreaterThanOrEqual(3);
    await page.locator('input[type=file]').setInputFiles({ name: 'demo.zip', mimeType: 'application/zip', buffer: Buffer.from('demo') });
    await expect(page.locator('.import-items')).toBeVisible();
    expect((await contrast(page.locator('.import-items em').first())).ratio).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: '导入 1 个组件', exact: true }).click();
    await expect(page.locator('.import-result')).toBeVisible();
    for (const target of [page.locator('.import-result'), page.locator('.import-result-title')]) {
      expect((await contrast(target)).ratio).toBeGreaterThanOrEqual(4.5);
    }
    expect(demo.unexpected).toEqual([]);
  });
}
