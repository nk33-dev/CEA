import { useContentLocale } from '../lib/prefs.ts';
import { LanguageControl } from './LanguageControl.tsx';

export function ContentLanguage() {
  const [locale, setLocale] = useContentLocale();
  return <LanguageControl value={locale} onChange={setLocale} />;
}
