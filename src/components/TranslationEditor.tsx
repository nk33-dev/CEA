import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import { contentLanguages, normalizeLocale } from '../../shared/locales.ts';
import { handleTabKeys } from '../lib/tabKeys.ts';
import { LanguagePicker } from './LanguagePicker.tsx';

export function TranslationEditor({ name, value, onChange, initialLocale, maxLength = 40, disabled = false }: {
  name: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  initialLocale: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  useUi();
  const id = useId();
  const languageIds = Object.keys(value).join('\0');
  const options = useMemo(() => contentLanguages(languageIds ? languageIds.split('\0') : []), [languageIds]);
  const [selected, setSelected] = useState(() => {
    const preferred = normalizeLocale(initialLocale);
    return options.find(option => option.id === preferred)?.id ?? options[0].id;
  });
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const translationInput = useRef<HTMLInputElement>(null);
  const focusEditor = useRef(false);
  const current = options.find(option => option.id === selected) ?? options[0];
  const filled = options.filter(option => value[option.id]?.trim()).length;
  const shown = useMemo(() => options.filter(option => `${option.name} ${option.label} ${option.id}`.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const selectedVisible = !adding && shown.some(option => option.id === current.id);
  const update = (text: string) => onChange({ ...value, [current.id]: text });
  const add = (language: string) => {
    if (!options.some(option => option.id === language)) onChange({ ...value, [language]: '' });
    setSelected(language);
    setQuery('');
    focusEditor.current = true;
    setAdding(false);
  };
  useEffect(() => {
    if (!adding && focusEditor.current) {
      translationInput.current?.focus();
      focusEditor.current = false;
    }
  }, [adding, selected]);

  return <fieldset className="translation-editor" disabled={disabled} aria-label={uiText("多语言译名")}>
    <aside className="translation-languages" aria-label={uiText("译名语言")}>
      <div className="translation-list-head">
        <span>{uiText("语言")}</span>
        <button ref={addTrigger} type="button" className="translation-add-trigger" title={uiText("添加语言")} aria-label={uiText("添加语言")} aria-expanded={adding}
          onClick={() => setAdding(open => !open)}><Plus size={13} aria-hidden="true" />{uiText("添加")}</button>
      </div>
      <label className="translation-search">
        <Search size={14} aria-hidden="true" />
        <input aria-label={uiText("搜索译名语言")} placeholder={uiText("搜索语言或代码")} value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" className="search-clear" aria-label={uiText("清空语言搜索")} title={uiText("清空搜索")} onClick={() => setQuery('')}><X size={13} /></button>}
      </label>
      <div className="translation-language-list" role="tablist" aria-label={uiText("译名语言列表")} aria-orientation="vertical" onKeyDown={handleTabKeys}>
        {shown.map((option, index) => <button key={option.id} type="button" role="tab" id={`${id}-${option.id}`}
          aria-controls={!adding ? `${id}-panel` : undefined} aria-selected={!adding && current.id === option.id}
          tabIndex={current.id === option.id || (!selectedVisible && index === 0) ? 0 : -1}
          className="translation-language" onClick={() => { setAdding(false); setSelected(option.id); }}
          title={`${option.name} · ${option.id} · ${value[option.id]?.trim() ? uiText("已填写") : uiText("待填写")}`}>
          <span className="translation-language-name"><span>{option.name}</span><small>{option.id}</small></span>
          {!value[option.id]?.trim() && <small className="translation-missing">{uiText("待填")}</small>}
        </button>)}
        {!shown.length && <p className="translation-empty">{uiText("没有匹配的语言")}</p>}
      </div>
      <p className="translation-progress">{filled} / {options.length}{uiText(" 已填写")}</p>
    </aside>
    {adding ? <LanguagePicker existing={options.map(option => option.id)} onSelect={add}
      onClose={() => { setAdding(false); addTrigger.current?.focus(); }} /> : <section className="translation-detail" id={`${id}-panel`} role="tabpanel"
      aria-labelledby={selectedVisible ? `${id}-${current.id}` : undefined} aria-label={current.name}>
      <div className="translation-detail-head"><h3>{current.name}</h3><span>{current.id}</span></div>
      <p className="translation-original">{uiText("原名 ")}<bdi title={name}>{name}</bdi></p>
      <label className="field">
        <span>{uiText("译名")}</span>
        <span className="translation-value">
          <input ref={translationInput} aria-label={uiText("{{value0}}译名", {value0: current.name})} lang={current.id} dir="auto" maxLength={maxLength}
            value={value[current.id] ?? ''} placeholder={name} onChange={event => update(event.target.value)} />
          {value[current.id] && <button type="button" className="icon-btn icon-btn-sm" title={uiText("清空当前译名")} aria-label={uiText("清空当前译名")}
            onClick={() => { update(''); translationInput.current?.focus(); }}><X size={14} /></button>}
        </span>
      </label>
      <p className="translation-hint">{uiText("留空时显示原名")}</p>
    </section>}
  </fieldset>;
}
