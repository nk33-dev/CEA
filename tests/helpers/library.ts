import type { Library } from '../../server/library.ts';
import type { AssetInput, Variant } from '../../shared/types.ts';

// Synthetic parser and storage input; no collected component implementation.
const style = `/* @motion
[Tabs sliding] test indicator
--tabs-dur: Duration
*/
/* Icons: Heroicons (parser test label only; no icon code included). */
/* Touch: Synthetic input note. */
.wx { --tabs-dur: 250ms; color: black; }
`;

const variants: Variant[] = [
  {
    framework: 'html', entry: 'markup.html', dependencies: {},
    files: [
      { path: 'markup.html', content: '<div class="wx">Test</div>' },
      { path: 'style.css', content: style },
      { path: 'script.js', content: '(function () { document.querySelector(".wx")?.setAttribute("data-test", "ready"); })();' },
    ],
  },
  {
    framework: 'react', entry: 'WeatherDaySwitcher.tsx', dependencies: {},
    files: [
      { path: 'WeatherDaySwitcher.tsx', content: "import './style.css';\nexport default function TestCard() { return <div className=\"wx\">Test</div>; }" },
      { path: 'style.css', content: style },
    ],
  },
  {
    framework: 'vue', entry: 'WeatherDaySwitcher.vue', dependencies: {},
    files: [
      { path: 'WeatherDaySwitcher.vue', content: '<script setup lang="ts">\nimport "./style.css";\n</script>\n<template><div class="wx">Test</div></template>' },
      { path: 'style.css', content: style },
    ],
  },
].map(variant => ({ ...variant, theme: { version: 1, mode: 'original', default: 'light' } }));

export function seedTestLibrary(lib: Library): number {
  if (lib.repo.getAsset('weather-day-switcher')) return 0;
  const category = lib.repo.findCategoryByName('Cards') ?? lib.createCategory('Cards');
  const input: AssetInput = {
    id: 'weather-day-switcher',
    title: 'Weather Day Switcher',
    categoryId: category.id,
    tags: ['天气', '标签切换', '数字动画', '背景过渡'],
    sourceName: 'Synthetic test input',
    sourceUrl: 'https://example.invalid/test',
    texts: {
      en: { title: 'Weather Day Switcher', summary: 'Synthetic test card.', idea: 'Make a weather card for a test.' },
      zh: { title: '天气日期切换卡片', summary: '测试输入。', idea: '做一个用于测试的天气卡片。' },
    },
    variants: structuredClone(variants),
  };
  lib.createAsset(input);
  return 1;
}
