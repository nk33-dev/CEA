import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { test, expect } from '@playwright/test';
import { Library } from '../../server/library.ts';
import { createApp } from '../../server/app.ts';
import { listenForFetch } from '../helpers/http.ts';

let directory: string;
let lib: Library;
let server: Server;
let base: string;

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-trash-test-'));
  lib = Library.open(directory);
  ({ server, base } = await listenForFetch(createApp({ lib }, { distDir: path.resolve('dist') })));
});

for (const width of [1440, 390]) {
  test(`delete, restore and permanent delete preserve the intended files at ${width}px`, async ({ page }, info) => {
    const id = `recycle-${width}`;
    const title = `Recoverable component ${width}`;
    lib.createAsset({ id, title, categoryId: null, tags: [], sourceName: '', sourceUrl: '', texts: {},
      variants: [{ framework: 'html', entry: 'markup.html', dependencies: {},
        files: [{ path: 'markup.html', content: '<button>Preview content</button>' }] }] });
    const source = path.join(directory, 'assets', id, 'code', 'html', 'markup.html');
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    const card = page.locator(`[data-asset-id="${id}"]`);
    await card.hover();
    await card.getByRole('button', { name: `删除「${title}」`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
    await expect(card).toHaveCount(0);
    expect(fs.existsSync(source)).toBe(true);
    await page.getByRole('link', { name: '回收站', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`trash-${width}.png`) });
    await page.getByRole('button', { name: `恢复「${title}」`, exact: true }).click();
    await expect(page.getByText('回收站为空', { exact: true })).toBeVisible();
    expect(fs.existsSync(source)).toBe(true);
    await page.getByRole('link', { name: '返回浏览', exact: true }).click();
    await expect(card).toBeVisible();
    await card.hover();
    await card.getByRole('button', { name: `删除「${title}」`, exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.goto(`${base}/a/${id}`);
    await expect(page).toHaveURL(`${base}/trash`);
    await page.getByRole('button', { name: `永久删除「${title}」`, exact: true }).click();
    expect(fs.existsSync(source)).toBe(true);
    await page.getByRole('dialog').getByRole('button', { name: '永久删除', exact: true }).click();
    await expect(page.getByText('回收站为空', { exact: true })).toBeVisible();
    expect(lib.repo.getAsset(id)).toBeNull();
    expect(fs.existsSync(path.join(directory, 'assets', id))).toBe(false);
  });
}

test.afterAll(async () => {
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  lib?.close();
  if (directory && path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('cea-trash-test-')) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
