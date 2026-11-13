import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import Sun from 'lucide-react/icons/sun';
import Moon from 'lucide-react/icons/moon';
import Monitor from 'lucide-react/icons/monitor';
import Languages from 'lucide-react/icons/languages';
import ChevronDown from 'lucide-react/icons/chevron-down';
import * as Popover from '@radix-ui/react-popover';
import { PREF_UI_LOCALE, PREF_UI_THEME, useContentLocale, usePref } from '../lib/prefs.ts';
import { uiI18n, uiText, useUi } from '../lib/uiI18n.ts';
import { LanguageControl } from './LanguageControl.tsx';
import { SelectControl } from './SelectControl.tsx';
import { contentLanguages } from '../../shared/locales.ts';
import { applyUiTheme, enableUiThemeMotion } from '../lib/uiThemeMotion.ts';
import { ChoiceControl } from './ChoiceControl.tsx';

const interfaceLanguages = [
  { id: 'en', label: 'English', name: 'English' },
  { id: 'zh', label: '中文', name: '中文' },
];

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
    applyUiTheme(theme === 'dark' || theme === 'system' && dark ? 'dark' : 'light');
  }, [theme, dark]);
  useLayoutEffect(enableUiThemeMotion, []);
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
  const [contentLocale, setContentLocale] = useContentLocale();
  const interfaceLocale = language.startsWith('en') ? 'en' : 'zh';
  const contentOptions = contentLanguages([contentLocale]).map(option => ({ ...option, label: option.name }));
  return <div className="app-preferences">
    <Popover.Root>
      <Popover.Trigger className="app-language-trigger" aria-label={uiText('语言')} title={uiText('语言')}>
        <Languages size={15} aria-hidden="true" />
        <span>{interfaceLanguages.find(option => option.id === interfaceLocale)!.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="option-surface app-language-panel" align="end" sideOffset={8} collisionPadding={12} aria-label={uiText('语言')}>
          <section className="app-language-section">
            <h2>{uiText('界面语言')}</h2>
            <LanguageControl label={uiText('界面语言')} value={interfaceLocale} onChange={setLanguage} options={interfaceLanguages} />
          </section>
          <section className="app-language-section">
            <h2>{uiText('内容语言')}</h2>
            {contentOptions.length <= 2
              ? <LanguageControl value={contentLocale} onChange={setContentLocale} options={contentOptions} />
              : <SelectControl label={uiText('内容语言')} value={contentLocale} onValueChange={setContentLocale}
                options={contentOptions.map(option => ({ value: option.id, label: option.name }))} />}
          </section>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <div className="app-theme">
      <ChoiceControl label={uiText('界面主题')} value={theme} onChange={setTheme} small options={[
        { value: 'light', label: '浅色界面', Icon: Sun },
        { value: 'dark', label: '深色界面', Icon: Moon },
        { value: 'system', label: '跟随系统', Icon: Monitor },
      ].map(({ value, label, Icon }) => ({ value, label: <Icon size={15} aria-hidden="true" />, ariaLabel: uiText(label), hint: uiText(label) }))} />
    </div>
  </div>;
}
