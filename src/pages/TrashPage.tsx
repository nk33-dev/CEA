import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import type { AssetPage } from '../../shared/types.ts';
import { localizedTitle } from '../../shared/contentLocale.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Pagination } from '../components/Pagination.tsx';
import { api, errorMessage, fileUrl } from '../lib/api.ts';
import { useContentLocale } from '../lib/prefs.ts';
import { useLibrary } from '../lib/store.tsx';
import { uiText, useUi } from '../lib/uiI18n.ts';

export function TrashPage() {
  useUi();
  const { info, revision, refresh, notify } = useLibrary();
  const [locale] = useContentLocale();
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const q = params.get('q') ?? '';
  const [query, setQuery] = useState(q);
  const [data, setData] = useState<AssetPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string[]>([]);
  useEffect(() => setQuery(q), [q]);
  useEffect(() => {
    if (query.trim() === q) return;
    const timer = setTimeout(() => setParams(query.trim() ? { q: query.trim() } : {}, { replace: true }), 180);
    return () => clearTimeout(timer);
  }, [query, q, setParams]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const request = new URLSearchParams(key);
    request.set('trash', '1');
    api.assetPage(request, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const last = Math.max(1, Math.ceil(result.total / result.limit));
      if (result.page > last) {
        const next = new URLSearchParams(key);
        next.set('page', String(last));
        setParams(next, { replace: true });
      } else setData(result);
    }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, revision, info?.libraryId, retry, setParams]);
  useEffect(() => { setData(null); setSelected(new Set()); }, [info?.libraryId]);
  useEffect(() => setSelected(new Set()), [key]);
  const items = data?.items ?? [];
  const allSelected = !!items.length && items.every(a => selected.has(a.id));
  const toggle = (id: string) => setSelected(previous => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const run = async (ids: string[], action: 'restore' | 'purge') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.manageAssets(ids, action);
      setSelected(new Set());
      setDeleting([]);
      await refresh();
      notify(action === 'restore' ? uiText("已恢复 {{value0}} 个组件", { value0: ids.length }) : uiText("已永久删除 {{value0}} 个组件", { value0: ids.length }));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const page = data?.page ?? 1;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 24)));
  const changePage = (value: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(value));
    setParams(next);
  };
  return <div className="trash-page">
    <header className="trash-heading">
      <Link to="/" className="icon-btn" aria-label={uiText("返回浏览")} title={uiText("返回浏览")}><ArrowLeft size={18} /></Link>
      <h1>{uiText("回收站")}</h1><span className="muted">{info?.trashCount ?? 0}</span>
    </header>
    <div className="trash-toolbar">
      <label className="search"><Search size={16} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={uiText("搜索回收站")} placeholder={uiText("搜索回收站")} /></label>
      <span className="trash-selection">{uiText("已选 {{value0}} 项", { value0: selected.size })}</span>
      <button className="btn btn-quiet" disabled={!selected.size || busy} onClick={() => void run([...selected], 'restore')}><RotateCcw size={15} />{uiText("恢复")}</button>
      <button className="icon-btn icon-btn-danger" disabled={!selected.size || busy} title={uiText("永久删除所选")} aria-label={uiText("永久删除所选")} onClick={() => setDeleting([...selected])}><Trash2 size={16} /></button>
    </div>
    {error && !deleting.length && <div className="workspace-feedback" role="alert"><span>{error}</span><button className="btn btn-sm" onClick={() => setRetry(n => n + 1)}>{uiText("重试")}</button></div>}
    <section className="trash-list" aria-label={uiText("已删除组件")} aria-busy={loading}>
      <div className="trash-columns">
        <input type="checkbox" aria-label={uiText("选择本页")} checked={allSelected} disabled={!items.length || busy} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map(a => a.id)))} />
        <span>{uiText("组件")}</span><span>{uiText("删除时间")}</span><span />
      </div>
      {items.map(asset => <div className="trash-row" key={asset.id}>
        <input type="checkbox" aria-label={uiText("选择「{{value0}}」", { value0: localizedTitle(asset, locale) })} checked={selected.has(asset.id)} disabled={busy} onChange={() => toggle(asset.id)} />
        <div className="trash-asset">{asset.cover ? <img src={fileUrl(asset.cover)} alt="" loading="lazy" /> : <span className="trash-placeholder"><Trash2 size={18} /></span>}
          <div><strong>{localizedTitle(asset, locale)}</strong><span>{asset.frameworks.join(' · ')}</span></div>
        </div>
        <time dateTime={asset.deletedAt}>{asset.deletedAt ? dateFormat.format(new Date(asset.deletedAt)) : ''}</time>
        <div className="trash-actions"><button className="icon-btn" disabled={busy} aria-label={uiText("恢复「{{value0}}」", { value0: localizedTitle(asset, locale) })} title={uiText("恢复")} onClick={() => void run([asset.id], 'restore')}><RotateCcw size={16} /></button>
          <button className="icon-btn icon-btn-danger" disabled={busy} aria-label={uiText("永久删除「{{value0}}」", { value0: localizedTitle(asset, locale) })} title={uiText("永久删除")} onClick={() => setDeleting([asset.id])}><Trash2 size={16} /></button></div>
      </div>)}
      {!items.length && !error && <div className="empty"><p className="empty-title">{loading ? uiText("正在加载…") : q ? uiText("没有匹配的组件") : uiText("回收站为空")}</p>{q && <button className="btn btn-quiet" onClick={() => setParams({})}>{uiText("清空搜索")}</button>}</div>}
    </section>
    <Pagination page={page} pages={pages} loading={loading} onChange={changePage} />
    <Dialog open={!!deleting.length} onClose={() => setDeleting([])} locked={busy} title={uiText("永久删除 {{value0}} 个组件？", { value0: deleting.length })}
      footer={<><button className="btn btn-quiet" data-close-dialog disabled={busy}>{uiText("取消")}</button><button className="btn btn-danger" disabled={busy} onClick={() => void run(deleting, 'purge')}>{busy ? uiText("正在删除…") : uiText("永久删除")}</button></>}>
      <p>{uiText("代码、资源和截图将从磁盘删除，无法恢复。")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  </div>;
}
