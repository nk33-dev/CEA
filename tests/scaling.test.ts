import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Library } from '../server/library.ts';
import { motionLabel, presentNote } from '../shared/notePresentation.ts';
import { htmlPlayPage } from '../server/play.ts';
import { readTagQuery, writeTagQuery } from '../shared/search.ts';

let dir: string;
let lib: Library;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-scaling-')); lib = Library.open(dir); });
afterEach(() => { lib.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function populate(n = 137) {
  const cat = lib.createCategory('Cards');
  lib.repo.transaction(() => {
    for (let i = 0; i < n; i++) {
      const id = `card-${String(i).padStart(4, '0')}`;
      lib.repo.insertAsset({ id, title: `Card ${i}`, type: 'component', categoryId: i % 2 ? cat.id : null, sourceName: '', sourceUrl: '', favorite: i % 5 === 0, cover: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
      lib.repo.setTexts(id, { zh: { summary: i % 2 ? '天气卡片' : '按钮', idea: '交叉淡入\n'.repeat(100) } });
      lib.repo.setVariants(id, [{ framework: i % 2 ? 'vue' : 'html', entry: 'App.vue', dependencies: {} }]);
      lib.repo.setTags(id, [i % 2 ? 'Motion' : 'Button', 'Shared']);
    }
  });
  return cat;
}

describe('服务端搜索与分页', () => {
  it('带逗号的标签在地址栏中完整保留，并兼容旧链接', () => {
    const tags = ['hover, focus', '天气'];
    expect(readTagQuery(writeTagQuery(tags)!)).toEqual(tags);
    expect(readTagQuery('天气,动效')).toEqual(['天气', '动效']);
    expect(readTagQuery('[invalid')).toEqual([]);
  });
  it('按稳定顺序分页，只返回当前页摘要，不发送全库思路文本', () => {
    populate();
    const first = lib.repo.searchAssets({});
    const second = lib.repo.searchAssets({ page: 2 });
    expect(first.total).toBe(137);
    expect(first.items).toHaveLength(24);
    expect(second.items).toHaveLength(24);
    expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(48);
    expect(first.items.every(a => a.searchText === '')).toBe(true);
    expect(JSON.stringify(first)).not.toContain('交叉淡入');
    expect(lib.repo.searchAssets({ limit: 999 }).items).toHaveLength(60);
  });

  it('中文、多个关键词、标签交集、框架和收藏共同生效', () => {
    const cat = populate();
    const result = lib.repo.searchAssets({ q: '天气 淡入', tags: ['motion', 'Shared'], category: cat.id, framework: 'vue', favorite: true });
    expect(result.total).toBe(14);
    expect(result.items.every(a => a.favorite && a.frameworks.includes('vue'))).toBe(true);
    expect(result.facets.tags.Motion).toBe(14);
    expect(lib.repo.searchAssets({ q: '%' }).total).toBe(0);
    expect(lib.repo.searchAssets({ q: "' OR 1=1" }).total).toBe(0);
  });

  it('一万项查询仍只返回固定数量的组件', () => {
    populate(10_000);
    const result = lib.repo.searchAssets({ q: '天气', limit: 24, page: 100 });
    expect(result.total).toBe(5000);
    expect(result.items).toHaveLength(24);
    expect(result.page).toBe(100);
  }, 30_000);

  it('复用匹配结果后，各筛选仍只排除自身条件，空结果计数完整', () => {
    const cat = populate(20);
    lib.repo.setVariants('card-0001', [
      { framework: 'html', entry: 'markup.html', dependencies: {} },
      { framework: 'vue', entry: 'App.vue', dependencies: {} },
    ]);
    const result = lib.repo.searchAssets({ category: cat.id, framework: 'html' });
    expect(result.items.map(a => a.id)).toEqual(['card-0001']);
    expect(result.facets.categories).toEqual({ null: 10, [cat.id]: 1 });
    expect(result.facets.frameworks).toEqual({ html: 1, vue: 10 });
    expect(result.facets.tags).toEqual({ Motion: 1, Shared: 1 });
    expect(result.facets.favorite).toBe(0);
    expect(lib.repo.searchAssets({ q: '不存在的词' })).toMatchObject({
      items: [], total: 0, facets: { categories: {}, frameworks: {}, tags: {}, favorite: 0 },
    });
  });
});

describe('批量整理', () => {
  it('标签合并和删除统一更新关联组件，错误输入不产生部分修改', () => {
    populate(8);
    expect(() => lib.manageTags(['Motion', 'missing'], 'delete')).toThrow(/不存在/);
    expect(lib.repo.listTags().some(t => t.name === 'Motion')).toBe(true);
    lib.manageTags(['Motion', 'Button'], 'merge', 'Interaction');
    expect(lib.repo.listTags()).toContainEqual({ name: 'Interaction', count: 8 });
    lib.manageTags(['Interaction'], 'delete');
    expect(lib.listAssets().every(a => a.tags.join() === 'Shared')).toBe(true);
  });

  it('批量标签与分类只修改元数据，删除前校验全部 ID', () => {
    const cat = populate(8);
    lib.manageAssets(['card-0000', 'card-0001'], 'tag', '精选');
    lib.manageAssets(['card-0000', 'card-0001'], 'category', cat.id);
    expect(lib.repo.getTags('card-0000')).toContain('精选');
    expect(lib.repo.getAsset('card-0000')?.categoryId).toBe(cat.id);
    expect(() => lib.manageAssets(['card-0000', 'missing'], 'delete')).toThrow(/不存在/);
    expect(lib.repo.getAsset('card-0000')).not.toBeNull();
    lib.manageAssets(['card-0000', 'card-0001'], 'delete');
    expect(lib.repo.countAssets()).toBe(6);
    expect(fs.readdirSync(dir).some(p => p.startsWith('.trash-'))).toBe(false);
  });

  it('可从指定组件移除标签，并按未分类、框架、来源或 ID 找组件', () => {
    populate(8);
    lib.repo.setTagLabels('Shared', { zh: '共享', en: 'Shared' });
    lib.manageAssets(['card-0000'], 'untag', 'SHARED');
    expect(lib.repo.getTags('card-0000')).not.toContain('Shared');
    expect(lib.repo.getTags('card-0001')).toContain('Shared');
    expect(lib.repo.getTagLabels('Shared')).toEqual({ zh: '共享', en: 'Shared' });
    expect(lib.repo.searchAssets({ category: '__uncategorized__' }).total).toBe(4);
    expect(lib.repo.searchAssets({ q: 'vue' }).total).toBe(4);
    expect(lib.repo.searchAssets({ q: 'card-0002' }).items.map(item => item.id)).toEqual(['card-0002']);
    lib.repo.updateAsset({ ...lib.repo.getAsset('card-0002')!, sourceName: 'Reference collection' });
    expect(lib.repo.searchAssets({ q: 'reference' }).total).toBe(1);
  });
});

describe('说明与独立主题', () => {
  it('常见附注和参数能切换语言，保留许可原文和链接', () => {
    const raw = 'Icons: Heroicons (outline), Copyright (c) Tailwind Labs, Inc. MIT License: https://example.com/LICENSE';
    expect(presentNote(raw, 'zh')).toMatchObject({ title: '图标与许可', body: 'Heroicons', raw, url: 'https://example.com/LICENSE' });
    expect(presentNote('Touch: controls never select text; hover only applies with a mouse.', 'zh').body).toContain('鼠标');
    expect(motionLabel('Duration', 'zh')).toBe('时长');
    expect(motionLabel('Duration', 'en')).toBe('Duration');
    expect(presentNote('Unknown vendor note', 'zh').body).toBe('Unknown vendor note');
  });

  it('注释里「| zh: 中文」按语言显示，英文界面不露出译文', () => {
    const raw = 'Touch: the pointer field only follows a mouse. | zh: 斥力场只跟随鼠标。';
    expect(presentNote(raw, 'zh')).toMatchObject({ title: '触屏与鼠标', body: '斥力场只跟随鼠标。', original: 'The pointer field only follows a mouse.' });
    expect(presentNote(raw, 'en')).toMatchObject({ title: 'Touch & pointer', body: 'The pointer field only follows a mouse.' });
    expect(presentNote('Credits: Natural Earth (public domain). | zh: 取自 Natural Earth（公有领域）。', 'zh').title).toBe('来源');
    expect(motionLabel('Signal size | zh: 信号点大小', 'zh')).toBe('信号点大小');
    expect(motionLabel('Signal size | zh: 信号点大小', 'en')).toBe('Signal size');
    expect(motionLabel('a | b', 'zh')).toBe('a | b');
  });

  it('舞台背景与组件主题使用独立的状态和消息', () => {
    const page = htmlPlayPage('Test', [{ path: 'markup.html', content: '<button>OK</button>' }]);
    expect(page).toContain('data-background="dark"');
    expect(page).toContain("d.type==='cea:component-theme'");
    expect(page).toContain("document.documentElement.dataset.background");
    expect(page).toContain("document.documentElement.classList.toggle('dark'");
  });
});
