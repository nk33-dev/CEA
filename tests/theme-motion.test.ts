import { expect, test } from 'vitest';
import postcss from 'postcss';
import { themeMotion } from '../build/themeMotion.ts';

test('theme motion follows color owners and preserves local transition properties', async () => {
  const result = await postcss([themeMotion()]).process(`
    :root { --fg: #111; --surface: white; }
    .panel { background: var(--surface); color: var(--fg); }
    .button { color: var(--fg); transition: transform 150ms ease, color 100ms ease; }
    .container { display: grid; }
    .preview { background: var(--preview-light); transition: background-color 240ms ease; }
    .loader { transition: opacity 160ms ease; }
    @media(max-width:600px) { .panel { border-color: var(--fg); } }
    @keyframes pulse { to { color: var(--fg); } }
  `, { from: 'fixture.css' });
  const layer = result.root.first!;
  expect(layer.type).toBe('atrule');
  expect(layer.toString()).toContain('.panel');
  expect(layer.toString()).toContain('@media');
  expect(layer.toString()).not.toContain('.container');
  expect(layer.toString()).not.toContain('.preview');
  expect(layer.toString()).not.toContain('.loader');
  expect(layer.toString()).not.toContain('@keyframes');
  const declarations: string[] = [];
  result.root.walkRules('.button', rule => {
    rule.walkDecls('transition', declaration => { declarations.push(declaration.value); });
  });
  expect(declarations).toContain('transform 150ms ease, color 100ms ease, var(--ui-theme-colors, --cea-noop 0s)');
  expect(result.css).toContain('.loader { transition: opacity 160ms ease; }');
  expect(result.css).toContain('.preview { background: var(--preview-light); transition: background-color 240ms ease; }');
});

test('SVG graphics and syntax tokens receive theme timing without a runtime element scan', async () => {
  const result = await postcss([themeMotion()]).process(`
    .brand-mark { color: var(--fg); transition: transform 400ms ease; }
    .brand-mark rect { fill: currentColor; }
    .brand-mark .accent { fill: #ff5a1f; }
    .comment { color: var(--syntax-comment); }
  `, { from: 'fixture.css' });
  const defaults = result.root.first!.toString();
  expect(defaults).toContain('.brand-mark');
  expect(defaults).toContain('.comment');
  expect(defaults).not.toContain('rect');
  expect(defaults).not.toContain('.accent');
});

test('nested CSS keeps its scope and appends local timing only once', async () => {
  const result = await postcss([themeMotion()]).process(`
    .panel {
      color: var(--fg);
      .button { color: var(--fg-2); transition: transform 150ms ease; }
    }
  `, { from: 'fixture.css' });
  const defaults = result.root.first!.toString();
  expect(defaults).toContain('.panel');
  expect(defaults).toContain('.button');
  expect(result.css).not.toContain('var(--ui-theme-colors, --cea-noop 0s), var(--ui-theme-colors');
});
