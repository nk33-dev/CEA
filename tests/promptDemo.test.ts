import { describe, expect, it } from 'vitest';
import { buildIdeaPrompt, buildReplicaPrompt, buildSource } from '../shared/prompt.ts';
import { en } from '../shared/i18n/en.ts';
import { zh } from '../shared/i18n/zh.ts';
import type { Variant } from '../shared/types.ts';

const markup = '<article><button data-demo-only>Preview weather</button><button>Next day</button></article>';
const html: Variant = {
  framework: 'html', entry: 'markup.html', dependencies: {},
  files: [{ path: 'markup.html', content: markup }],
};
const vue: Variant = {
  framework: 'vue', entry: 'Weather.vue', dependencies: {},
  files: [{ path: 'Weather.vue', content: '<template><button>Next day</button></template>' }],
};
const asset = {
  title: 'Weather', sourceName: '', sourceUrl: '', variants: [html, vue],
  texts: {
    zh: { summary: '', idea: '做一个随每日预报切换天空的天气卡片。' },
    en: { summary: '', idea: 'A weather card whose sky follows the daily forecast.' },
  },
};

describe('预览演示控件的复刻边界', () => {
  it.each(['zh', 'en', 'zh-Hant', 'fr'])('复刻按语言包提示移除标记控件，并保留完整源码（%s）', locale => {
    const prompt = buildReplicaPrompt(asset, { framework: 'html', locale });
    const pack = locale.startsWith('zh') ? zh : en;
    expect(prompt).toContain(pack.demoOnly);
    expect(prompt.indexOf(pack.demoOnly)).toBeLessThan(prompt.indexOf('```'));
    expect(prompt).toContain(markup);
    expect(buildSource(asset, 'html')).toContain(markup);
  });

  it('只检查选中的框架，不给没有演示标记的实现追加说明', () => {
    const prompt = buildReplicaPrompt(asset, { framework: 'vue', locale: 'zh' });
    expect(prompt).not.toContain(zh.demoOnly);
    expect(prompt).toContain(vue.files[0].content);
  });

  it.each([
    '<button data-demo-only />',
    '<button data-demo-only="weather" />',
    '<button data-demo-only={true}>Preview</button>',
    'host.innerHTML = `<button data-demo-only>Preview</button>`;',
  ])('HTML、框架模板和共享渲染模块均可声明演示控件', content => {
    const marked = { ...asset, variants: [{ ...html, files: [{ path: 'script.js', content }] }] };
    expect(buildReplicaPrompt(marked, { framework: 'html', locale: 'zh' })).toContain(zh.demoOnly);
  });

  it('不把相似属性名和普通业务选择器当成演示标记', () => {
    const unmarked = { ...asset, variants: [{ ...html, files: [{
      path: 'markup.html', content: '<select data-demo-only-extra><option>City</option></select>',
    }] }] };
    expect(buildReplicaPrompt(unmarked, { framework: 'html', locale: 'zh' })).not.toContain(zh.demoOnly);
  });

  it('思路仅返回目标描述，不追加演示控件规则或源码', () => {
    expect(buildIdeaPrompt(asset, { locale: 'zh' })).toBe(asset.texts.zh.idea + '\n');
    expect(buildIdeaPrompt(asset, { locale: 'en' })).toBe(asset.texts.en.idea + '\n');
    expect(buildIdeaPrompt(asset, { locale: 'zh', targetTheme: 'light' })).not.toMatch(/data-demo-only|演示控件|预览演示|```/);
  });

  it('复刻明确保留全部状态和强度效果，只移除手动演示控件', () => {
    const chinese = buildReplicaPrompt(asset, { framework: 'html', locale: 'zh' });
    expect(chinese).toContain('仅移除这些控件及其专用样式和手动选值事件');
    expect(chinese).toContain('完整保留所有业务状态、强度档位及对应的渲染逻辑、动效和业务交互');
    expect(chinese).toContain('改由项目业务数据触发');
    const english = buildReplicaPrompt(asset, { framework: 'html', locale: 'en' });
    expect(english).toContain('remove only those controls');
    expect(english).toContain('Fully preserve every business state, intensity level, rendering path, animation and business interaction');
  });
});
