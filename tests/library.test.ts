import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { normalizeRelPath } from '../shared/paths.ts';
import { buildIdeaPrompt, buildReplicaPrompt, buildSource, parseReplicaPrompt } from '../shared/prompt.ts';
import type { AssetInput, Variant } from '../shared/types.ts';
import { codeNotes } from '../shared/notes.ts';
import { migrate } from '../server/db/schema.ts';
import { Library } from '../server/library.ts';
import { seedTestLibrary } from './helpers/library.ts';
import { bundle } from '../server/bundler.ts';
import { exportLibrary, exportReferencePackage, importPackage, parsePackage, previewImport } from '../server/transfer/zip.ts';
import { folderFiles, parseFolderFiles } from '../server/transfer/folder.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const temps: string[] = [];
const opened: Library[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-test-'));
  temps.push(dir);
  return dir;
}

function open(dir: string) {
  const lib = Library.open(dir);
  opened.push(lib);
  return lib;
}

const html = (markup = '<button class="b">OK</button>', style = 'button { color: red }', script = ''): Variant => ({
  framework: 'html',
  entry: 'markup.html',
  dependencies: {},
  files: [
    { path: 'markup.html', content: markup },
    { path: 'style.css', content: style },
    { path: 'script.js', content: script },
  ],
});

const react: Variant = {
  framework: 'react',
  entry: 'Button.tsx',
  dependencies: { motion: '^12' },
  files: [{ path: 'Button.tsx', content: 'export default function Button() { return <button>OK</button>; }' }],
};

/** 样式里写了暗色规则的 React 实现 */
const darkReact: Variant = {
  ...react,
  files: [...react.files, { path: 'style.css', content: 'button { color: #111; }\nhtml[data-theme="dark"] button { color: #eee; }' }],
};

function input(overrides: Partial<AssetInput> = {}): AssetInput {
  return {
    title: 'Press Button',
    categoryId: null,
    tags: ['按钮', '动效'],
    sourceUrl: '',
    sourceName: '',
    texts: {
      en: { summary: 'A button that presses in.', idea: 'Build a button that shrinks on press.' },
      zh: { summary: '按下会缩小的按钮。', idea: '做一个按下会缩小的按钮。' },
    },
    variants: [html()],
    ...overrides,
  };
}

afterEach(() => {
  for (const lib of opened.splice(0)) {
    try { lib.close(); } catch { /* 已关闭 */ }
  }
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('路径校验', () => {
  it('拒绝越界和绝对路径', () => {
    expect(normalizeRelPath('a/b.css')).toBe('a/b.css');
    expect(normalizeRelPath('a\\b.css')).toBe('a/b.css');
    expect(normalizeRelPath('../x')).toBeNull();
    expect(normalizeRelPath('a/../../x')).toBeNull();
    expect(normalizeRelPath('C:/Windows')).toBeNull();
    expect(normalizeRelPath('\\\\server\\share')).toBeNull();
    expect(normalizeRelPath('a/con?.txt')).toBeNull();
  });
});

describe('素材库', () => {
  it('宽幅画布保存在摘要中，旧客户端更新时保留，选择自适应可清除', () => {
    const lib = open(tempDir());
    const viewport = { width: 1200, height: 720 };
    const a = lib.createAsset(input({ previewViewport: viewport }));
    expect(a.previewViewport).toEqual(viewport);
    expect(lib.listAssets()[0].previewViewport).toEqual(viewport);
    expect(lib.updateAsset(a.id, input()).previewViewport).toEqual(viewport);
    expect(lib.updateAsset(a.id, input({ previewViewport: null })).previewViewport).toBeUndefined();
    expect(() => lib.updateAsset(a.id, input({ previewViewport: { width: NaN, height: 720 } }))).toThrow(/有效的宽度和高度/);
  });
  it('默认缩放保存在详情和列表中，更新旧客户端字段时保留设置', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ previewScale: 1.25 }));
    expect(a.previewScale).toBe(1.25);
    expect(lib.listAssets()[0].previewScale).toBe(1.25);
    expect(lib.updateAsset(a.id, input()).previewScale).toBe(1.25);
    expect(lib.updateAsset(a.id, input({ previewScale: 20 })).previewScale).toBe(3);
    expect(lib.updateAsset(a.id, input({ previewScale: 1 })).previewScale).toBeUndefined();
    expect(() => lib.updateAsset(a.id, input({ previewScale: 'bad' as unknown as number }))).toThrow(/有效数字/);
  });

  it('暗色能力按代码判断：写了 [data-theme="dark"] 或 .dark 规则才算，手动传的值不作数', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ variants: [
      html('<button>OK</button>', '.dark button { color: white; }'),
      { ...react, supportsDarkMode: true },
    ] }));
    expect(a.variants[0].supportsDarkMode).toBe(true);
    expect(a.variants[1].supportsDarkMode).toBeUndefined();
    const updated = lib.updateAsset(a.id, input({ variants: [darkReact] }));
    expect(updated.variants[0].supportsDarkMode).toBe(true);
  });

  it('v2 数据库升级后默认不提供暗色模式，原有实现和文件保留', () => {
    const root = tempDir();
    const db = new DatabaseSync(path.join(root, 'library.db'));
    migrate(db, root, 2);
    db.prepare(`insert into assets(id,title,type,created_at,updated_at) values ('old','Old','component','2026','2026')`).run();
    db.prepare(`insert into variants(asset_id,framework,entry) values ('old','html','markup.html')`).run();
    migrate(db, root);
    expect(db.prepare('select supports_dark_mode from variants').get()).toMatchObject({ supports_dark_mode: 0 });
    expect(db.prepare('select title from assets').get()).toMatchObject({ title: 'Old' });
    db.close();
  });

  it('重启后数据保留，整个目录移动后仍可打开', () => {
    const dir = path.join(tempDir(), 'lib');
    const lib = open(dir);
    const category = lib.createCategory('按钮');
    const asset = lib.createAsset(input({ categoryId: category.id, variants: [html(), react] }));
    lib.setFavorite(asset.id, true);
    lib.addMedia(asset.id, 'cover.png', PNG, '静止状态');
    lib.close();

    const moved = path.join(tempDir(), 'moved-lib');
    fs.renameSync(dir, moved);
    const reopened = open(moved);
    const detail = reopened.getAsset(asset.id);
    expect(detail.title).toBe('Press Button');
    expect(detail.favorite).toBe(true);
    expect(detail.categoryId).toBe(category.id);
    expect(detail.tags).toEqual(['按钮', '动效']);
    expect(detail.cover).toBe(`assets/${asset.id}/media/cover.png`);
    expect(detail.frameworks).toEqual(['html', 'react']);
    expect(detail.texts.zh.idea).toBe('做一个按下会缩小的按钮。');
    expect(detail.variants[1].dependencies).toEqual({ motion: '^12' });
    expect(fs.existsSync(path.join(moved, 'assets', asset.id, 'code', 'react', 'Button.tsx'))).toBe(true);
    expect(fs.existsSync(reopened.resolve(detail.cover!)!)).toBe(true);
  });

  it('不会把非空的普通目录当成素材库', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    expect(() => Library.open(dir)).toThrow(/不是空目录/);
    expect(Library.check(dir)).toBe('occupied');
  });

  it('列表带上标签、框架、各语言简介和搜索文本', () => {
    const lib = open(tempDir());
    lib.createAsset(input({ title: '点赞', tags: ['粒子'], texts: { zh: { summary: '', idea: '点击后撒出粒子' } }, variants: [html(), react] }));
    const [a] = lib.listAssets();
    expect(a.tags).toEqual(['粒子']);
    expect(a.frameworks).toEqual(['html', 'react']);
    expect(a.locales).toEqual(['zh']);
    expect(a.searchText).toContain('撒出');
  });

  it('更新代码时移除旧文件和旧框架，删除素材时清理目录', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ variants: [html(), react] }));
    lib.updateAsset(a.id, input({ variants: [{ ...html('<p>v2</p>'), files: [...html('<p>v2</p>').files, { path: 'extra.svg', content: '<svg/>' }] }] }));
    lib.updateAsset(a.id, input({ variants: [html('<p>v3</p>')] }));
    const detail = lib.getAsset(a.id);
    expect(detail.frameworks).toEqual(['html']);
    expect(detail.variants[0].files.find(f => f.path === 'markup.html')?.content).toBe('<p>v3</p>');
    expect(fs.existsSync(path.join(lib.root, 'assets', a.id, 'code', 'html', 'extra.svg'))).toBe(false);
    expect(fs.existsSync(path.join(lib.root, 'assets', a.id, 'code', 'react'))).toBe(false);
    lib.deleteAsset(a.id);
    expect(fs.existsSync(path.join(lib.root, 'assets', a.id))).toBe(false);
  });

  it('校验文件名、ID、框架、语言和入口文件', () => {
    const lib = open(tempDir());
    expect(() => lib.createAsset(input({ variants: [{ ...html(), files: [{ path: '../evil.js', content: '' }] }] }))).toThrow(/不合法/);
    expect(() => lib.createAsset(input({ id: 'Bad ID' }))).toThrow(/小写字母/);
    expect(() => lib.createAsset(input({ variants: [html('')] }))).toThrow(/markup\.html/);
    expect(() => lib.createAsset(input({ variants: [{ ...react, entry: 'Missing.tsx' }] }))).toThrow(/入口/);
    expect(() => lib.createAsset(input({ variants: [{ ...react, framework: 'svelte' }] }))).toThrow(/不支持的框架/);
    expect(() => lib.createAsset(input({ variants: [html(), html()] }))).toThrow(/重复/);
    expect(() => lib.createAsset(input({ texts: { 'invalid_locale!': { summary: 'x', idea: '' } } }))).toThrow(/语言代码无效/);
    expect(() => lib.createAsset(input({ variants: [] }))).toThrow(/至少需要一种实现/);
  });

  it('素材 ID 根据名称生成，可读且唯一', () => {
    const lib = open(tempDir());
    expect(lib.createAsset(input({ title: 'Weather Day Switcher' })).id).toBe('weather-day-switcher');
    expect(lib.createAsset(input({ title: 'Weather Day Switcher' })).id).toMatch(/^weather-day-switcher-[0-9a-f]{6}$/);
    expect(lib.createAsset(input({ title: '天气卡片' })).id).toMatch(/^asset-[0-9a-f]{6}$/);
    expect(lib.createAsset(input({ id: 'my-card' })).id).toBe('my-card');
    expect(() => lib.createAsset(input({ id: 'my-card' }))).toThrow(/已被占用/);
  });

  it('测试数据可以重复创建而不产生重复记录', () => {
    const lib = open(tempDir());
    const first = seedTestLibrary(lib);
    expect(first).toBeGreaterThan(0);
    expect(seedTestLibrary(lib)).toBe(0);
    expect(lib.listAssets().length).toBe(first);
    expect(lib.getAsset('weather-day-switcher').frameworks).toEqual(['html', 'react', 'vue']);
  });

  it('旧版素材库打开时迁移到多语言、多框架结构', () => {
    const dir = tempDir();
    const db = new DatabaseSync(path.join(dir, 'library.db'));
    migrate(db, dir, 1);
    const now = new Date().toISOString();
    db.prepare(`insert into assets (id, title, description, kind, entry, idea, dependencies, created_at, updated_at)
      values ('old', 'Old', 'An old card.', 'html', 'markup.html', '旧的思路', '{}', ?, ?)`).run(now, now);
    for (const name of ['markup.html', 'style.css']) {
      fs.mkdirSync(path.join(dir, 'assets/old/code'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'assets/old/code', name), name === 'markup.html' ? '<p>old</p>' : '');
      db.prepare(`insert into files (asset_id, role, path, mime, size) values ('old', 'code', ?, 'text/plain', 1)`).run(`assets/old/code/${name}`);
    }
    db.close();
    fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ format: 'craft-every-aspect-library', libraryId: 'x', createdAt: now }));

    const lib = open(dir);
    const a = lib.getAsset('old');
    expect(a.texts).toEqual({ en: { summary: 'An old card.', idea: '' }, zh: { summary: '', idea: '旧的思路' } });
    expect(a.variants[0].framework).toBe('html');
    expect(a.variants[0].files.find(f => f.path === 'markup.html')?.content).toBe('<p>old</p>');
    expect(fs.existsSync(path.join(dir, 'assets/old/code/html/markup.html'))).toBe(true);
  });
});

describe('三种复用内容', () => {
  it('复刻提示词使用简短集成要求，文案与来源不混入代码', () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    const en = buildReplicaPrompt(a, { framework: 'html', locale: 'en' });
    expect(en.startsWith('Add the "Weather Day Switcher" component to my project.\nFollow my project')).toBe(true);
    expect(en).not.toContain('transitions.dev');
    expect(en.split('```')[0]).not.toContain('prefers-reduced-motion');
    expect(en.split('```')[0]).not.toContain(a.texts.en.summary);
    expect(en).not.toContain('--stage-');
    const markup = en.indexOf('Markup:\n```html\n<div class="wx">');
    const styles = en.indexOf('Styles:\n```css\n/* @motion');
    const script = en.indexOf('Script (runs once after the markup):\n```js\n(function () {');
    expect(markup).toBeGreaterThan(0);
    expect(styles).toBeGreaterThan(markup);
    expect(script).toBeGreaterThan(styles);

    const zh = buildReplicaPrompt(a, { framework: 'html', locale: 'zh' });
    expect(zh.startsWith('把「天气日期切换卡片」组件加到我的项目里。\n沿用项目现有规范，保留组件的交互和动效。')).toBe(true);
    expect(zh.slice(zh.indexOf('```'))).toBe(en.slice(en.indexOf('```')).replace('Styles:', '样式:').replace('Script (runs once after the markup):', '脚本（在结构之后运行一次）:'));
  });

  it('说明：从代码里整理出附注和动效参数', () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    for (const v of a.variants) {
      const n = codeNotes(v);
      expect(n.notes.some(x => x.startsWith('Icons: Heroicons'))).toBe(true);
      expect(n.notes.some(x => x.startsWith('Touch:'))).toBe(true);
      expect(n.notes.some(x => x.startsWith('Text morph'))).toBe(false);
      expect(n.motion.find(g => g.title === 'Tabs sliding')?.params[0]).toEqual({ name: '--tabs-dur', label: 'Duration', value: '250ms' });
    }
  });

  it('框架切换只改代码：源码和复刻提示词里的代码随框架变化', () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    const source = buildSource(a, 'html');
    expect(source.startsWith('<!doctype html>')).toBe(true);
    expect(source).toContain('<style>\n/* @motion');

    const reactSource = buildSource(a, 'react');
    expect(reactSource.startsWith('// WeatherDaySwitcher.tsx\nimport')).toBe(true);
    expect(reactSource).toContain('/* style.css */\n/* @motion');
    expect(buildSource(a, 'vue').startsWith('<!-- WeatherDaySwitcher.vue -->\n<script setup')).toBe(true);

    const replica = buildReplicaPrompt(a, { framework: 'vue', locale: 'en' });
    expect(replica).toContain('WeatherDaySwitcher.vue:\n```vue\n<script setup');
    expect(replica).not.toContain('Markup:');
  });

  it('思路提示词随语言切换，简短且不含代码', () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    const zh = buildIdeaPrompt(a, { locale: 'zh' });
    const en = buildIdeaPrompt(a, { locale: 'en' });
    expect(zh).toContain('天气卡片');
    expect(en).toContain('weather card');
    for (const idea of [zh, en]) {
      expect(idea).not.toMatch(/```|<div/);
      expect(idea.length).toBeLessThan(700);
    }
    expect(zh).not.toContain('技术栈');
  });

  it('复刻提示词可以解析回素材，再生成时内容不变', () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    const parsed = parseReplicaPrompt(buildReplicaPrompt(a, { framework: 'html', locale: 'en' }))!;
    expect(parsed.title).toBe('Weather Day Switcher');
    expect(parsed.summary).toBe('');
    const files = a.variants[0].files;
    for (const [key, file] of [['markup', 'markup.html'], ['style', 'style.css'], ['script', 'script.js']] as const) {
      expect(parsed[key]).toBe(files.find(f => f.path === file)!.content.replace(/\s+$/, ''));
    }
    expect(parseReplicaPrompt('随便一段话')).toBeNull();
  });

  it('粘贴 transitions.dev 原版提示词时单独解析来源信息', () => {
    const original = parseReplicaPrompt([
      'Add the "X" component to my project. It comes from the transitions.dev Community: https://transitions.dev/studio.html?id=abc',
      '',
      'A card.',
      '',
      'Markup:',
      '```html',
      '<p>x</p>',
      '```',
    ].join('\n'))!;
    expect(original).toMatchObject({ title: 'X', sourceName: 'transitions.dev Community', sourceUrl: 'https://transitions.dev/studio.html?id=abc', summary: 'A card.', markup: '<p>x</p>' });
  });

  it('没有脚本时复刻提示词不输出 Script 段；缺少语言时退回已有语言', () => {
    const lib = open(tempDir());
    const a = lib.getAsset(lib.createAsset(input({ texts: { zh: { summary: '中文简介', idea: '中文思路' } } })).id);
    const en = buildReplicaPrompt(a, { framework: 'html', locale: 'en' });
    expect(en).not.toContain('Script (runs once');
    expect(en).not.toContain('中文简介');
    expect(buildIdeaPrompt(a, { locale: 'en' })).toBe('中文思路\n');
  });

  it('参考包里有各框架代码和各语言提示词，与详情页复制的一致', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ variants: [html(), react] }));
    lib.addMedia(a.id, 'demo.webm', new Uint8Array([1, 2, 3]), '点击效果录屏');
    const files = unzipSync(exportReferencePackage(lib, a.id));
    const detail = lib.getAsset(a.id);
    expect(strFromU8(files['source.html'])).toBe(buildSource(detail, 'html'));
    expect(strFromU8(files['prompts/replica.react.zh.md'])).toBe(buildReplicaPrompt(detail, { framework: 'react', locale: 'zh' }));
    expect(strFromU8(files['prompts/idea.en.md'])).toBe(buildIdeaPrompt(detail, { locale: 'en' }));
    expect(strFromU8(files['code/html/style.css'])).toBe('button { color: red }');
    expect(files['code/react/Button.tsx']).toBeDefined();
    expect(files['media/demo.webm']).toBeDefined();
    expect(strFromU8(files['README.md'])).toContain('点击效果录屏');
  });
});

describe('标签管理', () => {
  it('改名会更新所有素材，保留标签顺序并支持仅修改大小写', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ tags: ['按钮', 'Motion', '交互'] }));
    const b = lib.createAsset(input({ title: 'Switch', tags: ['Motion'] }));

    lib.renameTag('motion', ' #Animation  ');
    expect(lib.getAsset(a.id).tags).toEqual(['按钮', 'Animation', '交互']);
    expect(lib.getAsset(b.id).tags).toEqual(['Animation']);
    expect(lib.repo.listTags()).toContainEqual({ name: 'Animation', count: 2 });
    expect(lib.listAssets().find(x => x.id === a.id)?.searchText).toContain('animation');

    lib.renameTag('Animation', 'animation');
    expect(lib.getAsset(b.id).tags).toEqual(['animation']);
  });

  it('合并已有标签时去重，保留目标名称与素材关联', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ tags: ['Motion', '交互', 'Animation'] }));
    const b = lib.createAsset(input({ title: 'Switch', tags: ['Motion', '开关'] }));
    const c = lib.createAsset(input({ title: 'Loader', tags: ['Animation'] }));

    lib.renameTag('Motion', 'animation');

    expect(lib.getAsset(a.id).tags).toEqual(['交互', 'Animation']);
    expect(lib.getAsset(b.id).tags).toEqual(['Animation', '开关']);
    expect(lib.getAsset(c.id).tags).toEqual(['Animation']);
    expect(lib.repo.listTags()).toContainEqual({ name: 'Animation', count: 3 });
    expect(lib.repo.listTags().some(t => t.name === 'Motion')).toBe(false);
  });

  it('删除只移除标签，保留素材、收藏和代码；导出反映管理结果', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input({ tags: ['Motion', '按钮'] }));
    const b = lib.createAsset(input({ title: 'Switch', tags: ['Motion'] }));
    lib.setFavorite(a.id, true);
    lib.renameTag('Motion', 'Animation');
    lib.deleteTag('animation');

    expect(lib.getAsset(a.id)).toMatchObject({ tags: ['按钮'], favorite: true, variants: [html()] });
    expect(lib.getAsset(b.id).tags).toEqual([]);
    expect(lib.repo.listTags()).toEqual([{ name: '按钮', count: 1 }]);
    const restored = open(tempDir());
    importPackage(restored, parsePackage(exportLibrary(lib)), 'skip');
    expect(restored.getAsset(a.id).tags).toEqual(['按钮']);
    expect(restored.getAsset(b.id).tags).toEqual([]);
  });

  it('拒绝空名称和不存在的标签，不改动现有数据', () => {
    const lib = open(tempDir());
    const a = lib.createAsset(input());
    expect(() => lib.renameTag('按钮', ' # ')).toThrow(/不能为空/);
    expect(() => lib.renameTag('不存在', '新名称')).toThrow(/不存在/);
    expect(() => lib.deleteTag('不存在')).toThrow(/不存在/);
    expect(lib.getAsset(a.id).tags).toEqual(['按钮', '动效']);
    lib.renameTag('按钮', 'Button');
    expect(lib.getAsset(a.id).tags).toEqual(['Button', '动效']);
  });
});

describe('本地打包', () => {
  it('相同内容的并发预览复用打包任务，修改代码后缓存失效', async () => {
    const files = [{ path: 'App.tsx', content: 'export default function App() { return <b>first-version</b>; }' }];
    const first = bundle('react', 'same-key', files, 'App.tsx');
    const second = bundle('react', 'other-key', files, 'App.tsx');
    expect(first).toBe(second);
    expect((await first).code).toContain('first-version');
    const changed = await bundle('react', 'same-key', [{ path: 'App.tsx', content: files[0].content.replace('first-version', 'second-version') }], 'App.tsx');
    expect(changed.code).toContain('second-version');
    expect(changed.code).not.toContain('first-version');
  });
  it('React：多文件组件打成一个脚本，缺少的模块给出错误', async () => {
    const ok = await bundle('react', 't1', [
      { path: 'App.tsx', content: "import { useState } from 'react';\nimport { Label } from './Label';\nimport './styles.css';\nexport default function App() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}><Label n={n} /></button>; }" },
      { path: 'Label.tsx', content: 'export function Label({ n }: { n: number }) { return <span>{n}</span>; }' },
      { path: 'styles.css', content: 'button { color: red }' },
    ], 'App.tsx');
    expect(ok.error).toBeNull();
    expect(ok.code).toContain('button { color: red }');
    expect(ok.code).not.toMatch(/\brequire\(/);

    const bad = await bundle('react', 't2', [{ path: 'App.tsx', content: "import x from './missing';\nexport default function App() { return <b>{x}</b>; }" }], 'App.tsx');
    expect(bad.error).toMatch(/missing/);
  }, 30_000);

  it('Vue：单文件组件（含 TS 和 scoped 样式）打成一个脚本', async () => {
    const ok = await bundle('vue', 't3', [
      { path: 'App.vue', content: '<script setup lang="ts">\nimport { ref } from "vue";\nconst n = ref<number>(0);\n</script>\n<template><button @click="n++">{{ n }}</button></template>\n<style scoped>button { color: red }</style>' },
    ], 'App.vue');
    expect(ok.error).toBeNull();
    expect(ok.code).toMatch(/button\[data-v-[0-9a-f]+\]/);
  }, 30_000);

  it('测试数据的 React 和 Vue 实现都能打包', async () => {
    const lib = open(tempDir());
    seedTestLibrary(lib);
    const a = lib.getAsset('weather-day-switcher');
    for (const v of a.variants.filter(x => x.framework !== 'html')) {
      const out = await bundle(v.framework, 'seed-' + v.framework, v.files, v.entry);
      expect(out.error, v.framework).toBeNull();
    }
  }, 60_000);
});

describe('导入导出', () => {
  function sourceLibrary() {
    const lib = open(tempDir());
    const cat = lib.createCategory('按钮');
    const a = lib.createAsset(input({ categoryId: cat.id, previewScale: 1.25, previewViewport: { width: 1200, height: 720 }, variants: [html(), darkReact] }));
    lib.setFavorite(a.id, true);
    lib.addMedia(a.id, 'cover.png', PNG, '封面');
    const b = lib.createAsset(input({ title: 'Switch', tags: ['开关'] }));
    return { lib, a, b, cat };
  }

  it('在另一个数据目录恢复后，素材、文案、实现、收藏与文件关联完整', () => {
    const { lib, a, cat } = sourceLibrary();
    const zip = exportLibrary(lib);
    const target = open(path.join(tempDir(), 'restored'));
    const result = importPackage(target, parsePackage(zip), 'skip');
    expect(result.created).toBe(2);

    const restored = target.getAsset(a.id);
    const original = lib.getAsset(a.id);
    expect(restored.title).toBe(original.title);
    expect(restored.tags).toEqual(original.tags);
    expect(restored.texts).toEqual(original.texts);
    expect(restored.variants).toEqual(original.variants);
    expect(restored.variants[1].supportsDarkMode).toBe(true);
    expect(restored.previewScale).toBe(1.25);
    expect(restored.previewViewport).toEqual({ width: 1200, height: 720 });
    expect(restored.favorite).toBe(true);
    expect(restored.categoryId).toBe(cat.id);
    expect(restored.createdAt).toBe(original.createdAt);
    expect(restored.cover).toBe(original.cover);
    expect(restored.media[0]?.label).toBe('封面');
    expect(fs.readFileSync(target.resolve(restored.cover!)!)).toEqual(Buffer.from(PNG));
    expect(target.listCategories().map(c => c.name)).toEqual(['按钮']);
  });

  it('素材文件夹和参考包导入后，暗色能力仍按各实现的代码判断', () => {
    const { lib, a } = sourceLibrary();
    const parsed = parseFolderFiles(folderFiles(lib, [a.id]));
    const target = open(tempDir());
    importPackage(target, parsed, 'skip');
    expect(target.getAsset(a.id).variants[1].supportsDarkMode).toBe(true);
    expect(target.getAsset(a.id).previewScale).toBe(1.25);
    expect(target.getAsset(a.id).previewViewport).toEqual({ width: 1200, height: 720 });
    const reference = unzipSync(exportReferencePackage(lib, a.id));
    expect(JSON.parse(strFromU8(reference['asset.json'])).supportsDarkMode).toEqual({ react: true });
  });

  it('能导入旧格式（v1）的素材包', () => {
    const v1 = {
      format: 'craft-every-aspect-export', formatVersion: 1, exportedAt: '', sourceLibraryId: 'x', categories: [],
      assets: [{
        id: 'legacy', title: 'Legacy', description: 'Old one.', categoryId: null, kind: 'html', entry: 'markup.html', tags: ['旧'],
        idea: '旧思路', notes: '', sourceUrl: '', sourceName: '', dependencies: {}, favorite: false, cover: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        files: [{ role: 'code', path: 'code/markup.html', mime: 'text/html', size: 8, label: '' }],
      }],
    };
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(v1)), 'assets/legacy/code/markup.html': strToU8('<p>v1</p>') });
    const target = open(tempDir());
    importPackage(target, parsePackage(zip), 'skip');
    const a = target.getAsset('legacy');
    expect(a.texts).toEqual({ en: { summary: 'Old one.', idea: '' }, zh: { summary: '', idea: '旧思路' } });
    expect(a.variants[0].files.find(f => f.path === 'markup.html')?.content).toBe('<p>v1</p>');
  });

  it('选中导出只包含选中的素材和用到的分类', () => {
    const { lib, b } = sourceLibrary();
    const pkg = parsePackage(exportLibrary(lib, [b.id]));
    expect(pkg.assets.map(x => x.id)).toEqual([b.id]);
    expect(pkg.categories).toEqual([]);
  });

  it('重复导入按选项处理：跳过、覆盖、另存副本', () => {
    const { lib, a } = sourceLibrary();
    const zip = exportLibrary(lib);
    const target = open(tempDir());
    importPackage(target, parsePackage(zip), 'skip');

    const preview = previewImport(target, parsePackage(zip));
    expect(preview.duplicates.length).toBe(2);

    expect(importPackage(target, parsePackage(zip), 'skip')).toMatchObject({ created: 0, skipped: 2 });
    expect(target.listAssets().length).toBe(2);

    target.updateAsset(a.id, input({ title: '本地改过的标题' }));
    expect(importPackage(target, parsePackage(zip), 'overwrite')).toMatchObject({ overwritten: 2 });
    expect(target.getAsset(a.id).title).toBe('Press Button');
    expect(target.getAsset(a.id).cover).not.toBeNull();
    expect(target.listAssets().length).toBe(2);

    expect(importPackage(target, parsePackage(zip), 'copy')).toMatchObject({ copied: 2 });
    const all = target.listAssets();
    expect(all.length).toBe(4);
    const copy = all.find(x => x.title === 'Press Button（导入副本）')!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.cover).toBe(`assets/${copy.id}/media/cover.png`);
    expect(fs.existsSync(target.resolve(copy.cover!)!)).toBe(true);
  });

  it('校验格式版本与文件路径', () => {
    const { lib } = sourceLibrary();
    const files = unzipSync(exportLibrary(lib));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));

    const future = { ...files, 'manifest.json': strToU8(JSON.stringify({ ...manifest, formatVersion: 99 })) };
    expect(() => parsePackage(zipSync(future))).toThrow(/格式版本/);

    const evil = structuredClone(manifest);
    evil.assets[0].files[0].path = 'code/../../../evil.txt';
    expect(() => parsePackage(zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(evil)) }))).toThrow(/路径/);

    const missing = { ...files };
    delete missing[`assets/${manifest.assets[0].id}/${manifest.assets[0].files[0].path}`];
    expect(() => parsePackage(zipSync(missing))).toThrow(/缺少文件/);

    expect(() => parsePackage(zipSync({ ...files, '../escape.txt': strToU8('x') }))).toThrow(/不安全/);
    expect(() => parsePackage(strToU8('not a zip'))).toThrow(/ZIP/);
  });
});
