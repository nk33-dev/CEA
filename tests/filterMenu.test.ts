import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilterMenu } from '../src/components/FilterMenu.tsx';

const options = Array.from({ length: 10000 }, (_, i) => ({
  value: `tag-${i}`, label: `Tag ${i}`, count: 1,
}));

describe('大规模标签筛选', () => {
  it('关闭时只渲染触发按钮，不把一万个选项放进页面', () => {
    const html = renderToStaticMarkup(createElement(FilterMenu, {
      label: '标签', options, selected: [], multiple: true, onChange: () => {},
    }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('fmenu-item');
    expect(html).not.toContain('Tag 9999');
    expect(html.length).toBeLessThan(1000);
  });

  it('多选时只显示数量，单选名称按大小写无关的值匹配', () => {
    const make = (selected: string[]) => renderToStaticMarkup(createElement(FilterMenu, {
      label: '标签', options, selected, multiple: true, onChange: () => {},
    }));
    expect(make(options.slice(0, 30).map(o => o.value))).toContain('标签 · 30');
    expect(make(['TAG-9999'])).toContain('标签：Tag 9999');
  });
});
