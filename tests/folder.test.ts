import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { Library } from '../server/library.ts';
import { seedTestLibrary } from './helpers/library.ts';
import { folderFiles, parseFolderFiles, readFolder, splitHtml, writeFolder } from '../server/transfer/folder.ts';
import { alignVocabulary, libraryVocabulary } from '../server/transfer/vocabulary.ts';
import { importPackage, isBackupPackage, unzipSafe } from '../server/transfer/zip.ts';
import { aiFolderPrompt, folderGuide, FOLDER_GUIDE, quotePath } from '../shared/folderGuide.ts';
import { hasDarkMode } from '../shared/theme.ts';

const temps: string[] = [];
const opened: Library[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-folder-'));
  temps.push(dir);
  return dir;
};
const open = (dir = tempDir()) => {
  const lib = Library.open(dir);
  opened.push(lib);
  return lib;
};
const files = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, strToU8(v)]));

afterEach(() => {
  for (const lib of opened.splice(0)) lib.close();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('素材文件夹', () => {
  it('按框架目录、asset.json 和 idea.<语言>.md 识别多个素材', () => {
    const pkg = parseFolderFiles(files({
      'weather-card/asset.json': JSON.stringify({ title: 'Weather Card', category: 'Cards', tags: ['天气'], summary: { zh: '天气卡片' } }),
      'weather-card/idea.zh.md': '做一个 iOS 天气风格的卡片。',
      'weather-card/react/WeatherCard.tsx': "import './style.css';\nexport default function WeatherCard() { return <div />; }",
      'weather-card/react/style.css': '.a{}',
      'weather-card/html/markup.html': '<div class="a"></div>',
      'weather-card/html/style.css': '.a{}',
      'weather-card/media/cover.png': 'png',
      'pricing-toggle/index.html': '<!doctype html><html><head><style>.t{color:red}</style></head><body><button class="t">月付</button><script>console.log(1)</script></body></html>',
      'broken/asset.json': '{"title": "Broken"}',
    }), 'my-components');
    expect(pkg.problems).toEqual([{ name: 'broken', reason: expect.stringContaining('没有找到代码') }]);
    const weather = pkg.assets.find(a => a.id === 'weather-card')!;
    expect(weather).toMatchObject({ title: 'Weather Card', tags: ['天气'], cover: 'media/cover.png', texts: { zh: { summary: '天气卡片', idea: '做一个 iOS 天气风格的卡片。' } } });
    expect(weather.variants.map(v => [v.framework, v.entry])).toEqual([['html', 'markup.html'], ['react', 'WeatherCard.tsx']]);
    expect(pkg.categories).toEqual([{ id: weather.categoryId, name: 'Cards', sort: 0 }]);
    const pricing = pkg.assets.find(a => a.id === 'pricing-toggle')!;
    expect(pricing.title).toBe('Pricing Toggle');
    expect(pricing.variants[0].files).toEqual([
      { path: 'markup.html', content: '<button class="t">月付</button>\n' },
      { path: 'style.css', content: '.t{color:red}\n' },
      { path: 'script.js', content: 'console.log(1)\n' },
    ]);
  });

  it('选中的就是单个素材文件夹时用文件夹名作 ID，也认素材库里的 code/<框架>/ 布局', () => {
    const pkg = parseFolderFiles(files({ 'code/vue/WorldMap.vue': '<template><div /></template>', 'code/vue/style.css': '' }), 'world-map-hero');
    expect(pkg.assets).toHaveLength(1);
    expect(pkg.assets[0]).toMatchObject({ id: 'world-map-hero', title: 'World Map Hero' });
    expect(pkg.assets[0].variants[0]).toMatchObject({ framework: 'vue', entry: 'WorldMap.vue' });
  });

  it('入口不明确时给出可操作的提示', () => {
    const pkg = parseFolderFiles(files({ 'a/react/One.tsx': 'export default () => null', 'a/react/Two.tsx': 'export default () => null' }));
    expect(pkg.problems[0].reason).toContain('entry');
  });

  it('外面多包一层的 ZIP 照样识别，备份包和文件夹包能区分开', () => {
    const zip = zipSync({ 'my-components/card/html/markup.html': strToU8('<p>x</p>') });
    const unzipped = unzipSafe(zip);
    expect(isBackupPackage(unzipped)).toBe(false);
    expect(parseFolderFiles(unzipped, 'my-components').assets.map(a => a.id)).toEqual(['card']);
  });

  it('导出成文件夹再导入，代码、文案、标签和封面都保留', () => {
    const lib = open();
    seedTestLibrary(lib);
    const out = writeFolder(tempDir(), 'export', folderFiles(lib));
    expect(fs.existsSync(path.join(out, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'weather-day-switcher', 'asset.json'))).toBe(true);

    const target = open();
    const pkg = parseFolderFiles(readFolder(out), 'export');
    expect(pkg.problems).toEqual([]);
    expect(importPackage(target, pkg, 'skip')).toMatchObject({ created: 1 });
    const before = lib.getAsset('weather-day-switcher');
    const after = target.getAsset('weather-day-switcher');
    expect(after.title).toBe(before.title);
    expect(after.tags).toEqual(before.tags);
    expect(after.texts).toEqual(before.texts);
    expect(after.variants.map(v => v.files.length)).toEqual(before.variants.map(v => v.files.length));
    expect(target.listCategories().map(c => c.name)).toEqual(['Cards']);
  });

  it('readFolder 跳过 node_modules 和 .git', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'card', 'html'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'card', 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'card', 'html', 'markup.html'), '<p>x</p>');
    fs.writeFileSync(path.join(dir, 'card', 'node_modules', 'x', 'index.js'), '');
    expect(Object.keys(readFolder(dir))).toEqual(['card/html/markup.html']);
  });

  it('splitHtml 保留外链脚本和 head 里的样式表链接', () => {
    const r = splitHtml('<html><head><link rel="stylesheet" href="https://x/a.css"></head><body><p>x</p><script src="https://x/a.js"></script></body></html>');
    expect(r.markup).toContain('<link rel="stylesheet" href="https://x/a.css">');
    expect(r.markup).toContain('<script src="https://x/a.js"></script>');
    expect(r.script).toBe('');
  });
});

describe('asset.json 注释与暗色识别', () => {
  it('asset.json 可以带 // 和块注释以及末尾逗号，字符串里的斜杠不受影响', () => {
    const pkg = parseFolderFiles(files({
      'card/asset.json': '{\n  // 名称\n  "title": "Card", /* 分类 */ "category": "Cards",\n  "sourceUrl": "https://x.dev/a//b",\n  "tags": ["a",],\n}',
      'card/html/markup.html': '<p>x</p>',
    }));
    expect(pkg.problems).toEqual([]);
    expect(pkg.assets[0]).toMatchObject({ title: 'Card', sourceUrl: 'https://x.dev/a//b', tags: ['a'] });
  });

  it('说明书里的示例 asset.json 能直接用', () => {
    const example = /```jsonc\n([\s\S]*?)```/.exec(FOLDER_GUIDE)![1];
    const pkg = parseFolderFiles(files({ 'particle-hero/asset.json': example, 'particle-hero/react/ParticleHero.tsx': 'export default () => null' }));
    expect(pkg.problems).toEqual([]);
    expect(pkg.assets[0]).toMatchObject({ title: 'Particle Hero', tags: ['粒子', 'Canvas'] });
    expect(pkg.assets[0].variants[0].entry).toBe('ParticleHero.tsx');
  });

  it('给 AI 的命令带上程序和素材库的完整路径，按系统加引号', () => {
    const win = aiFolderPrompt({ path: 'E:\\CEA-Assets', cli: { path: 'D:\\cea\\server\\cli.ts', platform: 'win32' } });
    expect(win).toContain('`node "D:\\cea\\server\\cli.ts" guide --library "E:\\CEA-Assets"`');
    expect(win).toContain('`node "D:\\cea\\server\\cli.ts" import <文件夹> --library "E:\\CEA-Assets"`');
    const mac = aiFolderPrompt({ path: "/Users/me/My Assets", cli: { path: '/Users/me/cea/server/cli.ts', platform: 'darwin' } });
    expect(mac).toContain("`node '/Users/me/cea/server/cli.ts' import <文件夹> --library '/Users/me/My Assets'`");
    expect(quotePath("/a/it's", 'linux')).toBe("'/a/it'\\''s'");
    expect(folderGuide('node "D:\\cli.ts"')).toContain('node "D:\\cli.ts" check <文件夹>');
  });

  it('指南区分思路与带代码的复刻，并说明实现目录和格式检查边界', () => {
    const guide = folderGuide();
    expect(guide).toContain('思路：只描述效果，不含代码');
    expect(guide).toContain('复刻：集成要求 + 选中框架的完整代码');
    expect(guide).toContain('不会自动附上参考代码');
    expect(guide).toContain('每种实现只读取自己的框架目录');
    expect(guide).toContain('不编译代码，也不验证实际运行效果');
    expect(aiFolderPrompt()).toContain('思路写成可直接发给 AI 的简短需求，技术栈按需指定');
    expect(guide).toContain('不罗列 HTML、Vue、React 等交付版本');
    expect(guide).toContain('不禁止必要的技术选择');
    expect(guide).toContain('什么触发、哪里变化、如何结束');
  });

  it('只有写了暗色规则才算支持暗色', () => {
    expect(hasDarkMode([{ path: 'style.css', content: 'html[data-theme="dark"] .a { color: #fff }' }])).toBe(true);
    expect(hasDarkMode([{ path: 'style.css', content: ':root.dark .a { color: #fff }' }])).toBe(true);
    expect(hasDarkMode([{ path: 'A.tsx', content: '<div className="bg-white dark:bg-black" />' }])).toBe(true);
    expect(hasDarkMode([{ path: 'style.css', content: '.darken { color: red } /* dark */' }])).toBe(false);
  });

  it('指南和 AI 交付要求说明预览控制、动效时钟与视觉验收', () => {
    const guide = folderGuide();
    expect(guide).toContain('展示型组件不自行添加播放、暂停、重播按钮');
    expect(guide).toContain('requestAnimationFrame 回调提供的时间戳');
    expect(guide).toContain('不用 setInterval、递归 setTimeout、Date.now 或 performance.now 驱动连续视觉动效');
    expect(guide).toContain('组件卸载时清理');
    expect(guide).toContain('相同视口、相同天气或状态对照');
    expect(guide).toContain('Escape 关闭和焦点恢复');
    expect(guide).toContain('实际操作素材库的暂停、继续和重播');
    expect(guide).toContain('仅用于素材预览的演示控件及其面板加 data-demo-only 属性');
    expect(guide).toContain('思路只描述目标组件的外观和业务交互');
    expect(guide).toContain('格式检查通过不等于运行验证通过');
    const prompt = aiFolderPrompt();
    expect(prompt).toContain('沿用原组件的视觉基准并截图对照');
    expect(prompt).toContain('不另加播放、暂停按钮');
  });
});

describe('已有分类和标签', () => {
  const seeded = () => {
    const lib = open();
    seedTestLibrary(lib);
    lib.repo.setTagLabels('天气', { zh: '天气', en: 'Weather' });
    lib.repo.setCategoryLabels(lib.repo.findCategoryByName('Cards')!.id, { zh: '卡片', en: 'Cards' });
    return lib;
  };

  it('列出分类、标签和每种框架用到的依赖', () => {
    const lib = seeded();
    const v = libraryVocabulary(lib);
    expect(v.categories).toEqual([{ name: 'Cards', labels: { zh: '卡片', en: 'Cards' }, count: 1 }]);
    expect(v.tags.map(t => t.name)).toContain('天气');
    expect(v.dependencies).toEqual([]);
  });

  it('写成显示名的分类和标签归到已有的，新词保留并给出相近的已有词', () => {
    const lib = seeded();
    const pkg = parseFolderFiles(files({
      'card/asset.json': JSON.stringify({ category: '卡片', tags: ['weather', 'Weather icon', '玻璃'], tagLabels: { 玻璃: { en: 'Glass' } } }),
      'card/html/markup.html': '<p>x</p>',
    }));
    const [note] = alignVocabulary(lib, pkg);
    expect(note.category).toMatchObject({ status: 'mapped', target: 'Cards' });
    expect(note.tags.map(t => [t.status, t.target])).toEqual([['mapped', '天气'], ['new', 'Weather icon'], ['new', '玻璃']]);
    expect(note.tags[1]).toMatchObject({ similar: ['天气'], labeled: false });
    expect(note.tags[2]).toMatchObject({ similar: [], labeled: true });

    importPackage(lib, pkg, 'skip');
    expect(lib.listCategories().map(c => c.name)).toEqual(['Cards']);
    expect(lib.getAsset('card').tags).toEqual(['天气', 'Weather icon', '玻璃']);
    expect(lib.repo.getTagLabels('玻璃')).toEqual({ en: 'Glass' });
  });

  it('新标签和分类同名时提示', () => {
    const lib = seeded();
    const pkg = parseFolderFiles(files({ 'card/asset.json': JSON.stringify({ category: 'Widgets', tags: ['cards', 'widgets'] }), 'card/html/markup.html': '<p>x</p>' }));
    const [note] = alignVocabulary(lib, pkg);
    expect(note.category).toMatchObject({ status: 'new', target: 'Widgets' });
    expect(note.tags.map(t => t.sameAsCategory)).toEqual([true, true]);
  });
});
