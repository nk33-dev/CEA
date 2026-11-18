import { useEffect, useState } from 'react';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import { uiText, useUi } from '../lib/uiI18n.ts';

export function Pagination({ page, pages, loading = false, onChange }: {
  page: number;
  pages: number;
  loading?: boolean;
  onChange: (page: number) => void;
}) {
  useUi();
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page, pages]);
  if (pages <= 1) return null;

  return <nav className="pagination" aria-label={uiText("分页")}>
    <button type="button" className="icon-btn" title={uiText("上一页")} aria-label={uiText("上一页")}
      disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}><ChevronLeft size={18} /></button>
    <form className="pagination-jump" onSubmit={event => {
      event.preventDefault();
      if (loading) return;
      const value = Number(draft);
      if (!draft || !Number.isSafeInteger(value)) { setDraft(String(page)); return; }
      const next = Math.max(1, Math.min(pages, value));
      setDraft(String(next));
      if (next !== page) onChange(next);
    }}>
      <input className="pagination-input" type="text" inputMode="numeric" enterKeyHint="go"
        aria-label={uiText("页码")} title={uiText("跳转页码")} readOnly={loading}
        style={{ width: `${Math.max(2, String(pages).length) + 2}ch` }}
        value={draft} onChange={event => { if (/^\d*$/.test(event.target.value)) setDraft(event.target.value); }}
        onFocus={event => event.currentTarget.select()}
        onBlur={() => setDraft(String(page))}
        onKeyDown={event => {
          if (event.key === 'Escape') { setDraft(String(page)); event.currentTarget.blur(); }
        }} />
      <span className="pagination-total">/ {pages}</span>
    </form>
    <button type="button" className="icon-btn" title={uiText("下一页")} aria-label={uiText("下一页")}
      disabled={page >= pages || loading} onClick={() => onChange(page + 1)}><ChevronRight size={18} /></button>
  </nav>;
}
