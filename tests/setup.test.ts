import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type AppState } from '../server/app.ts';
import { readConfig, rememberLibrary, resolveLibraryPath } from '../server/config.ts';
import { Library } from '../server/library.ts';
import { listenForFetch } from './helpers/http.ts';

let root: string;
let server: Server | undefined;
let state: AppState;
let base: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-setup-'));
  vi.stubEnv('CEA_CONFIG_DIR', path.join(root, 'config'));
  vi.stubEnv('CEA_LIBRARY', '');
  state = { lib: null };
});

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  state.lib?.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cea-setup-')) throw new Error('Unexpected test path');
  fs.rmSync(root, { recursive: true, force: true });
});

async function start() {
  ({ server, base } = await listenForFetch(createApp(state)));
}

function select(target: string) {
  return fetch(base + '/api/library', {
    method: 'PUT',
    headers: { 'x-cea-client': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  });
}

it('未配置时不猜测位置，也不创建素材库或配置文件', () => {
  expect(resolveLibraryPath([])).toBeNull();
  expect(fs.readdirSync(root)).toEqual([]);
});

function launch() {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../server/main.ts', import.meta.url).href)}); setTimeout(() => process.emit("SIGTERM"), 50);`], {
    cwd: process.cwd(),
    env: { ...process.env, CEA_PORT: '0' },
    encoding: 'utf8', timeout: 10_000,
  });
}

it('全新配置可以启动服务，退出后仍未创建默认素材库', () => {
  const process = launch();
  expect(process.error).toBeUndefined();
  expect(process.status).toBe(0);
  expect(process.stdout).toContain('首次使用：请在页面中选择素材库位置');
  expect(fs.readdirSync(root)).toEqual([]);
});

it('已保存的库随启动恢复，失效位置不重新创建为空库', () => {
  const target = path.join(root, 'existing');
  const lib = Library.open(target);
  lib.close();
  rememberLibrary(target);
  const opened = launch();
  expect(opened.status).toBe(0);
  expect(opened.stdout).toContain(`素材库目录：${target}`);
  fs.renameSync(target, path.join(root, 'moved'));
  const missing = launch();
  expect(missing.status).toBe(0);
  expect(missing.stdout).toContain('首次使用');
  expect(fs.existsSync(target)).toBe(false);
  expect(readConfig().libraryPath).toBe(target);
});

it('显式参数、环境变量和已保存位置按优先级解析', () => {
  rememberLibrary(path.join(root, 'saved'));
  expect(resolveLibraryPath([])).toEqual({ path: path.join(root, 'saved'), fromConfig: true });
  vi.stubEnv('CEA_LIBRARY', path.join(root, 'env'));
  expect(resolveLibraryPath([])?.path).toBe(path.join(root, 'env'));
  expect(resolveLibraryPath(['--library', path.join(root, 'argument')])?.path).toBe(path.join(root, 'argument'));
  expect(() => resolveLibraryPath(['--library'])).toThrow('需要填写');
  expect(() => resolveLibraryPath(['--library', '--serve-dist'])).toThrow('需要填写');
});

it('未配置时可以读取状态和浏览目录，数据接口返回明确提示', async () => {
  await start();
  expect(await (await fetch(base + '/api/library')).json()).toBeNull();
  const folders = await fetch(base + '/api/fs?path=' + encodeURIComponent(root));
  expect(folders.status).toBe(200);
  const assets = await fetch(base + '/api/assets');
  expect(assets.status).toBe(409);
  expect(await assets.json()).toEqual({ error: '请先选择素材库位置' });
  expect(fs.readdirSync(root)).toEqual([]);
});

it('用户确认后创建空库，保存位置，重复选择不关闭正在使用的库', async () => {
  await start();
  const target = path.join(root, 'chosen');
  const response = await select(target);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ path: target, assetCount: 0 });
  expect(readConfig().libraryPath).toBe(target);
  const active = state.lib;
  expect((await select(target)).status).toBe(200);
  expect(state.lib).toBe(active);
  expect(state.lib?.listAssets()).toEqual([]);
});

it('已有库可直接打开，保留组件和来源字段', async () => {
  const target = path.join(root, 'existing');
  const lib = Library.open(target);
  let id: string;
  try {
    id = lib.createAsset({
      title: 'Existing', tags: [], categoryId: null, texts: {},
      variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [{ path: 'markup.html', content: '<p>Test</p>' }] }],
      sourceName: 'Original author', sourceUrl: 'https://example.com/original',
    }).id;
  } finally { lib.close(); }
  await start();
  expect((await select(target)).status).toBe(200);
  expect(state.lib?.getAsset(id)).toMatchObject({ sourceName: 'Original author', sourceUrl: 'https://example.com/original' });
});

it('拒绝普通非空目录和相对路径，原文件不变', async () => {
  await start();
  const target = path.join(root, 'occupied');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'notes.txt'), 'keep');
  expect((await select(target)).status).toBe(400);
  expect((await select('relative-folder')).status).toBe(400);
  expect(state.lib).toBeNull();
  expect(fs.readdirSync(target)).toEqual(['notes.txt']);
  expect(fs.readFileSync(path.join(target, 'notes.txt'), 'utf8')).toBe('keep');
});

it('配置写入失败时不替换当前库，仍能读取原来的内容', async () => {
  await start();
  expect((await select(path.join(root, 'first'))).status).toBe(200);
  const active = state.lib;
  const write = fs.writeFileSync;
  vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
    if (String(args[0]) === path.join(root, 'config', 'config.json')) throw new Error('test: config unavailable');
    return write(...args);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await select(path.join(root, 'second'))).status).toBe(500);
  expect(state.lib).toBe(active);
  expect(state.lib?.listAssets()).toEqual([]);
});
