import { expect, test, type Page } from '@playwright/test';
import { mockLibrary } from './fixtures/mockLibrary.ts';
import { htmlPlayPage } from '../../server/play.ts';
import { writeFile } from 'node:fs/promises';

test.use({ deviceScaleFactor: 1.25 });

async function themeProbe(page: Page) {
  await mockLibrary(page);
  await page.route('**/play/**', route => route.fulfill({ contentType: 'text/html', body: htmlPlayPage('Theme probe', [
    { path: 'markup.html', content: '<button id="scheme-probe">0</button>' },
    { path: 'style.css', content: '#scheme-probe{width:180px;height:120px;border:0;border-radius:0;background:rgb(237,244,255)} @media(prefers-color-scheme:dark){#scheme-probe{background:rgb(20,20,21)}}' },
    { path: 'script.js', content: 'document.querySelector("button").onclick=event=>event.target.textContent=Number(event.target.textContent)+1;' },
  ]) }));
}

async function settled(page: Page) {
  await expect.poll(() => page.locator('html').getAttribute('data-ui-theme-changing')).toBeNull();
}

for (const route of ['/', '/a/demo-a']) {
test(`live theme playback keeps page, text and preview pixels coordinated on ${route}`, async ({ page }, info) => {
  await themeProbe(page);
  await page.goto(route);
  const first = page.locator(route === '/' ? '.card' : '.panel-preview').first();
  await expect(first.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  if (route === '/') await expect.poll(() => first.locator('.fit-stage-inner').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.mouse.move(0, 300);
  const selectors = ['.brand-mark', '.brand-word', '.brand-name', '.topnav a:first-child', '.topnav a:nth-child(2)',
    route === '/' ? '.home' : '.studio', route === '/' ? '.card' : '.panel-preview',
    ...(route === '/' ? [] : ['.reuse-text'])];
  const regions = await page.evaluate(selectors => selectors.map((selector, index) => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    if (index === 5) return { x: 16, y: 180, width: 24, height: 32 };
    if (index === 6) return { x: rect.x + 2, y: rect.y + 32, width: 3, height: 32 };
    if (index === 7) return { x: rect.x + 2, y: rect.y + 32, width: 3, height: 32 };
    return { x: rect.x, y: rect.y, width: selector === '.brand-name' ? 2 : rect.width, height: rect.height };
  }), selectors);
  const stage = (await first.locator(route === '/' ? '.card-stage' : '.preview-well').boundingBox())!;
  const frame = first.locator('iframe');
  await frame.evaluate(element => element.setAttribute('data-retained', 'true'));
  const src = await frame.getAttribute('src');
  const cdp = await page.context().newCDPSession(page);
  const frames: Buffer[] = [];
  cdp.on('Page.screencastFrame', event => {
    frames.push(Buffer.from(event.data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  });
  for (const mode of ['深色界面', '浅色界面']) {
    frames.length = 0;
    const initial = await page.screenshot();
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1800, maxHeight: 1125, everyNthFrame: 1 });
    await page.getByRole('radio', { name: mode, exact: true }).check();
    await settled(page);
    const final = await page.screenshot();
    await cdp.send('Page.stopScreencast');
    const pixels = await page.evaluate(async ({ images, regions, stage }) => {
      const decoded = await Promise.all(images.map(async encoded => {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], { type: 'image/png' }));
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = innerWidth; canvas.height = innerHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }));
      const progress = regions.map(region => {
        const indexes: number[] = [];
        for (let y = Math.ceil(region.y + 3); y < region.y + region.height - 3; y++) {
          for (let x = Math.floor(region.x); x < region.x + region.width; x++) {
            const index = (y * innerWidth + x) * 4;
            const first = decoded[0]!.data[index]!, last = decoded.at(-1)!.data[index]!;
            if (Math.abs(last - first) > 75) indexes.push(index);
          }
        }
        return { count: indexes.length, values: decoded.map(image => {
          const values = indexes.map(index => (image.data[index]! - decoded[0]!.data[index]!) /
            (decoded.at(-1)!.data[index]! - decoded[0]!.data[index]!)).sort((a, b) => a - b);
          return values[Math.floor(values.length / 2)] ?? null;
        }) };
      });
      const preview = decoded.map(image => {
        // 舞台角落和组件内各取一点，分别检查背景与 iframe 内容。
        return [[stage.x + 12, stage.y + 12], [stage.x + stage.width / 2 - 40, stage.y + stage.height / 2 - 30]]
          .map(([x, y]) => [...image.data.slice((Math.floor(y!) * innerWidth + Math.floor(x!)) * 4, (Math.floor(y!) * innerWidth + Math.floor(x!)) * 4 + 4)]);
      });
      const strip = document.createElement('canvas');
      strip.width = 720; strip.height = decoded.length * 68;
      const drawing = strip.getContext('2d')!;
      decoded.forEach((image, index) => {
        drawing.putImageData(image, 0, index * 68, 0, 0, 700, 64);
        drawing.fillStyle = 'red'; drawing.fillText(String(index), 700, index * 68 + 30);
      });
      const proof = document.createElement('canvas');
      proof.width = 700; proof.height = 192;
      const middle = progress[0]!.values.reduce((best, value, index, values) =>
        Math.abs(value! - .5) < Math.abs(values[best]! - .5) ? index : best, 0);
      [0, middle, decoded.length - 1].forEach((index, row) =>
        proof.getContext('2d')!.putImageData(decoded[index]!, 0, row * 64, 0, 0, 700, 64));
      return { progress, preview, filmstrip: strip.toDataURL('image/png'), proof: proof.toDataURL('image/png') };
    }, { images: [initial, ...frames, final].map(image => image.toString('base64')), regions, stage });
    await info.attach(`${mode}-pixel-progress`, { body: JSON.stringify({ progress: pixels.progress, preview: pixels.preview }), contentType: 'application/json' });
    const path = info.outputPath(`${mode}-filmstrip.png`);
    await writeFile(path, Buffer.from(pixels.filmstrip.split(',')[1]!, 'base64'));
    await info.attach(`${mode}-playback`, { path, contentType: 'image/png' });
    if (mode === '深色界面') {
      const proof = info.outputPath('theme-proof.png');
      await writeFile(proof, Buffer.from(pixels.proof.split(',')[1]!, 'base64'));
      await info.attach('theme-proof', { path: proof, contentType: 'image/png' });
    }
    for (const [index, track] of pixels.progress.entries()) {
      expect(track.count, selectors[index]).toBeGreaterThan(5);
      expect(track.values.some(value => value! > .05 && value! < .95), `${selectors[index]} has a real painted intermediate frame`).toBe(true);
      for (let i = 1; i < track.values.length; i++) {
        expect(track.values[i]! - track.values[i - 1]!, `${selectors[index]} must not reverse color`).toBeGreaterThan(-.06);
        expect(Math.abs(track.values[i]! - pixels.progress[0]!.values[i]!), 'logo, divider and text share the dissolve').toBeLessThan(.12);
      }
    }
    for (const sample of pixels.preview) expect(sample, 'preview must not flash, fade or change background').toEqual(pixels.preview[0]);
    await expect(frame).toHaveAttribute('data-retained', 'true');
    expect(await frame.getAttribute('src')).toBe(src);
  }
  await cdp.detach();
});
}

for (const width of [390, 800]) {
  test(`theme playback does not change scroll ownership or layout at ${width}px`, async ({ page }) => {
    await mockLibrary(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('.card').first().locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const samples: number[][] = [];
      const state = { samples, stop: false };
      (window as unknown as { layoutSamples: typeof state }).layoutSamples = state;
      const sample = () => {
        const rect = document.querySelector('.card')!.getBoundingClientRect();
        samples.push([document.documentElement.scrollWidth - document.documentElement.clientWidth, scrollX, scrollY, rect.x, rect.y, rect.width, rect.height]);
        if (!state.stop) requestAnimationFrame(sample);
      };
      sample();
    });
    await page.getByRole('radio', { name: '深色界面', exact: true }).check();
    await settled(page);
    const samples = await page.evaluate(() => {
      const state = (window as unknown as { layoutSamples: { samples: number[][]; stop: boolean } }).layoutSamples;
      state.stop = true;
      return state.samples;
    });
    for (const sample of samples) {
      expect(sample[0], 'no transient horizontal scrollbar').toBeLessThanOrEqual(0);
      expect(sample.slice(1), 'theme does not resize or scroll the page').toEqual(samples[0]!.slice(1));
    }
  });
}

test('website and system themes do not recolor sandboxed media or reload previews', async ({ page }) => {
  await themeProbe(page);
  await page.goto('/');
  const card = page.locator('.card').first();
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const frame = card.locator('iframe');
  await frame.evaluate(element => element.setAttribute('data-retained', 'true'));
  const probe = card.frameLocator('iframe').locator('#scheme-probe');
  for (const mode of ['深色界面', '浅色界面', '跟随系统']) {
    await page.getByRole('radio', { name: mode, exact: true }).check();
    await settled(page);
    expect(await probe.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(237, 244, 255)');
    expect(await frame.evaluate(element => getComputedStyle(element).colorScheme)).toBe('light only');
    await expect(frame).toHaveAttribute('data-retained', 'true');
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  await settled(page);
  expect(await frame.evaluate(element => getComputedStyle(element).colorScheme)).toBe('light only');
  await expect(frame).toHaveAttribute('data-retained', 'true');
  expect(await page.evaluate(() => localStorage.getItem('cea:ui:theme'))).toBe('system');
});

test('detail keeps stage background, component appearance and interaction separate from website theme', async ({ page }) => {
  await themeProbe(page);
  await page.goto('/a/demo-a');
  await expect(page.locator('.stage-host')).toHaveAttribute('aria-busy', 'false');
  const preview = page.frameLocator('iframe');
  const probe = preview.locator('#scheme-probe');
  await probe.click();
  await expect(probe).toHaveText('1');
  await page.getByRole('radio', { name: '深色界面', exact: true }).check();
  await settled(page);
  await expect(page.locator('.device-screen')).toHaveCSS('background-color', 'rgb(247, 247, 248)');
  await page.getByRole('radio', { name: '浅色界面', exact: true }).check();
  await settled(page);
  await page.getByRole('radiogroup', { name: '舞台背景', exact: true }).getByRole('radio', { name: '深色', exact: true }).check();
  for (const name of ['深色界面', '浅色界面']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await settled(page);
    await expect(page.locator('.preview-well')).toHaveClass(/theme-dark/);
    await expect(preview.locator('html')).toHaveAttribute('data-background', 'dark');
    await expect(preview.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.device-screen')).toHaveCSS('background-color', 'rgb(20, 20, 21)');
    await expect(probe).toHaveText('1');
  }
  await probe.click();
  await expect(probe).toHaveText('2');
});

test('a preview finishing during theme playback retains its own initial background', async ({ page }) => {
  await themeProbe(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/play/**', async route => { await gate; await route.fallback(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const first = page.locator('.card').first();
  await expect(first.locator('.stage-host')).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('radio', { name: '深色界面', exact: true }).check();
  release();
  await expect(first.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await settled(page);
  expect(await first.frameLocator('iframe').locator('#scheme-probe').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(237, 244, 255)');
  expect(await first.locator('.card-stage').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(247, 247, 248)');
});

test('rapid real input and keyboard selection settle to the last theme', async ({ page }) => {
  await mockLibrary(page);
  await page.goto('/');
  for (const name of ['深色界面', '浅色界面', '深色界面', '跟随系统', '深色界面']) {
    await page.getByRole('radio', { name, exact: true }).check();
  }
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  await settled(page);
  expect(await page.locator('.results-bar .btn-dark').evaluate(element => getComputedStyle(element).transitionDuration)).toContain('0.15s');
  expect(await page.evaluate(() => localStorage.getItem('cea:ui:theme'))).toBe('dark');
  const group = page.getByRole('radiogroup', { name: '界面主题', exact: true });
  await group.getByRole('radio', { name: '深色界面', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '跟随系统', exact: true })).toBeChecked();
  await settled(page);
});

for (const fallback of ['reduced', 'saved'] as const) {
  test(`${fallback} theme applies without startup or partial control animation`, async ({ page }) => {
    await mockLibrary(page);
    if (fallback === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (fallback === 'saved') await page.addInitScript(() => localStorage.setItem('cea:ui:theme', 'dark'));
    await page.goto('/');
    await expect(page.getByRole('searchbox', { name: '搜索组件', exact: true })).toBeVisible();
    if (fallback !== 'saved') await page.getByRole('radio', { name: '深色界面', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
    expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 19)');
    expect(await page.locator('.topnav a').first().evaluate(element => getComputedStyle(element).color)).toBe('rgb(241, 241, 243)');
    expect(await page.locator('html').evaluate(element => element.getAnimations().length)).toBe(0);
    expect(await page.locator('html').getAttribute('data-ui-theme-changing')).toBeNull();
  });
}

test('theme switching uses native paint transitions without taking a document snapshot', async ({ page }) => {
  await mockLibrary(page);
  await page.addInitScript(() => Object.defineProperty(document, 'startViewTransition', { value: () => {
    throw Error('Theme switching must not capture the document');
  } }));
  await page.goto('/');
  await page.getByRole('radio', { name: '深色界面', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'dark');
  await settled(page);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(17, 17, 19)');
});
