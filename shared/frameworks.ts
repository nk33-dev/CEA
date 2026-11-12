/**
 * 支持的实现方式。加一种框架：在这里登记，再在 server/bundler.ts 里补打包方式。
 */
export interface FrameworkInfo {
  id: string;
  label: string;
  /** 默认入口文件 */
  entry: string;
  /** 入口文件允许的扩展名 */
  entryExt: string[];
  /** 新建时的模板文件 */
  template: { path: string; content: string }[];
  /** 固定文件（不能删除、不能改名） */
  fixed?: string[];
}

export const FRAMEWORKS: FrameworkInfo[] = [
  {
    id: 'html',
    label: 'HTML',
    entry: 'markup.html',
    entryExt: ['html'],
    fixed: ['markup.html', 'style.css', 'script.js'],
    template: [
      { path: 'markup.html', content: '' },
      { path: 'style.css', content: '' },
      { path: 'script.js', content: '' },
    ],
  },
  {
    id: 'react',
    label: 'React',
    entry: 'Component.tsx',
    entryExt: ['tsx', 'jsx', 'ts', 'js'],
    template: [
      { path: 'Component.tsx', content: "import './style.css';\n\nexport default function Component() {\n  return <div />;\n}\n" },
      { path: 'style.css', content: '' },
    ],
  },
  {
    id: 'vue',
    label: 'Vue',
    entry: 'Component.vue',
    entryExt: ['vue'],
    template: [
      { path: 'Component.vue', content: '<script setup lang="ts">\n</script>\n\n<template>\n  <div />\n</template>\n\n<style>\n</style>\n' },
    ],
  },
];

export const FRAMEWORK_IDS = FRAMEWORKS.map(f => f.id);

export function framework(id: string): FrameworkInfo | undefined {
  return FRAMEWORKS.find(f => f.id === id);
}

export function frameworkLabel(id: string): string {
  return framework(id)?.label ?? id;
}
