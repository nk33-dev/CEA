import i18next, { type TOptions } from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { en } from '../../shared/i18n/ui/en.ts';

function initialLanguage() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('cea:ui:locale')?.startsWith('en') ? 'en' : 'zh'; }
  catch { return 'zh'; }
}

export const uiI18n = i18next.createInstance();
void uiI18n.use(initReactI18next).init({
  resources: { en: { ui: en }, zh: { ui: Object.fromEntries(Object.keys(en).map(key => [key, key])) } },
  lng: initialLanguage(), fallbackLng: 'zh', supportedLngs: ['zh', 'en'],
  defaultNS: 'ui', keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false }, initAsync: false,
  react: { useSuspense: false },
});

export function uiText(key: string, values?: TOptions): string {
  if (!(key in en) && key.trim() in en) {
    const leading = key.match(/^\s*/)?.[0] ?? '';
    const trailing = key.match(/\s*$/)?.[0] ?? '';
    return leading + uiText(key.trim(), values) + trailing;
  }
  return String(values ? uiI18n.t(key, values) : uiI18n.t(key));
}

export function useUi() {
  return useTranslation('ui', { i18n: uiI18n }).i18n;
}
