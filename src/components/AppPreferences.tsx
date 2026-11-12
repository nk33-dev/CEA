import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import Monitor from 'lucide-react/icons/monitor';
import Languages from 'lucide-react/icons/languages';
import { PREF_UI_LOCALE, PREF_UI_THEME, usePref } from '../lib/prefs.ts';
import { uiI18n, uiText, useUi } from '../lib/uiI18n.ts';
import { SelectControl } from './SelectControl.tsx';

const systemTheme = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');
const subscribeSystem = (notify: () => void) => {
  systemTheme?.addEventListener('change', notify);
  return () => systemTheme?.removeEventListener('change', notify);
};

export function UiPreferences() {
  const [theme] = usePref(PREF_UI_THEME, 'light');
  const [language] = usePref(PREF_UI_LOCALE, 'zh');
  const dark = useSyncExternalStore(subscribeSystem, () => systemTheme?.matches ?? false, () => false);
  useLayoutEffect(() => {
    document.documentElement.dataset.uiTheme = theme === 'dark' || theme === 'system' && dark ? 'dark' : 'light';
  }, [theme, dark]);
  useEffect(() => {
    const next = language.startsWith('en') ? 'en' : 'zh';
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN';
    void uiI18n.changeLanguage(next);
  }, [language]);
  return null;
}

export function AppPreferences() {
  useUi();
  const [theme, setTheme] = usePref(PREF_UI_THEME, 'light');
  const [language, setLanguage] = usePref(PREF_UI_LOCALE, 'zh');
  return <div className="app-preferences">
    <SelectControl label={uiText('界面语言')} icon={<Languages size={15} aria-hidden="true" />}
      value={language.startsWith('en') ? 'en' : 'zh'} onValueChange={setLanguage}
      options={[{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }]} />
    <div className="app-theme" role="radiogroup" aria-label={uiText('界面主题')} onKeyDown={event => {
      const values = ['light', 'dark', 'system'];
      const index = values.indexOf(theme);
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % 3
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + 2) % 3 : -1;
      if (next < 0) return;
      event.preventDefault();
      setTheme(values[next]);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
    }}>
      {[
        { value: 'light', label: '浅色界面', Icon: Sun },
        { value: 'dark', label: '深色界面', Icon: Moon },
        { value: 'system', label: '跟随系统', Icon: Monitor },
      ].map(({ value, label, Icon }) => <button key={value} type="button" role="radio" aria-checked={theme === value}
        tabIndex={theme === value ? 0 : -1} className="icon-btn icon-btn-sm" aria-label={uiText(label)} title={uiText(label)} onClick={() => setTheme(value)}><Icon size={15} aria-hidden="true" /></button>)}
    </div>
  </div>;
}
