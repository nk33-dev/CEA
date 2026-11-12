import type { AssetDetail, CodeFile, Variant } from './types.ts';
import { fenceLang } from './paths.ts';
import { locale } from './locales.ts';
import { localizedTitle, translatedValue } from './contentLocale.ts';
import { resolveTheme, themePrompt, type ReuseTheme } from './theme.ts';

/**
 * 每个素材提供三种复用内容，都从素材本身生成：
 * 1. 源码：选中框架的完整代码
 * 2. 复刻提示词：集成要求随语言变化，下面是选中框架的代码
 * 3. 思路提示词：选中语言的描述，不含代码
 */

type PromptAsset = Pick<AssetDetail, 'title' | 'texts' | 'variants' | 'sourceUrl' | 'sourceName'>;

export interface ReuseOptions {
  framework: string;
  locale: string;
  targetTheme?: ReuseTheme;
}

export function pickVariant(asset: Pick<AssetDetail, 'variants'>, framework: string): Variant | undefined {
  return asset.variants.find(v => v.framework === framework) ?? asset.variants[0];
}

/** 简介、思路使用统一的内容语言回退，不改变保存的原文。 */
export function pickText(asset: Pick<AssetDetail, 'texts'>, id: string, field: 'summary' | 'idea'): string {
  return translatedValue(asset.texts, id, text => text[field]);
}

const HTML_ORDER = ['markup.html', 'style.css', 'script.js'] as const;

/** 入口文件在前；HTML 实现按结构、样式、脚本排列 */
function orderedFiles(v: Variant): CodeFile[] {
  const nonEmpty = v.files.filter(f => f.content.trim() !== '');
  if (v.framework === 'html') {
    const fixed = HTML_ORDER.map(p => nonEmpty.find(f => f.path === p)).filter((f): f is CodeFile => !!f);
    return [...fixed, ...nonEmpty.filter(f => !HTML_ORDER.includes(f.path as never))];
  }
  const entry = nonEmpty.filter(f => f.path === v.entry);
  return [...entry, ...nonEmpty.filter(f => f.path !== v.entry)];
}

function fence(path: string, content: string) {
  return '```' + fenceLang(path) + '\n' + content.replace(/\s+$/, '') + '\n```';
}

export interface SourcePart {
  /** 多文件时写在文件前的注释，例如 // Button.tsx */
  label: string | null;
  lang: string;
  code: string;
}

/** 源码分段：HTML 合成一个可直接打开的页面；其他框架按文件列出，文件名写在注释里 */
export function sourceParts(asset: PromptAsset, framework: string): SourcePart[] {
  const v = pickVariant(asset, framework);
  if (!v) return [];
  if (v.framework === 'html') {
    const get = (p: string) => v.files.find(f => f.path === p)?.content.trim() ?? '';
    const style = get('style.css');
    const script = get('script.js');
    const doc = [
      '<!doctype html>',
      v.theme && v.theme.mode !== 'original' ? `<html lang="en" data-theme="${v.theme.default}"${v.theme.default === 'dark' ? ' class="dark"' : ''}>` : '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${asset.title}</title>`,
      style && `<style>\n${style}\n</style>`,
      '</head>',
      '<body>',
      get('markup.html'),
      script && `<script>\n${script}\n</script>`,
      '</body>',
      '</html>',
    ].filter(Boolean).join('\n');
    return [{ label: null, lang: 'html', code: doc }];
  }
  const files = orderedFiles(v);
  const comment = (p: string) => (p.endsWith('.vue') || p.endsWith('.html') ? `<!-- ${p} -->` : p.endsWith('.css') ? `/* ${p} */` : `// ${p}`);
  return files.map(f => ({ label: files.length > 1 ? comment(f.path) : null, lang: fenceLang(f.path), code: f.content.replace(/\s+$/, '') }));
}

export function buildSource(asset: PromptAsset, framework: string): string {
  const parts = sourceParts(asset, framework);
  return parts.length ? parts.map(p => (p.label ? p.label + '\n' : '') + p.code).join('\n\n') + '\n' : '';
}

/** 复刻提示词：开头随语言变化，代码随框架变化 */
export function buildReplicaPrompt(asset: PromptAsset, opts: ReuseOptions): string {
  const L = locale(opts.locale);
  const v = pickVariant(asset, opts.framework);
  const out = [L.intro({ title: localizedTitle(asset, opts.locale) }), L.adapt];
  const theme = opts.targetTheme ? themePrompt(resolveTheme(v), opts.targetTheme, opts.locale) : '';
  if (theme) out.push('', theme);
  if (!v) return out.join('\n') + '\n';

  if (v.files.some(f => /\bdata-demo-only(?=[\s=/>"'`])/.test(f.content))) out.push('', L.demoOnly);

  const deps = Object.entries(v.dependencies);
  if (deps.length) out.push('', `${L.dependencies}: ${deps.map(([n, ver]) => `${n}@${ver}`).join(', ')}`);

  for (const f of orderedFiles(v)) {
    const label = v.framework === 'html'
      ? ({ 'markup.html': L.sections.markup, 'style.css': L.sections.style, 'script.js': L.sections.script } as Record<string, string>)[f.path] ?? f.path
      : f.path;
    out.push('', `${label}:`, fence(f.path, f.content));
  }
  return out.join('\n') + '\n';
}

export function buildIdeaPrompt(asset: PromptAsset, opts: Pick<ReuseOptions, 'locale' | 'targetTheme'> & Partial<Pick<ReuseOptions, 'framework'>>): string {
  const target = opts.targetTheme;
  const idea = translatedValue(asset.texts, opts.locale, text =>
    ((target === 'light' || target === 'dark') ? text.themeIdeas?.[target]?.trim() : '') || text.idea);
  if (!idea) return '';
  if (!target) return idea + '\n';
  const support = resolveTheme(pickVariant(asset, opts.framework ?? asset.variants[0]?.framework ?? ''));
  const theme = themePrompt(support, target, opts.locale, 'idea');
  if (!theme) return idea + '\n';
  // 思路原文可能写了具体配色，配色要求放在前面，并说明以它为准
  return theme + '\n' + locale(opts.locale).theme.ideaPriority + '\n\n' + idea + '\n';
}

export type ReuseKind = 'source' | 'replica' | 'idea';

export function buildReuse(asset: PromptAsset, kind: ReuseKind, opts: ReuseOptions): string {
  if (kind === 'source') return buildSource(asset, opts.framework);
  if (kind === 'replica') return buildReplicaPrompt(asset, opts);
  return buildIdeaPrompt(asset, opts);
}

export interface ParsedReplica {
  title: string;
  sourceName: string;
  sourceUrl: string;
  summary: string;
  markup: string;
  style: string;
  script: string;
}

/**
 * 解析 transitions.dev 的 Copy prompt，拆出名称、来源、简介和三段代码；不是这种格式时返回 null。
 * 原文里 "Theme colors come from --stage-*…" 这类说明不保留。
 */
export function parseReplicaPrompt(text: string): ParsedReplica | null {
  const src = text.replace(/\r\n/g, '\n');
  const head = /Add the "([^"]+)" component to my project\.(?:[ \t]*It comes from (?:the )?(.+?)(?::[ \t]*(\S+?))?\.?[ \t]*)?$/m.exec(src);
  const section = (label: string) => {
    const m = new RegExp(`^${label}[^\\n]*:\\s*\\n\`\`\`[a-z]*\\n([\\s\\S]*?)\\n\`\`\``, 'm').exec(src);
    return m ? m[1] : '';
  };
  const markup = section('Markup');
  if (!head && !markup) return null;

  let summary = '';
  if (head) {
    const after = src.slice(head.index + head[0].length);
    const stop = after.search(/\n\s*(Adapt it to my stack|Follow my project's|Markup:|Styles:|Script)/);
    summary = (stop >= 0 ? after.slice(0, stop) : '').trim();
  }
  return {
    title: head?.[1] ?? '',
    sourceName: head?.[2]?.trim() ?? '',
    sourceUrl: head?.[3]?.trim() ?? '',
    summary,
    markup,
    style: section('Styles'),
    script: section('Script'),
  };
}
