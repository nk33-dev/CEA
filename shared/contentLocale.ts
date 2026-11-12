import { localeChain, normalizeLocale } from './locales.ts';
import type { AssetText } from './types.ts';

export function localizedName(name: string, labels: Record<string, string> | undefined, locale: string): string {
  return translatedValue(labels ?? {}, locale, value => value, false) || name;
}

export function localizedTitle(asset: { title: string; titles?: Record<string, string>; texts?: Record<string, AssetText> }, locale: string): string {
  const titles = { ...Object.fromEntries(Object.entries(asset.texts ?? {}).map(([id, text]) => [id, text.title ?? ''])), ...asset.titles };
  return localizedName(asset.title, titles, locale);
}

/** 名称只取同语言及父级；简介和思路可继续回退到默认语言及其他已有内容。 */
export function translatedValue<T>(values: Record<string, T>, requested: string, pick: (value: T) => string | undefined, fallback = true): string {
  const keys = Object.keys(values);
  const ordered = [...new Set([...localeChain(requested, fallback), ...(fallback ? keys.sort() : [])])];
  for (const id of ordered) {
    const key = Object.hasOwn(values, id) ? id : keys.find(key => normalizeLocale(key) === id);
    const value = key === undefined ? '' : pick(values[key])?.trim();
    if (value) return value;
  }
  return '';
}

export function cleanLabels(input: unknown, max = 80): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    const locale = normalizeLocale(key);
    return locale && typeof value === 'string' && value.trim() ? [[locale, value.trim().slice(0, max)]] : [];
  }));
}

export function labelSearch(name: string, labels?: Record<string, string>): string {
  return [name, ...Object.values(labels ?? {})].join('\n').toLowerCase();
}
