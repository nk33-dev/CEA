import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceControl } from '../src/components/ChoiceControl.tsx';
import { SelectControl } from '../src/components/SelectControl.tsx';
import { CopyButton } from '../src/components/CopyButton.tsx';
import { LibraryProvider } from '../src/lib/store.tsx';
import { reuseThemeOptions } from '../src/lib/themeChoices.ts';
import { resolveTheme } from '../shared/theme.ts';
import { AppearanceToggle } from '../src/components/AppearanceToggle.tsx';

const props = {
  label: '语言',
  value: 'zh',
  onChange: () => {},
  options: [{ value: 'en', label: 'EN' }, { value: 'zh', label: '中文' }],
};

describe('统一选择控件', () => {
  it('AI 配色目标始终明确，原配色和改写要求不互相替代', () => {
    expect(reuseThemeOptions()).toEqual([
      { value: 'original', label: '沿用原配色' }, { value: 'light', label: '浅色' },
      { value: 'dark', label: '深色' }, { value: 'both', label: '浅色 + 深色' },
    ]);
  });

  it('只有明确声明的双主题显示组件切换，不用舞台背景冒充组件主题', () => {
    for (const mode of ['original', 'light', 'dark', 'both'] as const) {
      const support = resolveTheme({ theme: { version: 1, mode, default: mode === 'dark' ? 'dark' : 'light' }, files: [] });
      const html = renderToStaticMarkup(createElement(AppearanceToggle, { support, value: 'light', onChange: () => {} }));
      if (mode === 'both') expect(html).toContain('aria-label="组件主题"');
      else expect(html).toBe('');
    }
    const support = resolveTheme({ files: [{ path: 'style.css', content: '[data-theme="dark"] .x { color:white }' }] });
    expect(renderToStaticMarkup(createElement(AppearanceToggle, { support, value: 'light', onChange: () => {} }))).toBe('');
  });
  it('紧凑切换与文字切换都使用原生单选，保留选中值和禁用状态', () => {
    for (const tabs of [false, true]) {
      const html = renderToStaticMarkup(createElement(ChoiceControl, { ...props, tabs, disabled: true }));
      expect(html).toContain('role="radiogroup" aria-label="语言"');
      expect(html.match(/type="radio"/g)).toHaveLength(2);
      expect(html).toMatch(/disabled=""[^>]*checked=""[^>]*value="zh"/);
      expect(html).not.toContain('<button');
      expect(html.match(/class="selection-indicator/g)).toHaveLength(1);
      expect(html).toContain('hidden="" aria-hidden="true"');
    }
  });

  it('不同控件使用独立的单选组，切换语言不影响主题或格式', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(ChoiceControl, props),
      createElement(ChoiceControl, { ...props, label: '主题' }),
    ));
    const names = [...html.matchAll(/name="([^"]+)"/g)].map(match => match[1]);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(2);
  });

  it('说明型选项使用原生单选列表，不创建滑块，保留名称与禁用状态', () => {
    const html = renderToStaticMarkup(createElement(ChoiceControl, { ...props, list: true, disabled: true }));
    expect(html).toContain('choice-control choice-list');
    expect(html).toContain('role="radiogroup" aria-label="语言"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/disabled=""[^>]*checked=""[^>]*value="zh"/);
    expect(html).not.toContain('selection-indicator');
  });

  it('排序沿用共享下拉的语义和样式，不使用独立菜单', () => {
    const html = renderToStaticMarkup(createElement(SelectControl, {
      label: '排序', value: 'updated', onValueChange: () => {}, filter: true,
      options: [{ value: 'updated', label: '最近更新' }],
    }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('cea-select-trigger is-filter');
    expect(html).toContain('aria-label="排序"');
    expect(html).not.toContain('sort-menu');
  });

  it('复制按钮为原文字和成功反馈预留同一块空间', () => {
    const html = renderToStaticMarkup(createElement(LibraryProvider, {
      children: createElement(CopyButton, { label: '复制提示词', text: () => 'Text' }),
    }));
    expect(html).toContain('class="copy-label"');
    expect(html.match(/class="copy-label-size"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="复制提示词"');
  });
});
