import ISO6391 from 'iso-639-1';
import { localeName, normalizeLocale } from '../../shared/locales.ts';

export interface LanguageOption {
  id: string;
  name: string;
  nativeName: string;
  search: string;
}

const searchable = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function option(id: string): LanguageOption {
  const base = new Intl.Locale(id).language;
  const localized = localeName(id);
  const name = localized === id ? ISO6391.getName(base) || id : localized;
  const nativeName = ISO6391.getNativeName(base) || name;
  return { id, name, nativeName, search: searchable(`${id} ${name} ${nativeName} ${ISO6391.getName(base)}`) };
}

const languages = [...new Set(ISO6391.getAllCodes().map(normalizeLocale).filter((id): id is string => !!id))].map(option);

export function findLanguages(query: string, extra: string[] = []): LanguageOption[] {
  const q = searchable(query.trim());
  const direct = normalizeLocale(query.trim());
  const ids = new Set(languages.map(language => language.id));
  const all = [...languages];
  const additional = [...extra, ...(direct && (direct.includes('-') || ISO6391.validate(direct)) ? [direct] : [])];
  for (const value of additional) {
    const id = normalizeLocale(value);
    if (id && !ids.has(id)) { ids.add(id); all.push(option(id)); }
  }
  return all.filter(language => !q || language.search.includes(q))
    .sort((a, b) => Number(b.id === direct) - Number(a.id === direct) || a.name.localeCompare(b.name, 'zh'));
}
