import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Library } from '../server/library.ts';

const cli = fileURLToPath(new URL('../server/cli.ts', import.meta.url));
let root: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-cli-'));
  environment = { ...process.env, CEA_CONFIG_DIR: path.join(root, 'config'), CEA_LIBRARY: '' };
});
afterEach(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('cea-cli-')) throw new Error('Unexpected test path');
  fs.rmSync(root, { recursive: true, force: true });
});

function run(args: string[], status = 0, script = cli) {
  const result = spawnSync(process.execPath, [script, ...args, '--json'], {
    cwd: root, env: environment, encoding: 'utf8', timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(status);
  return JSON.parse(result.stdout);
}

function library(name: string, count = 1) {
  const directory = path.join(root, name);
  const lib = Library.open(directory);
  try {
    for (let i = 0; i < count; i++) lib.createAsset({
      id: `component-${i}`, title: `${name} Weather ${String(i).padStart(3, '0')}`, categoryId: null,
      tags: ['Weather'], sourceName: '', sourceUrl: '', texts: { fr: { summary: 'Météo', idea: 'Prévisions' } },
      variants: [
        { framework: 'html', entry: 'markup.html', dependencies: {}, files: [{ path: 'markup.html', content: `<p>${name}</p>` }],
          resources: [{ path: 'image.png', mime: 'image/png', size: 3 }] },
        { framework: 'react', entry: 'Component.tsx', dependencies: {}, files: [{ path: 'Component.tsx', content: `export default function Component(){return <p>${name}</p>}` }] },
      ],
    }, { resourceData: { 'html/image.png': new Uint8Array([1, 2, 3]) } });
    return { directory, id: lib.libraryId };
  } finally { lib.close(); }
}

function componentPackage(name = 'incoming') {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'asset.json'), JSON.stringify({ id: name, title: name, category: null, tags: [] }));
  fs.writeFileSync(path.join(directory, 'index.html'), '<p>Imported component</p>');
  return directory;
}

it('discovers from any working directory and never creates a missing library during reads', () => {
  expect(run(['library', 'list']).libraries).toEqual([]);
  const missing = path.join(root, 'missing');
  expect(run(['search', '--library', missing], 1).ok).toBe(false);
  expect(run(['guide', '--library', missing]).warning).toBeTruthy();
  expect(fs.existsSync(missing)).toBe(false);
  expect(fs.existsSync(path.join(root, 'config'))).toBe(false);
  expect(run(['--unknown'], 1)).toMatchObject({ ok: false, error: { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' } });
}, 20_000);

it('registers explicitly, grants writes separately, and cannot bypass read-only through a path', () => {
  const source = library('Personal');
  const registered = run(['library', 'add', source.directory, '--alias', 'personal']);
  expect(registered.library).toMatchObject({ id: source.id, access: 'read' });
  const input = componentPackage();
  expect(run(['import', input, '--library', source.directory], 1).error.message).toContain('只读');
  expect(run(['import', input, '--library', 'personal', '--dry-run'])).toMatchObject({ valid: true, dryRun: true, result: null });
  const readonly = Library.openExisting(source.directory);
  try { expect(readonly.repo.countAssets()).toBe(1); expect(() => readonly.repo.setFavorite('component-0', true)).toThrow(); }
  finally { readonly.close(); }
  expect(run(['library', 'set', 'personal', '--access', 'write']).library.access).toBe('write');
  expect(run(['import', input, '--library', 'personal']).result.created).toBe(1);
  expect(run(['import', input, '--library', 'personal']).result.skipped).toBe(1);
  expect(run(['import', input, '--library', 'personal', '--copy']).result.copied).toBe(1);
  expect(run(['import', input, '--library', 'personal', '--overwrite']).result.overwritten).toBe(1);
  expect(run(['import', input, '--library', 'personal', '--copy', '--overwrite'], 1).ok).toBe(false);
}, 20_000);

it('pages across libraries without mixing duplicate asset IDs or loading source files', () => {
  const a = library('A', 27);
  const b = library('B', 8);
  run(['library', 'add', a.directory, '--alias', 'a']);
  run(['library', 'add', b.directory, '--alias', 'b']);
  fs.unlinkSync(path.join(a.directory, 'assets/component-0/code/html/markup.html'));
  const first = run(['search', 'Weather', '--all-libraries', '--sort', 'title', '--limit', '20']);
  const second = run(['search', 'Weather', '--all-libraries', '--sort', 'title', '--limit', '20', '--page', '2']);
  expect(first).toMatchObject({ complete: true, total: 35, limit: 20 });
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(15);
  expect(second.items.filter((item: { libraryId: string }) => item.libraryId === b.id)).toHaveLength(8);
  expect(JSON.stringify(first)).not.toContain('content');
  expect(run(['show', 'component-0', '--library', 'a', '--framework', 'react']).asset.variants[0].files[0].content).toContain('<p>A</p>');
  expect(run(['show', 'component-0', '--library', 'b', '--framework', 'html']).asset.variants[0].files[0].content).toContain('<p>B</p>');
  expect(run(['show', 'component-0', '--library', 'a', '--metadata-only']).asset.texts.fr.summary).toBe('Météo');
  expect(run(['search', '--all-libraries', '--library', 'a'], 1).ok).toBe(false);
  expect(run(['search', '--limit', '61'], 1).ok).toBe(false);
  expect(run(['search'], 1).error.message).toContain('多个');
  expect(run(['import', componentPackage()], 1).error.message).toContain('多个');
}, 20_000);

it('keeps identity across a move and reports unavailable libraries as partial search failures', () => {
  const a = library('Original');
  const b = library('Other');
  run(['library', 'add', a.directory, '--alias', 'personal']);
  run(['library', 'add', b.directory, '--alias', 'other']);
  const moved = path.join(root, 'Moved');
  fs.renameSync(a.directory, moved);
  expect(run(['library', 'list']).libraries.find((entry: { alias: string }) => entry.alias === 'personal').available).toBe(false);
  expect(run(['search', '--all-libraries'], 1)).toMatchObject({ ok: false, complete: false, total: 1 });
  expect(run(['library', 'relink', 'personal', b.directory], 1).ok).toBe(false);
  expect(run(['library', 'relink', 'personal', moved]).library.id).toBe(a.id);
  expect(run(['search', '--library', a.id]).total).toBe(1);
  expect(run(['library', 'remove', 'personal']).filesDeleted).toBe(false);
  expect(fs.existsSync(path.join(moved, 'library.db'))).toBe(true);
}, 20_000);

it('rejects an invalid mixed package before writing any of its valid components', () => {
  const target = library('Target');
  const input = path.join(root, 'mixed');
  fs.mkdirSync(path.join(input, 'good'), { recursive: true });
  fs.writeFileSync(path.join(input, 'good', 'index.html'), '<p>Good</p>');
  fs.mkdirSync(path.join(input, 'bad'));
  fs.writeFileSync(path.join(input, 'bad', 'asset.json'), '{ invalid JSON');
  run(['library', 'add', target.directory, '--alias', 'target', '--access', 'write']);
  expect(run(['check', input, '--library', 'target'], 1)).toMatchObject({ ok: false, valid: false });
  expect(run(['import', input, '--library', 'target'], 1)).toMatchObject({ ok: false, valid: false, result: null });
  const lib = Library.openExisting(target.directory);
  try { expect(lib.repo.countAssets()).toBe(1); }
  finally { lib.close(); }
}, 20_000);

it('initializes explicitly and preserves indexed binary resources in show and export', () => {
  const directory = path.join(root, 'New Library');
  expect(run(['library', 'init', directory, '--alias', 'new']).library.access).toBe('read');
  const target = library('Resources');
  run(['library', 'add', target.directory, '--alias', 'resources']);
  const detail = run(['show', 'component-0', '--library', 'resources', '--framework', 'html']);
  expect(detail.asset.resources[0]).toMatchObject({ mime: 'image/png', size: 3 });
  expect(fs.readFileSync(detail.asset.resources[0].absolutePath)).toEqual(Buffer.from([1, 2, 3]));
  fs.mkdirSync(path.join(root, 'exports'));
  const exported = run(['export', path.join(root, 'exports'), 'component-0', '--library', 'resources']);
  expect(fs.existsSync(exported.path)).toBe(true);
  const checked = run(['check', exported.path, '--library', 'new']);
  expect(checked).toMatchObject({ valid: true, preview: { assetCount: 1 } });
}, 20_000);

it('blocks secret files, rejects replaced library identities and preserves corrupt registry files', () => {
  const target = library('Target');
  run(['library', 'add', target.directory, '--alias', 'target', '--access', 'write']);
  const input = componentPackage();
  fs.writeFileSync(path.join(input, '.env.local'), 'SECRET=fixture');
  expect(run(['import', input, '--library', 'target'], 1).error.message).toContain('.env.local');
  const markerPath = path.join(target.directory, 'library.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  fs.writeFileSync(markerPath, JSON.stringify({ ...marker, libraryId: 'replacement-library-id' }));
  expect(run(['search', '--library', 'target'], 1).error.message).toContain('ID');
  expect(run(['library', 'list']).libraries[0].available).toBe(false);
  const registryPath = path.join(root, 'config/libraries.json');
  fs.writeFileSync(registryPath, '{ broken registry');
  expect(run(['library', 'list'], 1).error.message).toContain('注册表');
  expect(fs.readFileSync(registryPath, 'utf8')).toBe('{ broken registry');
}, 20_000);
