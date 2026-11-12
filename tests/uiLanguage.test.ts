import { afterEach, describe, expect, it } from 'vitest';
import { uiI18n, uiText } from '../src/lib/uiI18n.ts';
import { en } from '../shared/i18n/ui/en.ts';

afterEach(async () => { await uiI18n.changeLanguage('zh'); });

describe('CEA 界面语言', () => {
  it('中英文使用独立界面资源，支持插值并保留用户文字', async () => {
    expect(uiText('搜索组件')).toBe('搜索组件');
    await uiI18n.changeLanguage('en');
    expect(uiText('搜索组件')).toBe('Search components');
    expect(uiText('删除 {{value0}} 个组件？', { value0: 3 })).toBe('Delete 3 components?');
    expect(uiText(' 编辑 ')).toBe(' Edit ');
    expect(uiText('Personal component name')).toBe('Personal component name');
    expect(uiText('未收录的用户名称')).toBe('未收录的用户名称');
  });

  it('英文资源非空，插值参数与中文原文一致', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe('');
      const variables = (text: string) => [...text.matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1]).sort();
      expect(variables(value), key).toEqual(variables(key));
    }
  });
});
