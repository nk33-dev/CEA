import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import ArrowDownUp from 'lucide-react/icons/arrow-down-up';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Download from 'lucide-react/icons/download';
import FolderInput from 'lucide-react/icons/folder-input';
import Heart from 'lucide-react/icons/heart';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';
import Tags from 'lucide-react/icons/tags';
import Trash2 from 'lucide-react/icons/trash-2';
import X from 'lucide-react/icons/x';
import TagMinus from 'lucide-react/icons/tag-x';
import { FRAMEWORKS, frameworkLabel } from '../../shared/frameworks.ts';
import type { AssetPage } from '../../shared/types.ts';
import { readTagQuery, writeTagQuery } from '../../shared/search.ts';
import { AssetCard } from '../components/AssetCard.tsx';
import { AssetGrid } from '../components/AssetGrid.tsx';
import { FilterMenu } from '../components/FilterMenu.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { SelectControl } from '../components/SelectControl.tsx';
import { ContentLanguage } from '../components/ContentLanguage.tsx';
import { PreviewActivity, PreviewActivityStatus } from '../components/PreviewActivity.tsx';
import { localizedName } from '../../shared/contentLocale.ts';
import { api, errorMessage } from '../lib/api.ts';
import { useContentLocale } from '../lib/prefs.ts';
import { useLibrary } from '../lib/store.tsx';

const SORTS = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '最近添加' },
  { value: 'title', label: '按名称' },
];

const facetCount = (counts: Record<string, number> | undefined, name: string) =>
  counts && Object.hasOwn(counts, name) ? counts[name] : 0;

export function HomePage() {
  const { categories, tags, revision, notify, refresh, info } = useLibrary();
  const [params, setParams] = useSearchParams();
  const key = params.toString();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const fw = params.get('fw') ?? '';
  const favorite = params.get('fav') === '1';
  const sort = params.get('sort') ?? 'updated';
  const tagKey = params.get('tags') ?? '';
  const selectedTags = useMemo(() => readTagQuery(tagKey), [tagKey]);
  const tagSet = useMemo(() => selectedTags.map(t => t.toLowerCase()), [selectedTags]);
  const [locale] = useContentLocale();
  const [query, setQuery] = useState(q);
  const [composing, setComposing] = useState(false);
  const submittedQuery = useRef<string | null>(null);
  const [storedData, setData] = useState<AssetPage | null>(null);
  const [dataLibrary, setDataLibrary] = useState<string | null>(null);
  const data = dataLibrary === info?.libraryId ? storedData : null;
  const [loading, setLoading] = useState(true);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selecting, setSelecting] = useState(params.get('select') === '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<'delete' | 'tag' | 'untag' | 'category' | null>(null);
  const [value, setValue] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLElement>(null);
  const pendingPageScroll = useRef(false);
  const update = useCallback((patch: Record<string, string | null>, paging = false) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (!paging) next.delete('page');
      for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setParams]);

  useEffect(() => {
    if (submittedQuery.current === q) { submittedQuery.current = null; return; }
    setQuery(q);
  }, [q]);
  useEffect(() => {
    if (composing || query.trim() === q) return;
    const id = setTimeout(() => {
      submittedQuery.current = query.trim();
      update({ q: query.trim() || null });
    }, 180);
    return () => clearTimeout(id);
  }, [query, q, composing, update]);
  useEffect(() => {
    if (!info?.libraryId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api.assetPage(new URLSearchParams(key), controller.signal).then(next => {
      if (!controller.signal.aborted) {
        setData(next);
        setDataLibrary(info.libraryId);
      }
    }).catch(e => {
      if (!controller.signal.aborted) setError(errorMessage(e));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [key, revision, info?.libraryId, retry]);
  useEffect(() => { setLiveId(null); }, [selecting, info?.libraryId]);
  useEffect(() => {
    if (data && liveId && !data.items.some(item => item.id === liveId)) setLiveId(null);
  }, [data, liveId]);
  useEffect(() => {
    if (!data || loading) return;
    const last = Math.max(1, Math.ceil(data.total / data.limit));
    if (data.page > last) update({ page: String(last) }, true);
  }, [data, loading, update]);
  useLayoutEffect(() => {
    if (!loading && data && pendingPageScroll.current) {
      pendingPageScroll.current = false;
      results.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [data, loading]);
  useEffect(() => { setSelected(new Set()); }, [info?.libraryId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(target.tagName) && !target.isContentEditable) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggleTag = useCallback((tag: string) => {
    const next = selectedTags.some(t => t.toLowerCase() === tag.toLowerCase())
      ? selectedTags.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...selectedTags, tag];
    if (next.length > 30) { notify('最多同时筛选 30 个标签'); return; }
    update({ tags: writeTagQuery(next) });
  }, [selectedTags, update, notify]);
  const onFavorite = useCallback((id: string, saved: boolean) => {
    setData(prev => prev && { ...prev, items: prev.items.map(a => a.id === id ? { ...a, favorite: saved } : a) });
  }, []);
  const toggleSelect = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);
  const askDelete = useCallback((id: string) => {
    setSelected(new Set([id]));
    setAction('delete');
  }, []);
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try { await fn(); await refresh(); notify(message); return true; }
    catch (e) { notify(errorMessage(e)); return false; }
    finally { setBusy(false); }
  };
  const exportSelected = async () => {
    if (await run(() => api.exportZip([...selected]), `已导出 ${selected.size} 个组件`)) exitSelect();
  };
  const apply = async () => {
    if (!action) return;
    if (await run(() => api.manageAssets([...selected], action, value), `已处理 ${selected.size} 个组件`)) {
      setAction(null); exitSelect();
    }
  };
  const clear = () => { setQuery(''); update({ q: null, category: null, fw: null, tags: null, fav: null }); };
  const active = [
    ...(q ? [{ key: 'q', label: q, clear: () => { setQuery(''); update({ q: null }); } }] : []),
    ...(favorite ? [{ key: 'fav', label: '收藏', clear: () => update({ fav: null }) }] : []),
    ...(category ? [{ key: 'cat', label: (() => { const c = categories.find(c => c.id === category); return c ? localizedName(c.name, c.labels, locale) : '分类'; })(), clear: () => update({ category: null }) }] : []),
    ...(fw ? [{ key: 'fw', label: frameworkLabel(fw), clear: () => update({ fw: null }) }] : []),
    ...selectedTags.map(t => ({ key: `tag:${t}`, label: '#' + localizedName(t, tags.find(tag => tag.name.toLowerCase() === t.toLowerCase())?.labels, locale), clear: () => toggleTag(t) })),
  ];
  const facets = data?.facets;
  const tagOptions = useMemo(() => tags.map(t => ({ value: t.name, label: localizedName(t.name, t.labels, locale), search: [t.name, ...Object.values(t.labels ?? {})].join(' '), count: facetCount(facets?.tags, t.name) })), [tags, facets?.tags, locale]);
  const tagLabels = useMemo(() => Object.fromEntries(tags.map(t => [t.name.toLowerCase(), localizedName(t.name, t.labels, locale)])), [tags, locale]);
  const page = data?.page ?? 1;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 24)));
  const items = data?.items ?? [];
  const pageSelected = items.length > 0 && items.every(a => selected.has(a.id));
  const changePage = (next: number) => {
    pendingPageScroll.current = true;
    update({ page: String(next) }, true);
  };

  return (
    <PreviewActivity><div className="home">
      <div className="results-bar">
        <label className="search"><Search size={16} aria-hidden="true" />
          <input ref={search} type="search" placeholder="搜索组件、标签或交互" aria-label="搜索组件" value={query} onChange={e => setQuery(e.target.value)}
            onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
          {query ? <button className="search-clear" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>Ctrl K</kbd>}
        </label>
        <ContentLanguage />
        <button className={`btn btn-quiet${selecting ? ' is-active' : ''}`} onClick={() => selecting ? exitSelect() : setSelecting(true)} aria-pressed={selecting}>{selecting ? '完成' : '批量管理'}</button>
        <Link to="/new" className="btn btn-dark"><Plus size={16} />添加</Link>
      </div>
      <div className="filter-bar" aria-label="筛选">
        <button className="fmenu-btn" aria-pressed={favorite} onClick={() => update({ fav: favorite ? null : '1' })}><Heart size={14} />收藏<span className="count">{facets?.favorite ?? 0}</span></button>
        <FilterMenu label="分类" selected={category ? [category] : []} onChange={v => update({ category: v[0] ?? null })}
          options={[{ value: '__uncategorized__', label: '未分类', count: facetCount(facets?.categories, 'null') }, ...categories.map(c => ({ value: c.id, label: localizedName(c.name, c.labels, locale), search: [c.name, ...Object.values(c.labels ?? {})].join(' '), count: facetCount(facets?.categories, c.id) }))]}
          footer={<Link to="/organize?tab=categories" className="link-btn">管理分类</Link>} />
        <FilterMenu label="框架" selected={fw ? [fw] : []} onChange={v => update({ fw: v[0] ?? null })}
          options={FRAMEWORKS.map(f => ({ value: f.id, label: f.label, count: facetCount(facets?.frameworks, f.id) }))} />
        <FilterMenu label="标签" multiple selected={selectedTags} onChange={v => { if (v.length > 30) notify('最多同时筛选 30 个标签'); else update({ tags: writeTagQuery(v) }); }}
          options={tagOptions}
          footer={<Link to="/organize" className="link-btn">管理标签</Link>} />
        <div className="filter-results">
          <span className="active-count" role="status" aria-live="polite">{data?.total ?? 0} 个组件</span>
          <div className="sort-control">
          <SelectControl label="排序" value={SORTS.some(s => s.value === sort) ? sort : 'updated'} onValueChange={v => update({ sort: v })}
            options={SORTS} filter icon={<ArrowDownUp size={14} />} />
          </div>
        </div>
      </div>
      {active.length > 0 && <div className="active-filters">
        {active.map(f => <button key={f.key} className="active-chip" aria-label={`移除筛选：${f.label}`} onClick={f.clear}>{f.label}<X size={12} /></button>)}
        {active.length > 0 && <button className="link-btn" onClick={clear}>清除筛选</button>}
      </div>}
      <PreviewActivityStatus fetching={loading} />
      {error && data && <div className="workspace-feedback" role="alert">
        <span><strong>列表未更新</strong>{error}</span>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setRetry(value => value + 1)}>重试</button>
      </div>}
      <section ref={results} className="results" aria-label="组件" aria-busy={loading}>
        {error && !data ? <div className="empty" role="alert"><p>{error}</p><button className="btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>
          : !data ? <div className="grid">{[0, 1, 2].map(i => <div key={i} className="card card-skeleton"><div className="card-stage" /></div>)}</div>
          : !info?.assetCount ? <div className="empty"><p className="empty-title">开始你的组件收藏</p><div className="empty-actions">
            <Link to="/new" className="btn btn-dark">添加组件</Link><Link to="/transfer" className="btn btn-quiet">导入组件</Link>
          </div></div>
          : !items.length ? <div className="empty"><p className="empty-title">没有匹配的组件</p><button className="btn" onClick={clear}>清除筛选</button></div>
          : <AssetGrid key={info.libraryId} items={items}>{a => <AssetCard asset={a} live={liveId === a.id} onLiveChange={setLiveId} locale={locale} tagLabels={tagLabels} activeTags={tagSet} selecting={selecting} selected={selected.has(a.id)} onToggleSelect={toggleSelect} onFavorite={onFavorite} onTag={toggleTag} onDelete={askDelete} />}</AssetGrid>}
      </section>
      {pages > 1 && <nav className="pagination" aria-label="分页">
        <button className="icon-btn" title="上一页" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}><ChevronLeft size={18} /></button>
        <span>{page} / {pages}</span>
        <button className="icon-btn" title="下一页" aria-label="下一页" disabled={page >= pages || loading} onClick={() => changePage(page + 1)}><ChevronRight size={18} /></button>
      </nav>}
      {selecting && <div className="select-bar batch-bar" aria-label="批量管理">
        <span>已选 {selected.size}</span><button className="btn btn-quiet btn-sm" onClick={() => setSelected(prev => { const next = new Set(prev); for (const a of items) pageSelected ? next.delete(a.id) : next.add(a.id); return next; })}>{pageSelected ? '取消本页' : '选择本页'}</button>
        <button className="icon-btn" title="导出所选" aria-label="导出所选" disabled={!selected.size || busy} onClick={exportSelected}><Download size={16} /></button>
        <button className="icon-btn" title="添加标签" aria-label="添加标签" disabled={!selected.size || busy} onClick={() => { setValue(''); setAction('tag'); }}><Tags size={16} /></button>
        <button className="icon-btn" title="移除标签" aria-label="移除标签" disabled={!selected.size || busy} onClick={() => { setValue(''); setAction('untag'); }}><TagMinus size={16} /></button>
        <button className="icon-btn" title="移动分类" aria-label="移动分类" disabled={!selected.size || busy} onClick={() => { setValue(''); setAction('category'); }}><FolderInput size={16} /></button>
        <button className="icon-btn icon-btn-danger" title="删除所选" aria-label="删除所选" disabled={!selected.size || busy} onClick={() => setAction('delete')}><Trash2 size={16} /></button>
      </div>}
      <Dialog open={!!action} onClose={() => setAction(null)} locked={busy} title={action === 'delete' ? `删除 ${selected.size} 个组件？` : action === 'tag' ? '添加标签' : action === 'untag' ? '移除标签' : '移动分类'}
        footer={<><button className="btn btn-quiet" data-close-dialog disabled={busy}>取消</button><button className={`btn ${action === 'delete' ? 'btn-danger' : 'btn-dark'}`} disabled={busy || ((action === 'tag' || action === 'untag') && !value.trim())} onClick={apply}>{busy ? '处理中…' : action === 'delete' ? '删除' : '应用'}</button></>}>
        {action === 'delete' ? <p>组件的代码、截图和提示词会一并删除，无法恢复。</p>
          : action === 'tag' || action === 'untag' ? <label className="field"><span>标签名称</span><input value={value} onChange={e => setValue(e.target.value)} maxLength={30} autoFocus list="asset-tag-names" /><datalist id="asset-tag-names">{tags.map(tag => <option key={tag.name} value={tag.name}>{localizedName(tag.name, tag.labels, locale)}</option>)}</datalist></label>
          : <label className="field"><span>分类</span><SelectControl label="移动到分类" fullWidth value={value} onValueChange={setValue}
            options={[{ value: '', label: '未分类' }, ...categories.map(c => ({ value: c.id, label: c.name }))]} /></label>}
      </Dialog>
    </div></PreviewActivity>
  );
}
