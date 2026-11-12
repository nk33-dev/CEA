import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import ArrowDown from 'lucide-react/icons/arrow-down';
import ArrowUp from 'lucide-react/icons/arrow-up';
import Languages from 'lucide-react/icons/languages';
import Merge from 'lucide-react/icons/merge';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';
import Trash2 from 'lucide-react/icons/trash-2';
import X from 'lucide-react/icons/x';
import { Dialog } from '../components/Dialog.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useLibrary } from '../lib/store.tsx';
import { ContentLanguage } from '../components/ContentLanguage.tsx';
import { SelectionIndicator } from '../components/SelectionIndicator.tsx';
import { handleTabKeys } from '../lib/tabKeys.ts';
import { labelSearch, localizedName } from '../../shared/contentLocale.ts';
import { TranslationEditor } from '../components/TranslationEditor.tsx';
import { useContentLocale } from '../lib/prefs.ts';

export function OrganizePage() {
  const { categories, tags, refresh, notify } = useLibrary();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'categories' ? 'categories' : 'tags';
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<'delete' | 'merge' | 'rename' | 'create' | 'translate' | null>(null);
  const [locale] = useContentLocale();
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setColumns(entry.contentRect.width >= 760 ? 2 : 1));
    observer.observe(scroll.current!);
    return () => observer.disconnect();
  }, []);
  const indexed = useMemo(() => {
    const all = tab === 'tags' ? tags.map(t => ({ ...t, id: t.name })) : categories;
    return all.map(row => ({ row, search: labelSearch(row.name, row.labels) }));
  }, [tab, tags, categories]);
  const rows = useMemo(() => indexed.filter(entry => entry.search.includes(deferredQuery.trim().toLowerCase())).map(entry => entry.row), [indexed, deferredQuery]);
  const virtual = useVirtualizer({ count: Math.ceil(rows.length / columns), getScrollElement: () => scroll.current, estimateSize: () => 44, overscan: 2 });
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [query, tab]);
  useEffect(() => { setSelected(new Set()); setQuery(''); }, [tab]);
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const open = (next: typeof action, initial = '') => { setValue(initial); setError(''); setAction(next); };
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const ids = [...selected];
      if (action === 'translate') {
        if (tab === 'tags') await api.tagLabels(ids[0], labels);
        else await api.updateCategory(ids[0], { labels });
      } else if (action === 'create') await api.createCategory(value);
      else if (action === 'rename') {
        if (tab === 'tags') await api.renameTag(ids[0], value);
        else await api.updateCategory(ids[0], { name: value });
      } else if (tab === 'tags') await api.manageTags(ids, action === 'merge' ? 'merge' : 'delete', value);
      else await api.deleteCategories(ids);
      await refresh();
      setSelected(new Set());
      setAction(null);
      notify('已保存');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allSelected && rows.some(row => selected.has(row.id));
  }, [allSelected, rows, selected]);
  const move = async (id: string, delta: number) => {
    const next = categories.map(c => c.id);
    const index = next.indexOf(id);
    if (index + delta < 0 || index + delta >= next.length) return;
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setBusy(true);
    try { await api.orderCategories(next); await refresh(); }
    catch (e) { notify(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="workspace workspace-admin organize">
      <header className="workspace-head"><div><h1>分类与标签</h1><p>{categories.length} 个分类 · {tags.length} 个标签</p></div>
        <div className="settings-actions"><ContentLanguage /></div>
      </header>
      <div className="organize-toolbar">
      <div className="workspace-tabs" role="tablist" aria-label="整理类型" onKeyDown={handleTabKeys}>
        <SelectionIndicator value={tab} underline />
        <button role="tab" aria-selected={tab === 'tags'} tabIndex={tab === 'tags' ? 0 : -1} onClick={() => setParams({})} data-selection-item>标签 <span>{tags.length}</span></button>
        <button role="tab" aria-selected={tab === 'categories'} tabIndex={tab === 'categories' ? 0 : -1} onClick={() => setParams({ tab: 'categories' })} data-selection-item>分类 <span>{categories.length}</span></button>
      </div>
      <div className="organize-tools">
        <label className="search"><Search size={16} /><input aria-label={tab === 'tags' ? '搜索标签' : '搜索分类'} placeholder={tab === 'tags' ? '搜索标签' : '搜索分类'} value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button type="button" className="search-clear" aria-label="清空整理搜索" onClick={() => setQuery('')}><X size={14} /></button>}
        </label>
        {tab === 'categories' && <button className="btn btn-sm" onClick={() => open('create')}><Plus size={15} />新建分类</button>}
        <span className="muted">{selected.size ? `已选 ${selected.size} 项` : `${rows.length} 项`}</span>
        {selected.size > 0 && <div className="organize-selection">
          {tab === 'tags' && <button className="btn btn-sm btn-quiet" aria-label="合并所选标签" onClick={() => open('merge')}><Merge size={15} />合并</button>}
          <button className="btn btn-sm btn-quiet icon-btn-danger" aria-label="删除所选" onClick={() => open('delete')}><Trash2 size={15} />删除</button>
          <button className="icon-btn icon-btn-sm" aria-label="清除选择" title="清除选择" onClick={() => setSelected(new Set())}><X size={15} /></button>
        </div>}
      </div>
      </div>
      <div className="organize-headings" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}>
      {Array.from({ length: columns }, (_, index) => <div key={index} className={`organize-head${tab === 'categories' ? ' with-order' : ''}`}>
        {index === 0 ? <input ref={selectAll} type="checkbox" aria-label="选择全部筛选结果" checked={allSelected} onChange={() => setSelected(previous => {
          const next = new Set(previous);
          for (const row of rows) allSelected ? next.delete(row.id) : next.add(row.id);
          return next;
        })} /> : <span />}
        <span>名称</span><span>组件数</span><span />
      </div>)}
      </div>
      <div className="organize-list" style={rows.length <= 20 ? { height: Math.max(88, Math.ceil(rows.length / columns) * 44) } : undefined} ref={scroll} role="group" aria-label={tab === 'tags' ? '标签列表' : '分类列表'}>
        {rows.length ? <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map(item => <div className="organize-line" key={item.key} style={{ position: 'absolute', top: item.start, width: '100%', height: item.size, gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}>
            {rows.slice(item.index * columns, (item.index + 1) * columns).map(row => <div key={row.id} className={`organize-row${selected.has(row.id) ? ' is-selected' : ''}${tab === 'categories' ? ' with-order' : ''}`}>
              <input type="checkbox" aria-label={`选择 ${row.name}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
              <span className="organize-name" title={row.name}>{localizedName(row.name, row.labels, locale)}</span><span className="muted">{row.count}</span>
              <div className="organize-row-actions">
                {tab === 'categories' && <><button className="icon-btn" aria-label={`上移 ${row.name}`} title="上移" disabled={busy || categories[0]?.id === row.id} onClick={() => void move(row.id, -1)}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`下移 ${row.name}`} title="下移" disabled={busy || categories.at(-1)?.id === row.id} onClick={() => void move(row.id, 1)}><ArrowDown size={14} /></button></>}
                <button type="button" className="icon-btn" aria-label={`编辑译名 ${row.name}`} title="编辑译名" onClick={() => {
                  setSelected(new Set([row.id])); setLabels(row.labels ?? {}); open('translate', row.name);
                }}><Languages size={15} /></button>
                <button className="icon-btn" aria-label={`重命名 ${row.name}`} title="重命名" onClick={() => { setSelected(new Set([row.id])); open('rename', row.name); }}><Pencil size={15} /></button>
              </div>
            </div>)}
          </div>)}
        </div> : <div className="empty"><p>{query ? '没有匹配项' : tab === 'tags' ? '还没有标签' : '还没有分类'}</p></div>}
      </div>
      <Dialog open={!!action} onClose={() => setAction(null)} locked={busy} wide={action === 'translate'} className={action === 'translate' ? 'dialog-translation' : undefined}
        title={action === 'translate' ? '编辑译名' : action === 'delete' ? `删除 ${selected.size} 个${tab === 'tags' ? '标签' : '分类'}？` : action === 'merge' ? `合并 ${selected.size} 个标签` : action === 'create' ? '新建分类' : '重命名'}
        footer={<><button className="btn btn-quiet" data-close-dialog disabled={busy}>取消</button><button className={`btn ${action === 'delete' ? 'btn-danger' : 'btn-dark'}`} disabled={busy || (action !== 'delete' && action !== 'translate' && !value.trim())} onClick={apply}>{busy ? '处理中…' : action === 'delete' ? '删除' : '保存'}</button></>}>
        {action === 'delete' ? <p>{tab === 'tags' ? '这些标签会从关联组件上移除，组件保留。' : '关联组件会变为未分类，组件保留。'}</p>
          : action === 'translate' ? <TranslationEditor name={value} value={labels} onChange={setLabels} initialLocale={locale} disabled={busy} />
          : <label className="field"><span>{action === 'merge' ? '合并为' : '名称'}</span><input autoFocus value={value} maxLength={tab === 'tags' ? 30 : 40} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && value.trim() && !busy) void apply(); }} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </Dialog>
    </div>
  );
}
