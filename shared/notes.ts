import type { Variant } from './types.ts';

/**
 * 从代码里整理出给人看的说明，不用翻代码也知道：
 * - 动效参数：style.css 开头的 @motion 注释配上 CSS 变量的初始声明
 * - 附注：版权、许可和「Touch: …」这类带标签的说明注释
 */

export interface MotionParam {
  name: string;
  label: string;
  value: string;
}

export interface MotionGroup {
  title: string;
  target: string;
  params: MotionParam[];
}

export interface CodeNotes {
  motion: MotionGroup[];
  notes: string[];
}

function cssValues(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // 展示初始声明，不把后续主题或媒体查询的覆盖值当成默认值。
  for (const m of declarations.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    if (!map.has(m[1])) map.set(m[1], m[2].trim());
  }
  return map;
}

function parseMotion(css: string): MotionGroup[] {
  const block = /\/\*\s*@motion\s*\n([\s\S]*?)\*\//.exec(css);
  if (!block) return [];
  const values = cssValues(css);
  const groups: MotionGroup[] = [];
  for (const raw of block[1].split('\n')) {
    const line = raw.trim().replace(/^more\s+/, '');
    const head = /^\[(.+?)\]\s*(.*)$/.exec(line);
    if (head) {
      groups.push({ title: head[1], target: head[2], params: [] });
      continue;
    }
    const param = /^(--[\w-]+)\s*:\s*(.+)$/.exec(line);
    if (param && groups.length) groups[groups.length - 1].params.push({ name: param[1], label: param[2], value: values.get(param[1]) ?? '' });
  }
  return groups.filter(g => g.params.length);
}

/**
 * 只收需要使用者知道的注释：版权和许可，以及以下面这些词开头的说明（例如「Touch: …」会全局影响按钮）。
 * 解释某段代码在做什么的普通注释不收。遇到新的说明类型时在这里加词。
 */
const NOTE_PREFIX = /^(Touch|Touch press|Icons?|Fonts?|Credits?|Note|Notes|Requires?|Browser support|Global)\s*:/i;

function isNote(text: string) {
  return NOTE_PREFIX.test(text) || /licen[cs]e|copyright/i.test(text);
}

function parseNotes(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\/\*(?!\s*@motion)([\s\S]*?)\*\/|^[ \t]*\/\/(.+)$/gm)) {
    const text = (m[1] ?? m[2]).replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
    if (text && isNote(text)) out.push(text);
  }
  return out;
}

export function codeNotes(variant: Variant | undefined): CodeNotes {
  if (!variant) return { motion: [], notes: [] };
  const css = variant.files.filter(f => f.path.endsWith('.css')).map(f => f.content).join('\n');
  const notes = [...new Set(variant.files.flatMap(f => parseNotes(f.content)))]
    // 同一条许可在不同文件里写法略有不同（例如 Heroicons），只留最完整的一条
    .filter((n, _, all) => !all.some(o => o !== n && o.length > n.length && o.toLowerCase().includes(n.split(/[,(]/)[0].trim().toLowerCase())));
  return { motion: parseMotion(css), notes };
}
