import { uiText, useUi } from '../lib/uiI18n.ts';
import { useId, useMemo, useState } from 'react';
import Plus from 'lucide-react/icons/plus';
import X from 'lucide-react/icons/x';
import Search from 'lucide-react/icons/search';
import Code from 'lucide-react/icons/code';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { normalizeLocale } from '../../shared/locales.ts';
import { findLanguages } from '../lib/languageOptions.ts';

export function LanguagePicker({ existing, onSelect, onClose }: {
  existing: string[];
  onSelect: (locale: string) => void;
  onClose: () => void;
}) {
  useUi();
  const id = useId();
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const matches = useMemo(() => findLanguages(query, existing), [query, existing]);
  const firstAvailable = matches.findIndex(language => !existing.includes(language.id));
  const addCustom = () => {
    const locale = normalizeLocale(code.trim());
    if (!locale) { setError(uiText("填写有效的语言代码，如 pt-BR 或 zh-Hant")); return; }
    onSelect(locale);
  };
  return <section className="language-picker" data-custom={custom || undefined} aria-label={uiText("添加译名语言")} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="language-picker-head"><h3>{custom ? uiText("自定义语言") : uiText("添加语言")}</h3>
      <button type="button" className="language-picker-mode" aria-label={custom ? uiText("返回语言列表") : uiText("使用地区或自定义语言代码")}
        title={custom ? uiText("返回语言列表") : uiText("使用地区或自定义语言代码")} onClick={() => { setCustom(open => !open); setError(''); }}>
        {custom ? <ArrowLeft size={13} aria-hidden="true" /> : <Code size={13} aria-hidden="true" />}{custom ? uiText("返回") : uiText("自定义")}
      </button>
      <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("关闭语言选择")} title={uiText("关闭语言选择")} onClick={onClose}><X size={15} /></button>
    </div>
    {!custom && <><label className="translation-search">
      <Search size={14} aria-hidden="true" />
      <input autoFocus aria-label={uiText("搜索可添加语言")} placeholder={uiText("搜索语言名称")} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            event.currentTarget.closest('section')?.querySelector<HTMLButtonElement>('.language-picker-option:not(:disabled)')?.focus();
          }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && matches.length === 1 && !existing.includes(matches[0].id)) {
            event.preventDefault(); onSelect(matches[0].id);
          }
        }} />
      {query && <button type="button" className="search-clear" aria-label={uiText("清空可添加语言搜索")} title={uiText("清空搜索")} onClick={() => setQuery('')}><X size={13} /></button>}
    </label>
    <div className="language-picker-list" aria-label={uiText("可添加语言")} role="group" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      {matches.map((language, index) => <button key={language.id} type="button" className="language-picker-option" tabIndex={index === firstAvailable ? 0 : -1}
        disabled={existing.includes(language.id)} onClick={() => onSelect(language.id)} title={`${language.name} · ${language.nativeName} · ${language.id}`}>
        <span><strong>{language.name}</strong><small>{language.nativeName} · {language.id}</small></span>
        {existing.includes(language.id) ? <small>{uiText("已添加")}</small> : <Plus size={14} aria-hidden="true" />}
      </button>)}
      {!matches.length && <p className="translation-empty">{uiText("没有匹配的语言")}</p>}
    </div></>}
    {custom && <div className="translation-add">
      <label htmlFor={`${id}-code`}>{uiText("语言代码")}</label>
      <div><input id={`${id}-code`} autoFocus value={code} onChange={event => { setCode(event.target.value); setError(''); }}
        placeholder={uiText("如 pt-BR、zh-Hant")} autoCapitalize="none" spellCheck={false} maxLength={64} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addCustom(); } }} />
        <button type="button" className="btn btn-sm" disabled={!code.trim()} onClick={addCustom}>{uiText("添加")}</button></div>
      {error && <p id={`${id}-error`} className="form-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
