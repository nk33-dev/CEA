import { en } from './i18n/en.ts';
import { zh } from './i18n/zh.ts';
import type { LocaleInfo } from './i18n/types.ts';

export type { LocaleInfo } from './i18n/types.ts';
export interface ReplicaHead { title: string }

export const LOCALES: readonly LocaleInfo[] = [en, zh];
export const LOCALE_IDS = LOCALES.map(l => l.id);
export const DEFAULT_LOCALE = 'en';
export const UI_LOCALE = 'zh';

/** 数据允许保存尚未安装语言包的合法语言码，避免换电脑或导入时丢失译文。 */
export function normalizeLocale(value: string): string | null {
  if (!value || value.length > 64 || !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(value)) return null;
  try { return Intl.getCanonicalLocales(value)[0] ?? null; }
  catch { return null; }
}

/** 按精确语言、父级、已配置回退和默认语言排序，并消除重复与循环。 */
export function localeChain(id: string, includeDefault = true): string[] {
  const chain: string[] = [];
  const add = (value: string) => {
    const canonical = normalizeLocale(value);
    if (!canonical || chain.includes(canonical)) return;
    chain.push(canonical);
    const base = new Intl.Locale(canonical).baseName;
    const parts = base.split('-');
    if (base !== canonical) add(base);
    else if (parts.length > 1) add(parts.slice(0, -1).join('-'));
  };
  add(id);
  if (includeDefault) {
    for (let index = 0; index < chain.length; index++) {
      const fallback = LOCALES.find(l => l.id === chain[index])?.fallback;
      if (fallback) add(fallback);
    }
    add(DEFAULT_LOCALE);
  }
  return chain;
}

export function locale(id: string): LocaleInfo {
  for (const candidate of localeChain(id)) {
    const pack = LOCALES.find(l => l.id === candidate);
    if (pack) return pack;
  }
  return en;
}

export function localeName(id: string): string {
  const canonical = normalizeLocale(id);
  const own = LOCALES.find(l => l.id === canonical);
  if (own) return own.name;
  if (!canonical) return id;
  try { return new Intl.DisplayNames([UI_LOCALE], { type: 'language' }).of(canonical) ?? canonical; }
  catch { return canonical; }
}

export interface LocaleOption { id: string; label: string; name: string }
export function contentLanguages(extra: string[] = []): LocaleOption[] {
  const ids = [...new Set([...LOCALE_IDS, ...extra.map(normalizeLocale).filter((id): id is string => !!id)])];
  return ids.map(id => {
    const own = LOCALES.find(l => l.id === id);
    return { id, label: own?.label ?? localeName(id), name: localeName(id) };
  });
}
