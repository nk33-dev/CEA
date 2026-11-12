import { expect, it } from 'vitest';
import { parseReplicaPrompt } from '../shared/prompt.ts';

it('普通 HTML 页面拆分为结构、样式与脚本，不编造来源', () => {
  const parsed = parseReplicaPrompt('<!doctype html><html><head><title>My Card</title><style>.card{color:red}</style></head><body><div class="card">Hi</div><script>console.log(1)</script></body></html>');
  expect(parsed).toMatchObject({
    title: 'My Card', sourceName: '', sourceUrl: '',
    markup: '<div class="card">Hi</div>\n', style: '.card{color:red}\n', script: 'console.log(1)\n',
  });
});

it('任意来源的 HTML 代码块可以粘贴', () => {
  expect(parseReplicaPrompt('My example\n\n```html\n<button>Go</button>\n```')?.markup.trim()).toBe('<button>Go</button>');
});

it('中文复刻提示词可以识别名称及三段代码', () => {
  expect(parseReplicaPrompt('把「测试卡片」组件加到我的项目里。\n结构:\n```html\n<div>测试</div>\n```\n样式:\n```css\n.a{}\n```\n脚本（在结构之后运行一次）:\n```js\nconsole.log(1)\n```'))
    .toMatchObject({ title: '测试卡片', markup: '<div>测试</div>', style: '.a{}', script: 'console.log(1)' });
});

it('名称和代码均不要求平台来源', () => {
  expect(parseReplicaPrompt('Add the "Card" component to my project.\nMarkup:\n```html\n<p>Card</p>\n```'))
    .toMatchObject({ title: 'Card', sourceName: '', sourceUrl: '', markup: '<p>Card</p>' });
});

it('无代码的说明和 Vue 源码不当作 HTML 覆盖表单', () => {
  expect(parseReplicaPrompt('Add the "Card" component to my project.')).toBeNull();
  expect(parseReplicaPrompt('随便一段话')).toBeNull();
  expect(parseReplicaPrompt('<template><div>Vue</div></template>')).toBeNull();
});
