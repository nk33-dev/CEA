import type { CodeFile, Variant } from './types.ts';
import { locale as language, UI_LOCALE } from './locales.ts';

export type ComponentTheme = 'light' | 'dark';
export type ReuseTheme = 'original' | ComponentTheme | 'both';
export interface ThemeContract {
  version: 1;
  mode: ReuseTheme;
  default: ComponentTheme;
}
export interface ThemeSupport extends ThemeContract {
  source: 'declared' | 'detected' | 'original';
}

const DARK_SELECTOR = /\[data-theme\s*=\s*["']?dark["']?\]|(?:^|[\s,{>~+(])(?:html|:root)?\.dark\b|:global\(\.dark\)|\bdark:/m;
const LIGHT_SELECTOR = /\[data-theme\s*=\s*["']?light["']?\]/m;

function themeCode(files: CodeFile[]) {
  return files.filter(f => /\.(css|scss|less|vue|svelte|html|tsx|jsx|ts|js)$/i.test(f.path))
    .map(f => f.content.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')).join('\n');
}

export function hasDarkMode(files: CodeFile[]): boolean {
  return DARK_SELECTOR.test(themeCode(files));
}

export function parseThemeContract(value: unknown): ThemeContract | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('组件主题声明需要是对象');
  const theme = value as Record<string, unknown>;
  if (theme.version !== 1) throw new Error('组件主题声明版本不支持，请升级程序；原素材不会被修改');
  if (!['original', 'light', 'dark', 'both'].includes(String(theme.mode))) throw new Error('组件主题需要是 original、light、dark 或 both');
  if (theme.default !== 'light' && theme.default !== 'dark') throw new Error('组件默认主题需要是 light 或 dark');
  if ((theme.mode === 'light' || theme.mode === 'dark') && theme.default !== theme.mode) throw new Error('单主题组件的默认主题需要与支持主题一致');
  return { version: 1, mode: theme.mode as ReuseTheme, default: theme.default };
}

export function resolveTheme(variant?: Pick<Variant, 'theme' | 'files'>): ThemeSupport {
  const declared = parseThemeContract(variant?.theme);
  if (declared) return { ...declared, source: 'declared' };
  const code = themeCode(variant?.files ?? []);
  if (DARK_SELECTOR.test(code)) return { version: 1, mode: 'both', default: 'light', source: 'detected' };
  if (LIGHT_SELECTOR.test(code)) return { version: 1, mode: 'light', default: 'light', source: 'detected' };
  return { version: 1, mode: 'original', default: 'light', source: 'original' };
}

export function previewThemeFor(support: ThemeSupport, requested: string): ComponentTheme | 'original' {
  if (support.source !== 'declared') return 'original';
  if (support.mode === 'original') return 'original';
  if (support.mode === 'both') return requested === 'dark' ? 'dark' : 'light';
  return support.default;
}

export function themeLabel(theme: ReuseTheme, locale = UI_LOCALE): string {
  return language(locale).theme.labels[theme];
}

/**
 * 复用提示词里的配色要求。目标和组件自带的配色一致时什么都不写；
 * 思路只补充配色目标；附带代码的复刻还提供改写要求和实现约束。
 */
export function themePrompt(support: ThemeSupport, target: ReuseTheme, locale: string, kind: 'replica' | 'idea' = 'replica'): string {
  const messages = language(locale).theme;
  const has = support.source === 'declared' ? support.mode : 'original';
  if (target === 'original') return '';
  if (kind === 'idea') return messages.goals[target];
  const gap = support.source !== 'declared' || target === has ? '' : has === 'both' && target !== 'both'
    ? messages.keepOnly[target]
    : messages.rewriteColors(has, target);
  const rule = target === 'both' ? messages.dualRule : messages.singleRule;
  return [messages.goals[target], gap, rule].filter(Boolean).join('\n');
}

export function parseThemeIdeas(input: unknown): Partial<Record<ComponentTheme, string>> | undefined {
  if (input == null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('分主题思路需要是对象');
  const ideas: Partial<Record<ComponentTheme, string>> = {};
  for (const [key, text] of Object.entries(input)) {
    if (key !== 'light' && key !== 'dark') throw new Error(`不支持的思路主题：${key}`);
    if (typeof text !== 'string') throw new Error('主题思路需要是文本');
    if (text.trim()) ideas[key] = text.trim().slice(0, 20000);
  }
  return Object.keys(ideas).length ? ideas : undefined;
}
