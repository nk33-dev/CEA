import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strFromU8, strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanLabels, labelSearch, localizedName, localizedTitle } from '../shared/contentLocale.ts';
import { Library } from '../server/library.ts';
import { migrate } from '../server/db/schema.ts';
import { exportLibrary, exportReferencePackage, importPackage, parsePackage, parsePackageFiles, unzipSafe } from '../server/transfer/zip.ts';
import { folderFiles, parseFolderFiles } from '../server/transfer/folder.ts';
import { buildReplicaPrompt } from '../shared/prompt.ts';
import type { AssetInput } from '../shared/types.ts';
import { htmlPlayPage, bundlePlayPage } from '../server/play.ts';

const libraries: Library[] = [];
const dirs: string[] = [];
const input: AssetInput = {
  title: 'World Map Hero', categoryId: null, tags: ['地图'], sourceUrl: '', sourceName: '',
  texts: {
    zh: { title: '世界地图', summary: '透明点阵地图', idea: '绘制点阵地图' },
    en: { title: 'World Map', summary: 'A transparent dotted map', idea: 'Draw a dotted map' },
  },
  variants: [{ framework: 'html', entry: 'markup.html', dependencies: {}, files: [
    { path: 'markup.html', content: '<select aria-label="Year"><option>2026</option><option>2025</option></select>' },
  ] }],
};

function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-locales-'));
  dirs.push(dir);
  const lib = Library.open(dir);
  libraries.push(lib);
  return lib;
}

afterEach(() => {
  for (const lib of libraries.splice(0)) lib.close();
  for (const dir of dirs.splice(0)) {
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('cea-locales-')) throw new Error('Unexpected test directory');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('内容语言', () => {
  it('缺少译名时回退到原名，不改原始名称或 ID', () => {
    expect(localizedTitle({ title: 'Original', texts: { zh: { title: '中文名称', summary: '', idea: '' } } }, 'zh')).toBe('中文名称');
    expect(localizedTitle({ title: 'Original', titles: { en: 'English' } }, 'zh')).toBe('Original');
    expect(localizedName('地图', { en: 'Map' }, 'en')).toBe('Map');
    expect(localizedName('地图', { en: 'Map' }, 'zh')).toBe('地图');
    expect(labelSearch('地图', { en: 'Map' })).toContain('map');
  });

  it('保留合法语言的文本译名，拒绝把任意对象转为字符串', () => {
    expect(cleanLabels({ en: '  Map  ', zh: '', fr: 'Carte', x: 1 })).toEqual({ en: 'Map', fr: 'Carte' });
    expect(cleanLabels(['Map'])).toEqual({});
    expect(cleanLabels({ en: {} })).toEqual({});
    expect(cleanLabels({ en: 'long name' }, 4)).toEqual({ en: 'long' });
  });

  it('迁移旧库后原有文案保留，译名字段可选', () => {
    const lib = open();
    const asset = lib.createAsset(input);
    lib.close();
    libraries.pop();
    const db = new DatabaseSync(path.join(lib.root, 'library.db'));
    db.exec("alter table variants drop column theme; alter table asset_texts drop column theme_ideas; alter table asset_texts drop column title; alter table tags drop column labels; alter table categories drop column labels; update meta set value='5' where key='schema_version'");
    migrate(db, lib.root);
    expect(db.prepare('select title from asset_texts').all()).toEqual([{ title: '' }, { title: '' }]);
    db.close();
    const restored = Library.open(lib.root);
    libraries.push(restored);
    expect(restored.getAsset(asset.id).texts.zh.summary).toBe(input.texts.zh.summary);
    expect(restored.getAsset(asset.id).title).toBe(input.title);
  });

  it('标题译名独立保存，列表摘要和中英文全文搜索可用', () => {
    const lib = open();
    const asset = lib.createAsset(input);
    expect(asset.texts.zh.title).toBe('世界地图');
    expect(lib.listAssets()[0].titles).toEqual({ zh: '世界地图', en: 'World Map' });
    for (const q of ['世界地图', 'World Map', '透明', 'dotted']) {
      expect(lib.repo.searchAssets({ q }).items.map(a => a.id)).toEqual([asset.id]);
    }
    const updated = lib.updateAsset(asset.id, { ...input, texts: { zh: { title: '只有标题', summary: '', idea: '' } } });
    expect(updated.id).toBe(asset.id);
    expect(updated.texts.zh).toEqual({ title: '只有标题', summary: '', idea: '' });
  });

  it('分类和标签译名参与搜索，筛选仍使用原始标识', () => {
    const lib = open();
    const category = lib.createCategory('Cards');
    lib.updateCategory(category.id, { labels: { zh: '交互卡片', en: 'Interactive cards' } });
    const asset = lib.createAsset({ ...input, categoryId: category.id });
    lib.setTagLabels('地图', { en: 'Geography', zh: '地理' });
    for (const q of ['Geography', '地理', '交互卡片', 'Interactive cards']) {
      expect(lib.repo.searchAssets({ q, tags: ['地图'], category: category.id }).total).toBe(1);
    }
    expect(lib.getAsset(asset.id).tags).toEqual(['地图']);
    expect(lib.getAsset(asset.id).categoryId).toBe(category.id);
  });

  it('重命名、合并标签保留译名，目标标签已有译名优先', () => {
    const lib = open();
    lib.createAsset({ ...input, tags: ['地图', 'Map'] });
    lib.setTagLabels('地图', { en: 'Geography', zh: '地理' });
    lib.setTagLabels('Map', { en: 'World map' });
    lib.renameTag('地图', 'Map');
    expect(lib.repo.getTagLabels('map')).toEqual({ en: 'World map', zh: '地理' });
    lib.renameTag('Map', 'Atlas');
    expect(lib.repo.getTagLabels('atlas')).toEqual({ en: 'World map', zh: '地理' });
  });

  it('搜索只匹配译名内容，不匹配语言键名', () => {
    const lib = open();
    lib.createAsset({ ...input, title: 'Map', texts: {} });
    lib.setTagLabels('地图', { en: 'Atlas', zh: '地理' });
    expect(lib.repo.searchAssets({ q: 'en' }).total).toBe(0);
    expect(lib.repo.searchAssets({ q: 'Atlas' }).total).toBe(1);
  });

  it('仍可读取没有译名字段的 v2 备份', () => {
    const lib = open();
    lib.createAsset(input);
    const files = unzipSafe(exportLibrary(lib));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.formatVersion = 2;
    for (const a of manifest.assets) {
      delete a.tagLabels;
      for (const text of Object.values(a.texts) as { title?: string }[]) delete text.title;
    }
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const target = open();
    importPackage(target, parsePackageFiles(files), 'skip');
    expect(target.listAssets()[0].summaries.zh).toBe(input.texts.zh.summary);
    expect(target.listAssets()[0].titles).toEqual({});
  });

  it.each(['backup', 'folder'] as const)('%s 往返保留全部文案和分类标签译名', format => {
    const lib = open();
    const category = lib.createCategory('Hero');
    lib.updateCategory(category.id, { labels: { en: 'Hero', zh: '首屏' } });
    const asset = lib.createAsset({ ...input, categoryId: category.id });
    lib.setTagLabels('地图', { en: 'Map', zh: '地图' });
    const pkg = format === 'backup' ? parsePackage(exportLibrary(lib)) : parseFolderFiles(folderFiles(lib));
    const target = open();
    importPackage(target, pkg, 'skip');
    expect(target.getAsset(asset.id).texts).toEqual(asset.texts);
    expect(target.listCategories()[0].labels).toEqual({ en: 'Hero', zh: '首屏' });
    expect(target.repo.getTagLabels('地图')).toEqual({ en: 'Map', zh: '地图' });
  });

  it.each(['backup', 'folder'] as const)('%s 保留未安装语言包的文案、主题思路和数字地区码', format => {
    const lib = open();
    const category = lib.createCategory('Hero');
    lib.updateCategory(category.id, { labels: { fr: 'En-tête', 'es-419': 'Portada' } });
    const texts = {
      ...input.texts,
      'pt-br': { title: 'Mapa', summary: 'Um mapa', idea: 'Mapa interativo', themeIdeas: { light: 'Mapa claro' } },
      'es-419': { title: 'Mapa mundial', summary: 'Mapa transparente', idea: 'Dibujar un mapa' },
      ar: { title: 'خريطة', summary: 'خريطة العالم', idea: 'خريطة تفاعلية' },
    };
    const asset = lib.createAsset({ ...input, categoryId: category.id, texts });
    expect(asset.texts['pt-BR'].themeIdeas?.light).toBe('Mapa claro');
    lib.setTagLabels('地图', { 'pt-BR': 'Mapa', ar: 'خريطة' });
    const pkg = format === 'backup' ? parsePackage(exportLibrary(lib)) : parseFolderFiles(folderFiles(lib));
    const target = open();
    importPackage(target, pkg, 'skip');
    expect(target.getAsset(asset.id).texts).toEqual(asset.texts);
    expect(target.listCategories()[0].labels).toEqual(lib.listCategories()[0].labels);
    expect(target.repo.getTagLabels('地图')).toEqual(lib.repo.getTagLabels('地图'));
    expect(target.repo.searchAssets({ q: 'interativo' }).total).toBe(1);
  });

  it('旧客户端遗漏外部语言时保留内容，显式清空该语言时才移除', () => {
    const lib = open();
    const asset = lib.createAsset({ ...input, texts: { ...input.texts, fr: { summary: 'Carte', idea: 'Carte interactive' } } });
    const saved = lib.updateAsset(asset.id, input);
    expect(saved.texts.fr.idea).toBe('Carte interactive');
    const cleared = lib.updateAsset(asset.id, { ...input, texts: { ...input.texts, fr: { summary: '', idea: '' } } });
    expect(cleared.texts.fr).toBeUndefined();
  });

  it('参考包保留第三语言原始思路，非法或重复语言码在写文件前拒绝', () => {
    const lib = open();
    const asset = lib.createAsset({ ...input, texts: { fr: { title: 'Carte', summary: '', idea: 'Carte interactive' } } });
    const files = unzipSafe(exportReferencePackage(lib, asset.id));
    expect(strFromU8(files['prompts/idea.fr.md'])).toBe('Carte interactive\n');
    expect(() => lib.updateAsset(asset.id, { ...input, texts: { 'pt-br': input.texts.en, 'pt-BR': input.texts.zh } })).toThrow(/重复/);
    expect(lib.getAsset(asset.id).texts.fr.idea).toBe('Carte interactive');
    const pkg = unzipSafe(exportLibrary(lib));
    const manifest = JSON.parse(strFromU8(pkg['manifest.json']));
    manifest.assets[0].texts = { '../fr': input.texts.en };
    pkg['manifest.json'] = strToU8(JSON.stringify(manifest));
    expect(() => parsePackageFiles(pkg)).toThrow(/语言代码无效/);
  });

  it('提示词名称跟随内容语言，源码不受切换影响', () => {
    const asset = open().createAsset(input);
    const zh = buildReplicaPrompt(asset, { locale: 'zh', framework: 'html' });
    const en = buildReplicaPrompt(asset, { locale: 'en', framework: 'html' });
    expect(zh).toContain('把「世界地图」组件');
    expect(en).toContain('"World Map"');
    expect(zh.slice(zh.indexOf('```'))).toBe(en.slice(en.indexOf('```')));
  });

  it('所有框架的播放页在 iframe 内绘制选择器弹层，源码本身不被修改', () => {
    for (const page of [htmlPlayPage('Test', input.variants[0].files), bundlePlayPage('Test', '', null)]) {
      expect(page).toContain('@supports (appearance:base-select)');
      expect(page).toContain('::picker(select)');
    }
    expect(input.variants[0].files[0].content).not.toContain('base-select');
  });
});
