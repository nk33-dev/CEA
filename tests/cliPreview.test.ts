import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Library } from '../server/library.ts';
import { openComponentPreview } from '../server/cli/preview.ts';

let root: string;
let library: string;
const cli = fileURLToPath(new URL('../server/cli.ts', import.meta.url));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-preview-test-'));
  vi.stubEnv('CEA_CONFIG_DIR', path.join(root, 'config'));
  library = path.join(root, 'library');
  const lib = Library.open(library);
  lib.createAsset({
    id: 'sample', title: 'Sample', tags: [], texts: {}, categoryId: null, sourceName: '', sourceUrl: '', variants: [{
      framework: 'html', entry: 'markup.html', dependencies: {}, files: [
        { path: 'markup.html', content: '<section data-preview-bounds><button id="counter">0</button><i></i><img src="./resource.svg"></section>' },
        { path: 'style.css', content: 'section{width:300px;height:180px;background:#fff}i{display:block;width:20px;height:20px;background:red;animation:move 1s linear infinite}@keyframes move{to{transform:translateX(100px)}}' },
        { path: 'script.js', content: 'counter.onclick=()=>counter.textContent=Number(counter.textContent)+1' },
        { path: 'resource.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>' },
      ],
    }],
  });
  lib.close();
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cea-preview-test-')) throw new Error('Unexpected test directory');
  fs.rmSync(root, { recursive: true, force: true });
});

it('serves only the chosen component with a sandbox and no writable API', async () => {
  const session = await openComponentPreview('sample', library, 'html', { width: 390, height: 600 });
  try {
    const wrapper = await fetch(session.url).then(response => response.text());
    expect(wrapper).toContain('sandbox="allow-scripts allow-forms');
    expect(wrapper).not.toContain('allow-same-origin');
    expect(wrapper).toContain('width:390px;height:600px');
    const play = await fetch(new URL('play/', session.url));
    expect(play.headers.get('content-security-policy')).toContain('sandbox');
    expect(await play.text()).toContain('counter.onclick');
    expect((await fetch(new URL('play/resource.svg', session.url))).status).toBe(200);
    expect((await fetch(new URL('/api/library', session.url))).status).toBe(404);
    expect((await fetch(new URL('/api/library', session.url), { method: 'PUT' })).status).toBe(403);
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: session.viewport });
      await page.goto(session.url);
      const counter = page.frameLocator('iframe').locator('#counter');
      await counter.click();
      expect(await counter.textContent()).toBe('1');
      await session.close();
      await page.locator('iframe').waitFor({ state: 'detached' });
      expect(await page.locator('body').textContent()).toBe('预览已结束');
    } finally { await browser.close(); }
  } finally { await session.close(); }
  await expect(fetch(session.url)).rejects.toThrow();
}, 20000);

it('captures actual pixels and motion frames, then releases the browser, server and preview slot', async () => {
  const before = createHash('sha256').update(fs.readFileSync(path.join(library, 'library.db'))).digest('hex');
  const child = spawn(process.execPath, [cli, 'preview', 'sample', '--library', library, '--duration', '400', '--width', '360', '--height', '300', '--json'], {
    env: { ...process.env, CEA_CONFIG_DIR: path.join(root, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const timer = setTimeout(() => child.kill(), 25000);
  try {
    await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'config/cache/previews/active.lock'))).toBe(true), { timeout: 5000, interval: 20 });
    const concurrent = spawnSync(process.execPath, [cli, 'preview', 'sample', '--library', library, '--json'], {
      env: { ...process.env, CEA_CONFIG_DIR: path.join(root, 'config') }, encoding: 'utf8', timeout: 5000,
    });
    expect(concurrent.status).toBe(1);
    expect(JSON.parse(concurrent.stdout).error.message).toContain('已有 AI 预览');
    const code = await new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
    expect(code, stderr || stdout).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ ok: true, mode: 'capture', samples: 4, video: null, deviceScaleFactor: 1, errors: [] });
    for (const file of [result.screenshot, result.filmstrip]) {
      expect(fs.readFileSync(file).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(fs.statSync(file).size).toBeGreaterThan(1000);
    }
    expect(fs.existsSync(path.join(root, 'config/cache/previews/active.lock'))).toBe(false);
    expect(createHash('sha256').update(fs.readFileSync(path.join(library, 'library.db'))).digest('hex')).toBe(before);
  } finally { clearTimeout(timer); }
}, 30000);
