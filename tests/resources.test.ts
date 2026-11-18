import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { Library } from '../server/library.ts';
import { createApp } from '../server/app.ts';
import { bundle } from '../server/bundler.ts';
import { folderFiles, parseFolderFiles } from '../server/transfer/folder.ts';
import { exportLibrary, exportReferencePackage, importPackage, parsePackage } from '../server/transfer/zip.ts';
import { buildReplicaPrompt, buildSource } from '../shared/prompt.ts';
import { listenForFetch } from './helpers/http.ts';

const bytes = new Uint8Array([137, 80, 78, 71, 255, 0, 254, 128, 42]);
const opened: Library[] = [];
const dirs: string[] = [];
function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-resources-'));
  dirs.push(dir);
  const lib = Library.open(dir);
  opened.push(lib);
  return lib;
}

function fixture(internal = false) {
  const prefix = internal ? 'code/' : '';
  return parseFolderFiles({
    'asset.json': strToU8(JSON.stringify({ id: 'stable-id', title: 'Local art', dependencies: { html: { gsap: '^3.15.0' } } })),
    [`${prefix}html/markup.html`]: strToU8('<img src="./resources/art.png" alt="Art">'),
    [`${prefix}html/script.mjs`]: strToU8('import { gsap } from "gsap"; document.body.dataset.motion = gsap.version;'),
    [`${prefix}html/resources/art.png`]: bytes,
    [`${prefix}html/resources/type.woff2`]: bytes,
    [`${prefix}vue/Component.vue`]: strToU8('<script setup>import image from "./resources/art.png";</script><template><img :src="image" alt="Art"></template>'),
    [`${prefix}vue/resources/art.png`]: bytes,
  }, 'different-folder-name');
}

function seed(lib: Library) {
  const pkg = fixture();
  expect(pkg.problems).toEqual([]);
  importPackage(lib, pkg, 'skip');
  return lib.getAsset('stable-id');
}

afterEach(() => {
  for (const lib of opened.splice(0)) lib.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('implementation resources', () => {
  it('preserves a separate preview entry through editing and all package formats', async () => {
    const lib = open();
    const asset = seed(lib);
    const variant = asset.variants.find(v => v.framework === 'vue')!;
    variant.previewEntry = 'Preview.vue';
    variant.files.push({ path: 'Preview.vue', content: '<script setup>import Artwork from "./Component.vue";</script><template><section data-demo-only><Artwork /></section></template>' });
    const updated = lib.updateAsset(asset.id, asset);
    expect(updated.variants[1].entry).toBe('Component.vue');
    expect(updated.variants[1].previewEntry).toBe('Preview.vue');
    for (const pkg of [parsePackage(exportLibrary(lib)), parseFolderFiles(folderFiles(lib)), parseFolderFiles(unzipSync(exportReferencePackage(lib, asset.id)))]) {
      const restored = open();
      importPackage(restored, pkg, 'skip');
      expect(restored.getAsset(asset.id).variants[1].previewEntry).toBe('Preview.vue');
    }
    expect(() => lib.updateAsset(asset.id, { ...updated, variants: [{ ...variant, previewEntry: 'Missing.vue' }] })).toThrow(/预览入口/);
    const dependencyRoot = path.join(lib.root, '.runtime');
    const moduleDir = path.join(dependencyRoot, 'node_modules', 'fixture-helper');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({ name: 'fixture-helper', type: 'module', exports: './index.js' }));
    fs.writeFileSync(path.join(moduleDir, 'index.js'), 'export const label = "external-library-dependency";');
    const compiled = await bundle('react', 'external-dependency', [
      { path: 'Component.jsx', content: 'import {label} from "fixture-helper"; export default function Component(){return <b>{label}</b>}' },
    ], 'Component.jsx', [], dependencyRoot);
    expect(compiled.error).toBeNull();
    expect(compiled.code).toContain('external-library-dependency');
  });

  it.each([false, true])('imports binary bytes separately from text, internal layout=%s', internal => {
    const lib = open();
    const pkg = fixture(internal);
    expect(pkg.problems).toEqual([]);
    importPackage(lib, pkg, 'skip');
    const asset = lib.getAsset('stable-id');
    expect(asset.variants[0].files.map(f => f.path)).not.toContain('resources/art.png');
    expect(asset.variants[0].resources).toEqual([
      { path: 'resources/art.png', mime: 'image/png', size: bytes.length },
      { path: 'resources/type.woff2', mime: 'font/woff2', size: bytes.length },
    ]);
    expect(fs.readFileSync(lib.getPlaybackFile(asset.id, 'html', 'resources/art.png').abs)).toEqual(Buffer.from(bytes));
    expect(JSON.stringify(asset)).not.toContain(Buffer.from(bytes).toString('base64'));
    expect(asset.media).toEqual([]);
  });

  it('folder resources retain the correct package location when IDs and wrapper names differ', () => {
    const lib = open();
    const original = fixture();
    const files = Object.fromEntries(Object.entries(original.files).map(([p, data]) => [`outer/folder/${p}`, data]));
    const pkg = parseFolderFiles(files, 'bundle');
    expect(pkg.problems).toEqual([]);
    importPackage(lib, pkg, 'skip');
    expect(fs.readFileSync(lib.getPlaybackFile('stable-id', 'vue', 'resources/art.png').abs)).toEqual(Buffer.from(bytes));
  });

  it('editing and old-client updates retain resources; explicit removal removes only the selected resources', () => {
    const lib = open();
    const asset = seed(lib);
    const variants = asset.variants.map(({ resources: _, ...variant }) => variant);
    const updated = lib.updateAsset(asset.id, { ...asset, title: 'Renamed', variants });
    expect(updated.variants[0].resources).toEqual(asset.variants[0].resources);
    expect(fs.readFileSync(lib.getPlaybackFile(asset.id, 'html', 'resources/art.png').abs)).toEqual(Buffer.from(bytes));
    const removed = lib.updateAsset(asset.id, { ...updated, variants: updated.variants.map(v => ({ ...v, resources: [] })) });
    expect(removed.variants[0].resources).toBeUndefined();
    expect(() => lib.getPlaybackFile(asset.id, 'html', 'resources/art.png')).toThrow(/不存在/);
  });

  it('rejects missing files, unsafe paths and duplicate paths without replacing the saved source', () => {
    const lib = open();
    const asset = seed(lib);
    const resource = { path: 'resources/missing.png', mime: 'image/png', size: 1 };
    expect(() => lib.updateAsset(asset.id, { ...asset, variants: [{ ...asset.variants[0], resources: [resource] }] })).toThrow(/丢失/);
    expect(lib.getAsset(asset.id)).toEqual(asset);
    expect(() => lib.updateAsset(asset.id, { ...asset, variants: [{ ...asset.variants[0], resources: [{ ...resource, path: '../evil.png' }] }] })).toThrow(/不合法/);
    expect(() => lib.updateAsset(asset.id, { ...asset, variants: [{ ...asset.variants[0], resources: [resource, resource] }] })).toThrow(/重复/);
    expect(() => lib.updateAsset(asset.id, { ...asset, variants: [{ ...asset.variants[0], files: [...asset.variants[0].files, { path: 'bad.webp', content: 'not binary' }] }] })).toThrow(/资源文件导入/);
    expect(fs.readFileSync(lib.getPlaybackFile(asset.id, 'html', 'resources/art.png').abs)).toEqual(Buffer.from(bytes));
    const broken = fixture();
    delete broken.files['html/resources/art.png'];
    expect(() => importPackage(lib, broken, 'overwrite')).toThrow(/丢失/);
    expect(lib.getAsset(asset.id)).toEqual(asset);
  });

  it('backup, folder export and reference packages preserve resources, dependencies and editable source', () => {
    const lib = open();
    const asset = seed(lib);
    const source = buildSource(asset, 'html');
    expect(source).toContain('<!-- index.html -->');
    expect(source).toContain('<script type="module" src="./script.mjs"></script>');
    expect(source).toContain('import { gsap } from "gsap"');
    for (const pkg of [parsePackage(exportLibrary(lib)), parseFolderFiles(folderFiles(lib)), parseFolderFiles(unzipSync(exportReferencePackage(lib, asset.id)))]) {
      const target = open();
      importPackage(target, pkg, 'skip');
      expect(target.getAsset(asset.id).variants).toEqual(asset.variants);
      expect(fs.readFileSync(target.getPlaybackFile(asset.id, 'html', 'resources/type.woff2').abs)).toEqual(Buffer.from(bytes));
    }
    const zip = unzipSync(exportReferencePackage(lib, asset.id));
    expect(zip['code/html/resources/art.png']).toEqual(bytes);
    expect(strFromU8(zip['source.html'])).toContain('<base href="./code/html/">');
    expect(JSON.parse(strFromU8(zip['code/html/package.json'])).dependencies).toEqual({ gsap: '^3.15.0' });
    const prompt = buildReplicaPrompt(asset, { framework: 'html', locale: 'zh' });
    expect(prompt).toContain('资源文件');
    expect(prompt).toContain('resources/art.png');
    expect(prompt).toContain('gsap@^3.15.0');
    expect(prompt).toContain('import { gsap } from "gsap"');
    expect(prompt).not.toContain('base64');
    expect(prompt.length).toBeLessThan(2000);
  });

  it('serves saved and draft binary files losslessly without rereading all source files', async () => {
    const lib = open();
    seed(lib);
    const { server, base } = await listenForFetch(createApp({ lib }));
    try {
      const playback = vi.spyOn(lib, 'getPlayback');
      const alias = await fetch(`${base}/play/stable-id/?thumbnail=1&active=0&v=revision`, { redirect: 'manual' });
      expect(alias.status).toBe(307);
      expect(alias.headers.get('location')).toBe('/play/stable-id/html/?thumbnail=1&active=0&v=revision');
      expect(alias.headers.get('cache-control')).toBe('no-store');
      expect(playback).not.toHaveBeenCalled();
      const canonical = await fetch(`${base}/play/stable-id/?thumbnail=1&active=0`);
      expect(canonical.url).toBe(`${base}/play/stable-id/html/?thumbnail=1&active=0`);
      expect(playback).toHaveBeenCalledTimes(1);
      playback.mockClear();
      const imageURL = new URL('./resources/art.png', canonical.url);
      expect(new Uint8Array(await (await fetch(imageURL)).arrayBuffer())).toEqual(bytes);
      const response = await fetch(`${base}/play/stable-id/html/resources/art.png`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(playback).not.toHaveBeenCalled();
      expect((await fetch(`${base}/play/stable-id/html/resources/art.png`, { cache: 'force-cache', headers: { 'if-none-match': response.headers.get('etag')! } })).status).toBe(304);
      expect((await fetch(`${base}/play/stable-id/html/library.db`)).status).toBe(404);
      const asset = lib.getAsset('stable-id');
      const draftResponse = await fetch(`${base}/api/play/draft`, { method: 'POST', headers: { 'x-cea-client': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, title: asset.title, ...asset.variants[0] }) });
      expect(draftResponse.status).toBe(200);
      const draft = await draftResponse.json();
      expect(new Uint8Array(await (await fetch(base + draft.url + 'resources/art.png')).arrayBuffer())).toEqual(bytes);
      const page = await (await fetch(base + draft.url)).text();
      expect(page).toContain('cea:ready');
      expect(page).toContain('3.15.0');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('bundles imported images, nested CSS URLs and HTML ES modules using the existing compiler', async () => {
    const resources = [{ path: 'resources/art.png', mime: 'image/png', size: 9 }, { path: 'resources/art #2.png', mime: 'image/png', size: 9 }];
    const vue = await bundle('vue', 'resource-vue', [
      { path: 'Component.vue', content: '<script setup>import image from "./resources/art.png";import "./nested/style.css";</script><template><img :src="image"></template><style scoped>.art { background: url("./resources/art.png"); }</style>' },
      { path: 'nested/style.css', content: '.art { background: url("../resources/art.png?v=1#art"); }' },
    ], 'Component.vue', resources);
    expect(vue.error).toBeNull();
    expect(vue.code).toContain('./resources/art.png');
    expect(vue.code).toContain('./resources/art.png?v=1#art');
    const html = await bundle('html', 'resource-html', [
      { path: 'script.mjs', content: 'import image from "./resources/art.png";document.querySelector("img").src=image;' },
    ], 'script.mjs', resources);
    expect(html.error).toBeNull();
    expect(html.code).toContain('./resources/art.png');
    const absent = await bundle('html', 'missing', [{ path: 'script.mjs', content: 'import image from "./missing.png";console.log(image);' }], 'script.mjs');
    expect(absent.error).toContain('missing.png');
    const encoded = await bundle('html', 'resource-encoded', [
      { path: 'script.mjs', content: 'import image from "./resources/art #2.png";document.querySelector("img").src=image;' },
    ], 'script.mjs', resources);
    expect(encoded.error).toBeNull();
    expect(encoded.code).toContain('./resources/art%20%232.png');
  }, 30_000);
});
