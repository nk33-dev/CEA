import { createElement, type KeyboardEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TranslationEditor } from '../src/components/TranslationEditor.tsx';
import { handleTabKeys } from '../src/lib/tabKeys.ts';
import { findLanguages } from '../src/lib/languageOptions.ts';
import { LanguagePicker } from '../src/components/LanguagePicker.tsx';

describe('译名编辑器', () => {
  it('多个语言只提供一个译名输入区，保留全部语言入口与填写状态', () => {
    const value = { en: 'Hero', zh: '首屏', fr: 'En-tête', 'pt-BR': 'Cabeçalho', ar: 'واجهة' };
    const html = renderToStaticMarkup(createElement(TranslationEditor, {
      name: 'Hero', value, initialLocale: 'pt-BR', onChange: () => {},
    }));
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html.match(/class="translation-value"/g)).toHaveLength(1);
    expect(html).toContain('value="Cabeçalho"');
    expect(html).toContain('lang="pt-BR" dir="auto"');
    expect(html).toContain('搜索译名语言');
    expect(html).toContain('添加语言');
    expect(html).toContain('5 / 5 已填写');
    expect(html).not.toContain('value="首屏"');
    expect(html).not.toContain('translation-state');
    expect(html).not.toContain('lucide-check');
    expect(value.zh).toBe('首屏');
  });

  it('大量语言仍只渲染一个编辑输入，保存中禁用整组控件', () => {
    const value = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`en-${String(i).padStart(3, '0')}`, `Name ${i}`]));
    const html = renderToStaticMarkup(createElement(TranslationEditor, {
      name: 'Hero', value, initialLocale: 'invalid', disabled: true, onChange: () => {},
    }));
    expect(html.match(/class="translation-value"/g)).toHaveLength(1);
    expect(html.match(/<input\b/g)).toHaveLength(2);
    expect(html).toContain('<fieldset class="translation-editor" disabled=""');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).not.toContain('--translation-list-height');
  });

  it('少量语言沿用同一布局，不按语言数量设置动态高度', () => {
    const html = renderToStaticMarkup(createElement(TranslationEditor, {
      name: 'Canvas', value: { en: 'Canvas', zh: 'Canvas' }, initialLocale: 'en', onChange: () => {},
    }));
    expect(html).not.toContain('--translation-list-height');
  });
});

describe('语言选择器', () => {
  it('标准语言清单可按中文、英文、本地名称和代码搜索', () => {
    expect(findLanguages('').length).toBeGreaterThan(180);
    for (const query of ['日语', 'Japanese', '日本語', 'ja']) expect(findLanguages(query).map(language => language.id)).toContain('ja');
    expect(findLanguages('Francais').map(language => language.id)).toContain('fr');
    expect(findLanguages('pt-br').map(language => language.id)).toContain('pt-BR');
    expect(findLanguages('../bad')).toEqual([]);
  });

  it('已添加语言明确标记且禁用，没有启用式勾选；语言代码为可展开入口', () => {
    const html = renderToStaticMarkup(createElement(LanguagePicker, { existing: ['en', 'zh'], onSelect: () => {}, onClose: () => {} }));
    expect(html).toContain('已添加');
    expect(html).toContain('搜索可添加语言');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('lucide-check');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('placeholder="如 pt-BR');
    expect(html).toContain('使用地区或自定义语言代码');
  });
});

describe('共用标签页键盘操作', () => {
  function harness(vertical: boolean) {
    const buttons = Array.from({ length: 3 }, () => ({ focus: vi.fn(), click: vi.fn() }));
    const event = (key: string) => ({
      key, preventDefault: vi.fn(), target: { closest: () => buttons[1] },
      currentTarget: { getAttribute: () => vertical ? 'vertical' : null, querySelectorAll: () => buttons },
    } as unknown as KeyboardEvent<HTMLElement>);
    return { buttons, event };
  }
  it('竖向语言列表用上下键切换，Home/End 定位首尾', () => {
    const { buttons, event } = harness(true);
    handleTabKeys(event('ArrowDown'));
    expect(buttons[2].click).toHaveBeenCalledOnce();
    handleTabKeys(event('ArrowUp'));
    expect(buttons[0].click).toHaveBeenCalledOnce();
    handleTabKeys(event('Home'));
    expect(buttons[0].focus).toHaveBeenCalledTimes(2);
    handleTabKeys(event('ArrowRight'));
    expect(buttons[2].click).toHaveBeenCalledOnce();
  });
  it('横向标签页保留左右键行为，不拦截上下键', () => {
    const { buttons, event } = harness(false);
    handleTabKeys(event('ArrowRight'));
    expect(buttons[2].click).toHaveBeenCalledOnce();
    handleTabKeys(event('ArrowUp'));
    expect(buttons[0].click).not.toHaveBeenCalled();
  });
});
