import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE, normalizeLocale } from '../../shared/locales.ts';

/**
 * 记在本机的界面偏好，例如上次选的框架和语言。所有用到同一个 key 的组件同步更新。
 */
export const PREFERENCE_EVENT = 'cea:pref';

function subscribe(callback: () => void) {
  window.addEventListener(PREFERENCE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function usePref(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => localStorage.getItem(key) ?? fallback, () => fallback);
  const set = useCallback((next: string) => {
    localStorage.setItem(key, next);
    window.dispatchEvent(new Event(PREFERENCE_EVENT));
  }, [key]);
  return [value, set];
}

export const PREF_FRAMEWORK = 'cea:framework';
export const PREF_LOCALE = 'cea:locale';
export const PREF_UI_THEME = 'cea:ui:theme';
export const PREF_UI_LOCALE = 'cea:ui:locale';

export function useContentLocale(): [string, (value: string) => void] {
  const [stored, setStored] = usePref(PREF_LOCALE, DEFAULT_LOCALE);
  return [normalizeLocale(stored) ?? DEFAULT_LOCALE, value => {
    const normalized = normalizeLocale(value);
    if (normalized) setStored(normalized);
  }];
}

/** 偏好的框架这个素材没有时，用它的第一个实现 */
export function pickFramework(available: string[], preferred: string) {
  return available.includes(preferred) ? preferred : available[0] ?? preferred;
}
