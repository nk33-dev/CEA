import { test, expect } from '@playwright/test';
import type { AssetDetail } from '../../shared/types.ts';
import { htmlPlayPage } from '../../server/play.ts';

test('native popover scrollbar supports dragging', async ({ page }) => {
  await page.setContent(`<style>#info{width:296px;height:400px;overflow:auto;scrollbar-width:thin;scrollbar-color:#8194a8 transparent;scrollbar-gutter:stable}p{height:800px}</style><button popovertarget="info">Open</button><div id="info" popover><p>Content</p></div>`);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const popup = page.locator('#info');
  const box = (await popup.boundingBox())!;
  await page.mouse.move(box.x + box.width - 7, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 7, box.y + 350, { steps: 8 });
  await page.mouse.up();
  expect(await popup.evaluate(element => element.scrollTop)).toBeGreaterThan(30);
});

test('the actual heatmap picker stays inside its card after a pointer click', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-asset-id="leetcode-heatmap"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const frame = card.frameLocator('iframe');
  const select = frame.getByRole('combobox', { name: 'Range', exact: true });
  await expect(select).toHaveCSS('appearance', 'base-select');
  expect(await select.evaluate(element => getComputedStyle(element, '::picker-icon').display)).toBe('none');
  await expect(select.locator('option:checked')).toHaveText('Past year');
  await select.click();
  expect(await select.evaluate(element => getComputedStyle(element, '::picker-icon').display)).toBe('none');
  expect(await select.evaluate(element => element.matches(':open'))).toBe(true);
  const option = frame.getByRole('option', { name: '2025', exact: true });
  await expect(option).toBeVisible();
  const bounds = (await option.boundingBox())!;
  const stage = (await card.locator('.card-stage').boundingBox())!;
  const trigger = (await select.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(stage.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(bounds.y).toBeGreaterThanOrEqual(stage.y);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  expect(Math.abs(bounds.x - trigger.x)).toBeLessThan(110);
  await page.screenshot({ path: 'test-results/heatmap-picker-open.png' });
  await option.click();
  await expect(select).toHaveValue('2025');
  expect(await select.evaluate(element => element.matches(':open'))).toBe(false);
  await select.press('Space');
  expect(await select.evaluate(element => element.matches(':open'))).toBe(true);
  await select.press('Escape');
  expect(await select.evaluate(element => element.matches(':open'))).toBe(false);
});

const asset: AssetDetail = {
  id: 'picker-fixture', title: 'Picker Fixture', type: 'component', categoryId: null, tags: [],
  favorite: false, cover: null, sourceName: '', sourceUrl: '', frameworks: ['html'], locales: ['en'],
  createdAt: '2026-01-01', updatedAt: '2026-01-01', texts: { en: { summary: '', idea: '' } }, media: [],
  variants: [{
    framework: 'html', entry: 'markup.html', dependencies: {}, theme: { version: 1, mode: 'light', default: 'light' },
    files: [
      { path: 'markup.html', content: `<section class="fixture">
        <select class="authored" aria-label="Single" size="1"><option value="a">Alpha</option><optgroup label="Group"><option value="b" disabled>Disabled</option><option value="c">Charlie</option></optgroup></select>
        <select aria-label="Multiple" multiple size="3"><option>One</option><option>Two</option></select>
        <button id="add">Add option</button><output id="events">0</output>
        <button popovertarget="info">Info</button><aside id="info" popover>Popover content</aside>
      </section>` },
      { path: 'style.css', content: '.fixture{width:360px;padding:24px;background:white;color:#111} .authored{appearance:none!important;-webkit-appearance:none!important;min-width:120px;font-size:14px} #info{padding:16px;border:1px solid #bbb}' },
      { path: 'script.js', content: `const single=document.querySelector('select');single.onchange=()=>document.querySelector('output').textContent=Number(document.querySelector('output').textContent)+1;document.querySelector('#add').onclick=()=>single.add(new Option('Delta','d'));` },
    ],
  }],
};

for (const width of [1440, 390]) {
  test(`scaled picker retains size-one, disabled, dynamic options and change events at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/assets/picker-fixture', route => route.fulfill({ json: asset }));
    await page.route('**/play/picker-fixture/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage('Fixture', asset.variants[0].files) }));
    await page.goto('/a/picker-fixture');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const frame = page.frameLocator('iframe');
    const select = frame.getByRole('combobox', { name: 'Single', exact: true });
    await expect(select).toHaveCSS('appearance', 'base-select');
    await expect(frame.getByRole('listbox', { name: 'Multiple', exact: true })).not.toHaveCSS('appearance', 'base-select');
    await frame.getByRole('button', { name: 'Add option', exact: true }).click();
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    await zoom.fill('60');
    await zoom.press('Enter');
    await select.evaluate(element => (element as HTMLElement).style.setProperty('appearance', 'none', 'important'));
    await select.click();
    await expect(select).toHaveCSS('appearance', 'base-select');
    await expect(frame.getByRole('option', { name: 'Disabled', exact: true })).toBeDisabled();
    await frame.getByRole('option', { name: 'Delta', exact: true }).click();
    await expect(select).toHaveValue('d');
    await expect(frame.locator('#events')).toHaveText('1');
    await select.press('Space');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toHaveValue('c');
    await expect(frame.locator('#events')).toHaveText('2');
    await select.press('Space');
    await select.press('Escape');
    await expect(select).toBeFocused();
    await page.getByRole('radio', { name: '手机', exact: true }).check();
    await select.click();
    await frame.getByRole('option', { name: 'Alpha', exact: true }).click();
    await expect(select).toHaveValue('a');
    await expect(frame.locator('#events')).toHaveText('3');
    await frame.getByRole('button', { name: 'Info', exact: true }).click();
    await expect(frame.locator('#info')).toBeVisible();
    const popup = (await frame.locator('#info').boundingBox())!;
    const stage = (await page.locator('.preview-well').boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(stage.x);
    expect(popup.x + popup.width).toBeLessThanOrEqual(stage.x + stage.width);
    await page.screenshot({ path: `test-results/preview-popover-${width}.png` });
  });
}

for (const framework of ['html', 'react', 'vue']) {
  test(`actual ${framework} heatmap picker follows the scaled preview without reloading`, async ({ page }) => {
    await page.addInitScript(fw => {
      if (window !== window.top) return;
      localStorage.setItem('cea:framework', fw);
    }, framework);
    await page.goto('/a/leetcode-heatmap');
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const iframe = page.locator('iframe');
    const frame = page.frameLocator('iframe');
    const select = frame.getByRole('combobox', { name: 'Range', exact: true });
    await expect(frame.getByRole('combobox')).toHaveCount(1);
    expect(await select.evaluate(element => getComputedStyle(element, '::picker-icon').display)).toBe('none');
    await expect(select.locator('option:checked')).toHaveText('Past year');
    await expect(select).toHaveCSS('align-items', 'center');
    await expect(select).toHaveCSS('line-height', '20px');
    expect(await select.evaluate(element => getComputedStyle(element).fontFamily)).toBe(await frame.locator('.hm').evaluate(element => getComputedStyle(element).fontFamily));
    await page.locator('.panel-preview').screenshot({ path: `test-results/heatmap-control-${framework}.png` });
    await iframe.evaluate(element => element.setAttribute('data-preview-session', 'preserved'));
    await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).fill('70');
    await page.getByRole('spinbutton', { name: '缩放比例', exact: true }).press('Enter');
    await select.click();
    const option = frame.getByRole('option', { name: '2025', exact: true });
    await expect(option).toBeVisible();
    const bounds = (await option.boundingBox())!;
    const trigger = (await select.boundingBox())!;
    expect(Math.abs(bounds.x - trigger.x)).toBeLessThan(120);
    expect(Math.abs(bounds.y - trigger.y)).toBeLessThan(200);
    await page.locator('.panel-preview').screenshot({ path: `test-results/heatmap-picker-${framework}.png` });
    await option.click();
    await expect(select).toHaveValue('2025');
    await expect(iframe).toHaveAttribute('data-preview-session', 'preserved');
    await expect(select).toBeFocused();
  });
}

test('the heatmap source keeps a single styled range control outside the CEA preview', async ({ page, request }) => {
  const asset = await (await request.get('/api/assets/leetcode-heatmap')).json() as AssetDetail;
  const files = asset.variants.find(variant => variant.framework === 'html')!.files;
  const content = (path: string) => files.find(file => file.path === path)!.content;
  await page.route('**/standalone-heatmap', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>${content('style.css')}</style></head><body>${content('markup.html')}<script>${content('script.js')}</script></body></html>`,
  }));
  await page.goto('/standalone-heatmap');
  const select = page.getByRole('combobox', { name: 'Range', exact: true });
  await expect(page.getByRole('combobox')).toHaveCount(1);
  await expect(select.locator('option:checked')).toHaveText('Past year');
  expect(await select.evaluate(element => getComputedStyle(element, '::picker-icon').display)).toBe('none');
  await select.click();
  await page.getByRole('option', { name: '2025', exact: true }).click();
  await expect(select).toHaveValue('2025');
  await expect(page.locator('[data-hm-range]')).toHaveText('in 2025');
});

test('weather popover controls remain inside the visible card preview', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('[data-asset-id="weather-day-switcher"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const frame = card.frameLocator('iframe');
  await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
  const popup = frame.locator('[popover]:popover-open');
  await expect(popup).toBeVisible();
  const stage = (await card.locator('.card-stage').boundingBox())!;
  await expect.poll(async () => {
    const bounds = (await popup.boundingBox())!;
    return bounds.y >= stage.y - 1 && bounds.y + bounds.height <= stage.y + stage.height + 1;
  }).toBe(true);
  await card.screenshot({ path: 'test-results/weather-popover-card.png' });
  await popup.getByRole('button', { name: '关闭天气选择', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect.poll(() => frame.locator('[popover]').evaluate(element => (element as HTMLElement).style.cssText)).toBe('');
  await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
  const last = popup.getByRole('radio').last();
  await last.click();
  await expect(popup).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '选择预览天气', exact: true })).toBeFocused();
  await frame.getByRole('button', { name: '选择预览天气', exact: true }).click();
  await expect(popup).toBeVisible();
  await page.locator('.active-count').click();
  await expect(popup).toHaveCount(0);
});

for (const scenario of [
  { id: 'weather-week-switcher', framework: 'html', editor: false, zoom: '100', width: 1440 },
  { id: 'weather-week-switcher', framework: 'vue', editor: false, zoom: '150', width: 1440 },
  { id: 'weather-forecast-detail', framework: 'html', editor: false, zoom: '100', width: 1440 },
  { id: 'weather-day-switcher', framework: 'html', editor: true, zoom: '150', width: 1440 },
  { id: 'weather-week-switcher', framework: 'html', editor: false, zoom: '100', width: 390 },
  { id: 'weather-day-switcher', framework: 'vue', editor: true, zoom: '150', width: 390 },
]) {
  test(`${scenario.id} ${scenario.framework} ${scenario.editor ? 'editor' : 'detail'} ${scenario.width}px confines long weather options without moving the canvas`, async ({ page }, info) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.addInitScript(framework => localStorage.setItem('cea:framework', framework), scenario.framework);
    await page.goto(`/a/${scenario.id}${scenario.editor ? '/edit' : ''}`);
    if (scenario.editor) {
      await page.getByRole('tablist', { name: '实现', exact: true }).getByRole('tab', { name: scenario.framework === 'vue' ? 'Vue' : 'HTML', exact: true }).click();
      await page.locator('.editor-preview').scrollIntoViewIfNeeded();
    }
    await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
    const zoom = page.getByRole('spinbutton', { name: '缩放比例', exact: true });
    await zoom.fill(scenario.zoom);
    await zoom.press('Enter');
    const frame = page.frameLocator('iframe');
    const canvas = page.locator('.device-preview');
    await canvas.scrollIntoViewIfNeeded();
    const trigger = frame.getByRole('button', { name: '选择预览天气', exact: true });
    if (await page.locator('.device-pan-bar.is-x').count()) {
      const handle = (await page.locator('.device-pan-bar.is-x').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.wheel(1000, 0);
    }
    if (scenario.id === 'weather-forecast-detail') {
      const handle = (await page.locator('.device-pan-bar.is-y').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.wheel(0, -1500);
    }
    const transform = await page.locator('.device-stage').evaluate(element => getComputedStyle(element).transform);
    await frame.locator('.wx-weather-menu').evaluate(element => {
      const samples: { x: number; y: number; opacity: number }[] = [];
      (window as unknown as { overlaySamples: typeof samples }).overlaySamples = samples;
      element.addEventListener('toggle', () => {
        if (!element.matches(':popover-open')) return;
        let count = 0;
        const sample = () => {
          const rect = element.getBoundingClientRect();
          samples.push({ x: rect.x, y: rect.y, opacity: Number(getComputedStyle(element).opacity) });
          if (++count < 24) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    await trigger.click();
    const popup = frame.locator('[popover]:popover-open');
    await expect(popup).toBeVisible();
    const fits = async () => {
      const menu = (await popup.boundingBox())!;
      const host = (await canvas.boundingBox())!;
      return menu.x >= host.x - 1 && menu.y >= host.y - 1 && menu.x + menu.width <= host.x + host.width + 1 && menu.y + menu.height <= host.y + host.height + 1;
    };
    await expect.poll(fits).toBe(true);
    await expect(popup).toHaveCSS('overflow-y', 'auto');
    await expect(popup).toHaveCSS('scrollbar-width', 'thin');
    expect(await popup.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await popup.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const box = (await popup.boundingBox())!;
    const scrollbar = await popup.evaluate(element => {
      const menu = element as HTMLElement;
      const style = getComputedStyle(element);
      return menu.offsetWidth - menu.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    });
    const scrollbarX = box.x + box.width - Math.max(3, scrollbar / 2 * Number(scenario.zoom) / 100);
    await page.mouse.move(scrollbarX, box.y + 35);
    await page.mouse.down();
    await page.mouse.move(scrollbarX, box.y + box.height - 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => popup.evaluate(element => element.scrollTop)).toBeGreaterThan(30);
    await popup.getByRole('radio').last().scrollIntoViewIfNeeded();
    await expect.poll(fits).toBe(true);
    const samples = await popup.evaluate(async () => {
      await new Promise(resolve => setTimeout(resolve, 450));
      return (window as unknown as { overlaySamples: { x: number; y: number; opacity: number }[] }).overlaySamples;
    });
    await info.attach('overlay-frames', { body: JSON.stringify(samples), contentType: 'application/json' });
    expect(samples.length).toBeGreaterThan(6);
    for (let i = 1; i < samples.length; i++) expect(samples[i].opacity).toBeGreaterThanOrEqual(samples[i - 1].opacity - 0.001);
    const settled = samples.slice(14);
    expect(Math.max(...settled.map(sample => sample.x)) - Math.min(...settled.map(sample => sample.x))).toBeLessThan(0.5);
    expect(Math.max(...settled.map(sample => sample.y)) - Math.min(...settled.map(sample => sample.y))).toBeLessThan(0.5);
    expect(await page.locator('.device-stage').evaluate(element => getComputedStyle(element).transform)).toBe(transform);
    await canvas.screenshot({ path: `test-results/long-weather-${scenario.id}-${scenario.framework}-${scenario.width}.png` });
    await popup.getByRole('radio').last().click();
    await expect(popup).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(frame.locator('[popover]')).toHaveAttribute('style', '');
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  });
}
