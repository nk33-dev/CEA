import { locale as language, localeChain, normalizeLocale } from './locales.ts';
import type { NoteKind } from './i18n/types.ts';

/**
 * 注释里的译文写法：「English text | zh: 中文」。竖线后面跟语言代码和冒号才算译文，
 * 返回 base（竖线前的原文）和找到的译文；没写这种语言时 text 为 null。
 */
export function splitTranslation(value: string, locale: string): { base: string; text: string | null } {
  const [base, ...rest] = value.split(/\s*\|\s*(?=[a-z]{2,8}(?:-[a-z0-9]{1,8})*\s*:)/i);
  const translations: Record<string, string> = {};
  for (const part of rest) {
    const m = /^([a-z0-9-]+)\s*:\s*([\s\S]*)$/i.exec(part);
    const id = m && normalizeLocale(m[1]);
    if (m && id && m[2].trim()) translations[id] = m[2].trim();
  }
  for (const id of localeChain(locale, false)) {
    if (translations[id]) return { base: base.trim(), text: translations[id] };
  }
  return { base: base.trim(), text: null };
}

export function motionLabel(value: string, locale: string) {
  const { base, text } = splitTranslation(value, locale);
  return text ?? language(locale).notes.legacyMotion[base] ?? base;
}

const NOTE_TITLES: [RegExp, NoteKind][] = [
  [/^Touch press:/i, 'press'],
  [/^Touch:/i, 'touch'],
  [/^Credits?:/i, 'credits'],
  [/^Fonts?:/i, 'fonts'],
  [/^Requires?:/i, 'requires'],
  [/^Browser support:/i, 'browser'],
  [/^Global:/i, 'global'],
];

export interface PresentedNote {
  title: string;
  body: string;
  link: string;
  url: string;
  raw: string;
  /** 显示的是译文时，附上原文 */
  original?: string;
}

export function presentNote(raw: string, locale: string): PresentedNote {
  const messages = language(locale).notes;
  const { base, text } = splitTranslation(raw, locale);
  const url = /https?:\/\/[^\s|]+/.exec(base)?.[0] ?? '';
  if (/licen[cs]e|copyright/i.test(base)) {
    const name = /Heroicons/i.test(base) ? 'Heroicons' : base.replace(/^Icons?:\s*/i, '').split(/,|copyright/i)[0].trim();
    return { title: messages.titles.license, body: text ?? name, link: /MIT/i.test(base) ? 'MIT License' : messages.licenseLink, url, raw, original: base };
  }
  const kind = NOTE_TITLES.find(([re]) => re.test(base))?.[1] ?? 'note';
  const stripped = base.replace(/^[\w ]+:\s*/, '');
  const plain = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  const title = messages.titles[kind];
  if (text) return { title, body: text, link: '', url, raw, original: plain };
  if (messages.legacyPress && kind === 'press') return { title, body: messages.legacyPress, link: '', url, raw, original: plain };
  if (messages.legacyTouch && kind === 'touch' && /never select|hover only/i.test(base)) return { title, body: messages.legacyTouch, link: '', url, raw, original: plain };
  return { title, body: plain, link: '', url, raw };
}
