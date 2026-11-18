import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { Library } from '../../server/library.ts';
import { createApp } from '../../server/app.ts';
import { listenForFetch } from '../helpers/http.ts';
import type { Variant } from '../../shared/types.ts';
import { PNG } from './fixtures/mockLibrary.ts';

let directory: string;
let lib: Library;
let server: Server;
let base: string;

test.use({ deviceScaleFactor: 1.25 });

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-thumbnail-test-'));
  lib = Library.open(directory);
  for (const framework of ['html', 'react', 'vue']) {
    const entry = framework === 'html' ? 'markup.html' : framework === 'react' ? 'Component.jsx' : 'Component.vue';
    const content = framework === 'html' ? '<img src="./images/art.png" alt="Local artwork" width="240" height="160">'
      : framework === 'react' ? 'import image from "./images/art.png";export default function Component(){return <img src={image} alt="Local artwork" width="240" height="160"/>}'
      : '<script setup>import image from "./images/art.png";</script><template><img :src="image" alt="Local artwork" width="240" height="160"></template>';
    const variant: Variant = { framework, entry, dependencies: {}, files: [{ path: entry, content }],
      resources: [{ path: 'images/art.png', mime: 'image/png', size: PNG.length }] };
    lib.createAsset({ id: `local-${framework}`, title: `Local ${framework}`, categoryId: null, tags: [], sourceName: '', sourceUrl: '', texts: {}, variants: [variant] },
      { resourceData: { [`${framework}/images/art.png`]: PNG } });
  }
  lib.createAsset({ id: 'covered-html', title: 'Covered component', categoryId: null, tags: [], sourceName: '', sourceUrl: '', texts: {}, previewScale: 1.5,
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [
      { path: 'markup.html', content: '<div style="width:120px;height:80px;background:tomato"><button>Small live content</button></div>' },
      { path: 'script.js', content: "document.querySelector('button').onclick=event=>event.currentTarget.dataset.clicked='true';" },
    ] }] });
  lib.addMedia('covered-html', 'cover.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="tomato"/></svg>'));
  lib.createAsset({ id: 'bounded-canvas', title: 'Bounded canvas', categoryId: null, tags: [], sourceName: '', sourceUrl: '', texts: {},
    previewViewport: { width: 720, height: 960 },
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [{
      path: 'markup.html',
      content: '<div data-preview-bounds style="margin:24px;width:672px;height:600px;background:#101113"><span style="display:block;width:20px;height:20px">A</span></div>',
    }] }] });
  lib.createAsset({ id: 'painted-frame', title: 'Painted frame', categoryId: null, tags: [], sourceName: '', sourceUrl: '', texts: {},
    previewViewport: { width: 720, height: 960 },
    variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [{
      path: 'markup.html',
      content: '<div data-preview-bounds style="box-sizing:border-box;width:720px;height:144px;padding:32px;background:#101113;color:white">Heading with a painted frame</div>',
    }] }] });
  lib.addMedia('painted-frame', 'cover.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="288"><rect width="1440" height="288" fill="#101113"/></svg>'));
  ({ server, base } = await listenForFetch(createApp({ lib }, { distDir: path.resolve('dist') })));
});

test('a high-density cover and its padded painted frame keep the same crop', async ({ page }) => {
  await page.goto(`${base}/?q=Painted`);
  await page.mouse.move(0, 0);
  const card = page.locator('[data-asset-id="painted-frame"]');
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const stage = card.locator('.card-stage');
  const darkBounds = async () => {
    const png = await stage.screenshot({ scale: 'css' });
    return page.evaluate(async source => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(source), c => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4;
        if (pixels[at] < 40 && pixels[at + 1] < 40 && pixels[at + 2] < 40) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      return { left, right, top, bottom };
    }, png.toString('base64'));
  };
  const before = await darkBounds();
  await stage.hover();
  await expect(card.locator('.card-cover')).toBeHidden();
  const after = await darkBounds();
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) expect(Math.abs(after[edge] - before[edge])).toBeLessThanOrEqual(1);
});

test('a cover hands off to the ready live frame without cross-fading different compositions', async ({ page }) => {
  await page.goto(base);
  await page.mouse.move(0, 0);
  const card = page.locator('[data-asset-id="covered-html"]');
  const cover = card.locator('.card-cover');
  await expect(cover).toBeVisible();
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(cover).toBeVisible();
  await expect(card.locator('.fit-stage')).toBeHidden();
  const existingFrame = await card.locator('iframe').getAttribute('src');
  await card.locator('.card-stage').hover();
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  await expect(card.locator('iframe')).toHaveAttribute('title', '');
  await expect(card.locator('iframe')).toHaveAttribute('aria-label', /Covered component/);
  await expect(cover).toBeHidden();
  const live = card.locator('.fit-stage-inner');
  await expect(live).toHaveCSS('opacity', '1');
  await expect(live).toHaveCSS('transition-duration', '0s');
  await expect(card.frameLocator('iframe').getByText('Small live content')).toBeVisible();
  await card.frameLocator('iframe').getByRole('button', { name: 'Small live content' }).click();
  await expect(card.frameLocator('iframe').locator('button')).toHaveAttribute('data-clicked', 'true');
  expect(await card.locator('iframe').getAttribute('src')).toBe(existingFrame);
  const frame = await card.locator('iframe').boundingBox();
  const content = await card.frameLocator('iframe').getByText('Small live content').evaluate(element => {
    const rect = element.parentElement!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewport: innerWidth };
  });
  const image = await cover.evaluate(element => {
    const img = element as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    return { width: img.naturalWidth * 1.5, height: img.naturalHeight * 1.5, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const scale = frame!.width / content.viewport;
  expect(Math.abs(content.width * scale - image.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(content.height * scale - image.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame!.x + (content.x + content.width / 2) * scale - image.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame!.y + (content.y + content.height / 2) * scale - image.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  await expect(cover).toBeHidden();
  await expect(card.locator('iframe')).toHaveCount(1);
});

test.afterAll(async () => {
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  lib?.close();
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('cea-thumbnail-test-')) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('list thumbnails resolve original resource files through the framework-less playback entry', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('requestfailed', request => { if (/\/images\//.test(request.url())) failures.push(request.url()); });
  await page.goto(base);
  for (const framework of ['html', 'react', 'vue']) {
    const card = page.locator(`[data-asset-id="local-${framework}"]`);
    await card.scrollIntoViewIfNeeded();
    const frame = card.frameLocator('iframe');
    await expect(frame.getByRole('img', { name: 'Local artwork' })).toBeVisible();
    await expect.poll(() => frame.locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const image = await frame.locator('img').evaluate(image => ({ src: (image as HTMLImageElement).src, document: location.href }));
    expect(image.document).toContain(`/play/local-${framework}/${framework}/?`);
    expect(image.src).toBe(`${base}/play/local-${framework}/${framework}/images/art.png`);
    await card.hover();
    await page.mouse.move(0, 0);
    await expect.poll(() => frame.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
  }
  expect(failures).toEqual([]);
  await page.screenshot({ path: info.outputPath('resource-thumbnails.png') });
});

test('a declared canvas keeps its full framing without a scaled iframe edge line', async ({ page }) => {
  await page.goto(`${base}/?q=Bounded`);
  const card = page.locator('[data-asset-id="bounded-canvas"]');
  await expect(card.locator('.fit-stage')).toHaveAttribute('data-ready', 'true');
  const target = card.frameLocator('iframe').locator('[data-preview-bounds]');
  const content = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(content).toEqual({ x: 24, y: 24, width: 672, height: 600 });
  const frame = (await card.locator('iframe').boundingBox())!;
  const stage = (await card.locator('.card-stage').boundingBox())!;
  const scale = frame.width / 720;
  expect(content.width * scale).toBeLessThanOrEqual(stage.width);
  expect(content.height * scale).toBeLessThanOrEqual(stage.height);
  const image = await page.screenshot({ clip: stage, scale: 'css' });
  const darkPixels = await page.evaluate(async ({ png, edge }) => {
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let y = 4; y < canvas.height - 4; y++) {
      for (let x = Math.max(0, Math.floor(edge) - 1); x <= Math.min(canvas.width - 1, Math.ceil(edge) + 1); x++) {
        const at = (y * canvas.width + x) * 4;
        if (pixels[at] < 70 && pixels[at + 1] < 70 && pixels[at + 2] < 70) count++;
      }
    }
    return count;
  }, { png: image.toString('base64'), edge: frame.x + frame.width - stage.x });
  expect(darkPixels).toBe(0);
});
