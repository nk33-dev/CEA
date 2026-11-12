import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import { Library } from '../server/library.ts';
import { exportLibrary, exportReferencePackage, importPackage, parsePackage, unzipSafe } from '../server/transfer/zip.ts';
import { folderFiles, parseFolderFiles } from '../server/transfer/folder.ts';
import { htmlPlayPage } from '../server/play.ts';
import { buildIdeaPrompt, buildReplicaPrompt, buildSource } from '../shared/prompt.ts';
import { hasDarkMode, parseThemeContract, previewThemeFor, resolveTheme, type ThemeContract } from '../shared/theme.ts';
import type { AssetInput } from '../shared/types.ts';
import { codeNotes } from '../shared/notes.ts';

const dirs: string[] = [];
const libs: Library[] = [];
function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-theme-test-'));
  dirs.push(dir);
  const lib = Library.open(dir);
  libs.push(lib);
  return lib;
}
afterEach(() => {
  libs.splice(0).forEach(lib => lib.close());
  for (const dir of dirs.splice(0)) {
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('cea-theme-test-')) throw new Error('Unexpected test path');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const both: ThemeContract = { version: 1, mode: 'both', default: 'light' };
const input: AssetInput = {
  title: 'Theme card', categoryId: null, tags: [], sourceName: '', sourceUrl: '',
  texts: {
    zh: { summary: '测试', idea: '做一个深色卡片，悬停时图标旋转。', themeIdeas: { light: '做一个浅色卡片，悬停时图标旋转。', dark: '做一个深色卡片，悬停时图标旋转。' } },
    en: { summary: 'Test', idea: 'A dark card with a spinning icon.' },
  },
  variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, theme: both, files: [
    { path: 'markup.html', content: '<div class="card">Test</div>' },
    { path: 'style.css', content: '.card{background:white;color:black}[data-theme="dark"] .card{background:#111;color:white}' },
  ] }],
};

describe('主题契约与旧素材', () => {
  it('旧素材默认按原样读取，声明优先于兼容识别，注释不算实现', () => {
    const legacy = { files: [{ path: 'style.css', content: '/* [data-theme="dark"] .x{} */ .x{background:black}' }] };
    expect(hasDarkMode(legacy.files)).toBe(false);
    expect(resolveTheme(legacy)).toMatchObject({ mode: 'original', source: 'original' });
    expect(resolveTheme(input.variants[0])).toMatchObject({ mode: 'both', source: 'declared' });
    expect(resolveTheme({ ...input.variants[0], theme: { version: 1, mode: 'light', default: 'light' } })).toMatchObject({ mode: 'light', source: 'declared' });
    expect(resolveTheme({ files: input.variants[0].files })).toMatchObject({ mode: 'both', source: 'detected' });
  });

  it('背景偏好不决定组件主题，单主题不开放另一种模式', () => {
    expect(previewThemeFor(resolveTheme({ ...input.variants[0], theme: { version: 1, mode: 'light', default: 'light' } }), 'dark')).toBe('light');
    expect(previewThemeFor(resolveTheme({ ...input.variants[0], theme: { version: 1, mode: 'dark', default: 'dark' } }), 'light')).toBe('dark');
    expect(previewThemeFor(resolveTheme({ files: [] }), 'dark')).toBe('original');
  });

  it('版本未知或声明矛盾时在写文件前拒绝，保留原素材', () => {
    const lib = open();
    const old = lib.createAsset(input);
    expect(() => lib.updateAsset(old.id, { ...input, variants: [{ ...input.variants[0], theme: { version: 99, mode: 'light', default: 'light' } as unknown as ThemeContract }] })).toThrow('版本不支持');
    expect(lib.getAsset(old.id).variants[0].files).toEqual(old.variants[0].files);
    expect(() => parseThemeContract({ version: 1, mode: 'dark', default: 'light' })).toThrow('默认主题');
  });

  it('旧客户端保存时保留遗漏的新字段，显式 null 可恢复兼容识别', () => {
    const lib = open();
    const asset = lib.createAsset(input);
    const { theme: _, ...variant } = input.variants[0];
    const oldInput = { ...input, variants: [variant], texts: { zh: { summary: '更新简介', idea: '原始思路' } } };
    lib.updateAsset(asset.id, oldInput);
    expect(lib.getAsset(asset.id).variants[0].theme).toEqual(both);
    expect(lib.getAsset(asset.id).texts.zh.themeIdeas).toEqual(input.texts.zh.themeIdeas);
    lib.updateAsset(asset.id, { ...oldInput, variants: [{ ...variant, theme: null }], texts: { zh: { summary: '', idea: '原样', themeIdeas: {} } } });
    expect(lib.getAsset(asset.id).variants[0].theme).toBeUndefined();
    expect(lib.getAsset(asset.id).texts.zh.themeIdeas).toBeUndefined();
  });

  it('浅色目标优先采用浅色思路，源码始终保持完整原样', () => {
    const asset = open().createAsset(input);
    const idea = buildIdeaPrompt(asset, { locale: 'zh', framework: 'html', targetTheme: 'light' });
    expect(idea).toContain('配色：只做浅色');
    expect(idea).toContain('做一个浅色卡片');
    expect(idea).not.toContain('做一个深色卡片');
    const source = buildSource(asset, 'html');
    const prompt = buildReplicaPrompt(asset, { locale: 'en', framework: 'html', targetTheme: 'light' });
    expect(prompt).toContain('Colors: light only');
    expect(prompt).toContain(input.variants[0].files[1].content);
    expect(buildSource(asset, 'html')).toBe(source);
    expect(buildIdeaPrompt(asset, { locale: 'zh' })).toBe(input.texts.zh.idea + '\n');
  });

  it('源码页面按声明的默认主题打开，原始配色不添加主题入口', () => {
    const lib = open();
    const dark = lib.createAsset({ ...input, variants: [{ ...input.variants[0], theme: { version: 1, mode: 'dark', default: 'dark' } }] });
    expect(buildSource(dark, 'html')).toContain('<html lang="en" data-theme="dark" class="dark">');
    const original = lib.createAsset({ ...input, variants: [{ ...input.variants[0], theme: { version: 1, mode: 'original', default: 'light' } }] });
    expect(buildSource(original, 'html')).toContain('<html lang="en">');
    // 保持原样且只有一套配色时，提示词里不出现主题说明
    const plain = buildReplicaPrompt(original, { locale: 'zh', framework: 'html', targetTheme: 'original' });
    expect(plain).not.toMatch(/主题|配色/);
    expect(plain.split('\n').slice(0, 3)).toEqual(['把「Theme card」组件加到我的项目里。', '沿用项目现有规范，保留组件的交互和动效。', '']);
    // 单一配色要求改成双主题时，写出目标、差别和实现约束三行
    const both = buildReplicaPrompt(original, { locale: 'zh', framework: 'html', targetTheme: 'both' });
    expect(both).toContain('配色：浅色和深色都要，并能切换。\n参考代码是一套固定配色，补上另一套');
    // 显式选择浅色时仍写出目标，和沿用原配色区别开。
    const light = lib.createAsset({ ...input, variants: [{ ...input.variants[0], theme: { version: 1, mode: 'light', default: 'light' } }] });
    expect(buildReplicaPrompt(light, { locale: 'zh', framework: 'html', targetTheme: 'light' })).toContain('配色：只做浅色');
  });

  it('旧思路未分主题时追加明确目标，而不替换或删除原文', () => {
    const asset = open().createAsset({ ...input, texts: { zh: { summary: '', idea: input.texts.zh.idea } } });
    const idea = buildIdeaPrompt(asset, { locale: 'zh', targetTheme: 'light' });
    expect(idea).toContain(input.texts.zh.idea);
    expect(idea.indexOf('配色：只做浅色')).toBeLessThan(idea.indexOf(input.texts.zh.idea));
  });

  it.each(['zh', 'en', 'fr-CA'])('思路的配色要求不暗示附带参考代码（%s）', locale => {
    for (const mode of ['original', 'light', 'dark', 'both'] as const) {
      const asset = open().createAsset({
        ...input,
        variants: [{ ...input.variants[0], theme: { version: 1, mode, default: mode === 'dark' ? 'dark' : 'light' } }],
      });
      const source = buildSource(asset, 'html');
      for (const targetTheme of ['original', 'light', 'dark', 'both'] as const) {
        const idea = buildIdeaPrompt(asset, { locale, framework: 'html', targetTheme });
        expect(idea).not.toMatch(/参考代码|The reference|```|\.card\{/);
        expect(idea).not.toMatch(/删掉.+那套|drop the (?:light|dark) one|add the missing palette/);
        expect(idea).not.toMatch(/CSS|data-theme|component root/);
        expect(buildSource(asset, 'html')).toBe(source);
      }
    }
  });

  it('思路保留作者必要的技术选择，不自动添加框架和工程约束', () => {
    const idea = '用 Three.js 做一个可旋转的三维粒子环，拖动时跟随手势转动。';
    const asset = open().createAsset({ ...input, texts: { zh: { summary: '', idea } } });
    const prompt = buildIdeaPrompt(asset, { locale: 'zh', framework: 'html', targetTheme: 'dark' });
    expect(prompt).toContain(idea);
    expect(prompt).toContain('配色：只做深色');
    expect(prompt).not.toMatch(/HTML|Vue|React|CSS|data-theme/);
  });

  it('分主题思路可搜索，列表分页不携带长思路', () => {
    const lib = open();
    const asset = lib.createAsset({ ...input, texts: { zh: { summary: '', idea: '卡片', themeIdeas: { light: '月面材质' } } } });
    const page = lib.repo.searchAssets({ q: '月面材质' });
    expect(page.items.map(a => a.id)).toEqual([asset.id]);
    expect(page.items[0].searchText).toBe('');
    expect(lib.listAssets()[0].searchText).toContain('月面材质');
  });

  it('说明读取组件内的初始参数，忽略注释示例和后续覆盖', () => {
    const notes = codeNotes({ ...input.variants[0], files: [{ path: 'style.css', content: `
      /* @motion
      [Slide] tab indicator
      --duration: Duration
      */
      /* Example: --duration: 99ms; */
      .card { --duration: 250ms; }
      @media (prefers-reduced-motion: reduce) { .card { --duration: 0ms; } }
    ` }] });
    expect(notes.motion[0].params[0].value).toBe('250ms');
  });

  it.each(['backup', 'folder'] as const)('%s 往返保留主题声明和原始、分主题思路', format => {
    const source = open();
    const asset = source.createAsset(input);
    const pkg = format === 'backup' ? parsePackage(exportLibrary(source)) : parseFolderFiles(folderFiles(source));
    const target = open();
    importPackage(target, pkg, 'skip');
    expect(target.getAsset(asset.id).variants[0].theme).toEqual(both);
    expect(target.getAsset(asset.id).texts).toEqual(asset.texts);
  });

  it('参考包同时提供原始代码和目标明确的提示词', () => {
    const lib = open();
    const asset = lib.createAsset(input);
    const files = unzipSafe(exportReferencePackage(lib, asset.id));
    expect(strFromU8(files['prompts/replica.html.light.zh.md'])).toContain('配色：只做浅色');
    expect(strFromU8(files['code/html/style.css'])).toBe(input.variants[0].files[1].content);
    expect(JSON.parse(strFromU8(files['asset.json'])).themes.html).toEqual(both);
  });

  it('旧素材按原样保存和读取，不根据素材 ID 改写源码或提示词', () => {
    const lib = open();
    const asset = lib.createAsset({
      ...input, id: 'world-map-hero', variants: [{ ...input.variants[0], theme: undefined, files: [
        { path: 'markup.html', content: '<div class="wm"></div>' },
        { path: 'style.css', content: ':root {\n --wm-dot: 100, 116, 139;\n}' },
        { path: 'script.js', content: 'function readStyle() {}\n  const resizeObserver = new ResizeObserver(resize);\n      resizeObserver.disconnect();' },
      ] }],
    });
    const loaded = lib.getAsset(asset.id);
    expect(loaded.variants[0].files).toEqual(asset.variants[0].files);
    expect(loaded.variants[0].theme).toBeUndefined();
    expect(loaded.texts).toEqual(asset.texts);
  });
});

function runtime(theme: ThemeContract, query: string) {
  const root = { dataset: {} as Record<string, string>, classList: { toggle() {} } };
  const parent = {};
  let receive: (event: unknown) => void = () => {};
  const script = htmlPlayPage('Test', [], { theme }).match(/<script>([\s\S]*?)<\/script>/)![1];
  vm.runInNewContext(script, {
    location: { search: query }, URLSearchParams, parent,
    window: { requestAnimationFrame() {}, cancelAnimationFrame() {} },
    document: { documentElement: root, addEventListener() {} },
    addEventListener: (_type: string, fn: typeof receive) => { receive = fn; },
  });
  return { root, send: (value: unknown) => receive({ source: parent, data: value }) };
}

describe('舞台与组件主题隔离', () => {
  it('未确认的旧代码只保留检测记录，不注入主题属性', () => {
    const support = resolveTheme({ files: input.variants[0].files });
    expect(support).toMatchObject({ mode: 'both', source: 'detected' });
    expect(previewThemeFor(support, 'dark')).toBe('original');
    const r = runtime(support, '?theme=dark&componentTheme=dark');
    expect(r.root.dataset.background).toBe('dark');
    expect(r.root.dataset.theme).toBeUndefined();
    r.send({ type: 'cea:component-theme', value: 'light' });
    expect(r.root.dataset.theme).toBeUndefined();
  });
  it('深背景不会将浅色组件改为深色，主题消息也不能越过单主题声明', () => {
    const r = runtime({ version: 1, mode: 'light', default: 'light' }, '?theme=dark&componentTheme=dark');
    expect(r.root.dataset).toMatchObject({ background: 'dark', theme: 'light' });
    r.send({ type: 'cea:component-theme', value: 'dark' });
    expect(r.root.dataset.theme).toBe('light');
    r.send({ type: 'cea:theme', value: 'light' });
    expect(r.root.dataset.theme).toBe('light');
  });
  it('双主题响应组件指令；原样模式不注入主题属性', () => {
    const r = runtime(both, '?theme=light&componentTheme=dark');
    expect(r.root.dataset.theme).toBe('dark');
    r.send({ type: 'cea:theme', value: 'dark' });
    r.send({ type: 'cea:component-theme', value: 'light' });
    expect(r.root.dataset).toMatchObject({ background: 'dark', theme: 'light' });
    const original = runtime({ version: 1, mode: 'original', default: 'light' }, '?componentTheme=dark');
    expect(original.root.dataset.theme).toBeUndefined();
  });
});
