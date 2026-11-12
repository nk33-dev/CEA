import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Check from 'lucide-react/icons/check';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Search from 'lucide-react/icons/search';
import X from 'lucide-react/icons/x';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  search?: string;
}

interface Props {
  label: string;
  options: FilterOption[];
  selected: string[];
  multiple?: boolean;
  onChange: (next: string[]) => void;
  /** 选项多时显示搜索框 */
  searchAt?: number;
  footer?: ReactNode;
}

/**
 * 筛选下拉：按钮上显示已选内容，弹层里可以搜索、多选，每项带结果数。
 * 选项再多也只占工具栏里一个按钮的位置。
 */
export function FilterMenu({ label, options, selected, multiple, onChange, searchAt = 8, footer }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [placement, setPlacement] = useState({ left: 0, top: 0, width: 280, maxHeight: 392, transform: '' });
  const deferredQuery = useDeferredValue(query);
  const wrap = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const below = top + height - rect.bottom - 18;
      const above = rect.top - top - 18;
      const flip = below < 240 && above > below;
      const maxHeight = Math.max(0, Math.min(392, flip ? above : below));
      const panelWidth = Math.min(multiple ? 280 : 232, width - 24);
      setPlacement({
        left: Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12)),
        top: flip ? rect.top - 6 : rect.bottom + 6,
        width: panelWidth,
        maxHeight,
        transform: flip ? 'translateY(-100%)' : '',
      });
    };
    const onScroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, multiple]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      wrap.current?.contains(target as Node) || popup.current?.contains(target as Node);
    const onDown = (e: PointerEvent) => !inside(e.target) && setOpen(false);
    const onFocus = (e: FocusEvent) => !inside(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedOnly(false);
    }
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected.map(s => s.toLowerCase())), [selected]);
  const isOn = useCallback((v: string) => selectedSet.has(v.toLowerCase()), [selectedSet]);
  const indexed = useMemo(() => options.map(option => ({ option, search: `${option.label} ${option.search ?? ''}`.toLowerCase() })), [options]);
  const q = deferredQuery.trim().toLowerCase();
  const shown = useMemo(() => {
    return !q && !selectedOnly ? options
      : indexed.filter(entry => (!selectedOnly || isOn(entry.option.value)) && (!q || entry.search.includes(q))).map(entry => entry.option);
  }, [options, indexed, q, selectedOnly, isOn]);
  const summary = selected.length === 0 ? label
    : selected.length === 1 ? `${label}：${options.find(o => isOn(o.value))?.label ?? selected[0]}`
    : `${label} · ${selected.length}`;

  const toggle = (v: string) => {
    if (!multiple) {
      onChange([v]);
      setOpen(false);
      button.current?.focus();
      return;
    }
    onChange(isOn(v) ? selected.filter(s => s.toLowerCase() !== v.toLowerCase()) : [...selected, v]);
  };

  return (
    <div className="fmenu" ref={wrap}>
      <button ref={button} type="button" className={`fmenu-btn${selected.length ? ' is-active' : ''}`} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
        onClick={() => setOpen(o => !o)} onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
        }}>
        {selected.length > 0 && <Check size={13} aria-hidden="true" />}
        <span>{summary}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={popup} className="option-surface fmenu-pop" id={id} role="dialog" aria-label={label} style={placement}
          onKeyDown={e => {
            if (e.key !== 'Tab') return;
            const controls = popup.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled):not([tabindex="-1"]), a[href], [tabindex="0"]');
            if (!controls?.length) return;
            if (e.shiftKey && e.target === controls[0]) {
              e.preventDefault();
              setOpen(false);
              button.current?.focus();
            } else if (!e.shiftKey && e.target === controls[controls.length - 1]) {
              setOpen(false);
              button.current?.focus();
            }
          }}>
          {(multiple || options.length >= searchAt) && (
            <div className="fmenu-search">
              <Search size={14} strokeWidth={2} aria-hidden="true" />
              <input ref={search} autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); list.current?.focus(); }
                }} />
              {query && <button type="button" className="search-clear" aria-label={`清空${label}搜索`} title="清空搜索"
                onClick={() => { setQuery(''); search.current?.focus(); }}><X size={14} /></button>}
              {multiple && (selected.length > 0 || selectedOnly) && <button type="button" className="fmenu-selected" aria-pressed={selectedOnly}
                aria-label={selectedOnly ? `显示全部${label}` : `只看已选${label}`} title={selectedOnly ? `显示全部${label}` : `只看已选${label}`}
                onClick={() => setSelectedOnly(v => !v)}>已选 {selected.length}</button>}
            </div>
          )}
          <FilterOptions key={`${q}:${selectedOnly}`} listRef={list} label={label} options={shown} multiple={multiple} isOn={isOn} toggle={toggle}
            autoFocus={!multiple && options.length < searchAt} empty={selectedOnly && !q ? `尚未选择${label}` : !options.length && !q ? `还没有${label}` : `没有匹配的${label}`} />
          {(footer || (multiple && selected.length > 0)) && <div className="fmenu-foot">
              {footer}
              {multiple && selected.length > 0 && <button type="button" className="link-btn" onClick={() => {
                search.current?.focus();
                setSelectedOnly(false);
                onChange([]);
              }}>清除所选</button>}
          </div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

function FilterOptions({ label, options, multiple, isOn, toggle, listRef, autoFocus, empty }: {
  label: string; options: FilterOption[]; multiple?: boolean; isOn: (v: string) => boolean; toggle: (v: string) => void;
  listRef: React.RefObject<HTMLDivElement | null>; autoFocus: boolean; empty: string;
}) {
  const id = useId();
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [rowHeight, setRowHeight] = useState(36);
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setRowHeight(media.matches ? 44 : 36);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const active = useMemo(() => activeValue === null ? -1 : options.findIndex(o => o.value === activeValue), [options, activeValue]);
  const large = options.length > 80;
  const getItemKey = useCallback((index: number) => options[index].value, [options]);
  const virtual = useVirtualizer({
    count: options.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => rowHeight,
    getItemKey,
    overscan: 5,
    enabled: large,
    rangeExtractor: range => {
      const indexes = defaultRangeExtractor(range);
      return active < 0 || indexes.includes(active) ? indexes : [...indexes, active].sort((a, b) => a - b);
    },
  });
  useEffect(() => { virtual.measure(); }, [rowHeight, virtual]);
  useEffect(() => {
    if (autoFocus) listRef.current?.focus();
  }, [autoFocus, listRef]);
  const move = (index: number) => {
    setActiveValue(options[index].value);
    if (large) virtual.scrollToIndex(index, { align: 'auto' });
    else listRef.current?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const indexes = large ? virtual.getVirtualItems().map(v => v.index) : options.map((_, i) => i);
  return (
    <div ref={listRef} className="fmenu-list" style={{ '--option-row-height': `${rowHeight}px`, height: options.length ? Math.min(252, options.length * rowHeight) : 72 } as CSSProperties} role="listbox" aria-label={label} aria-multiselectable={!!multiple} tabIndex={0}
      aria-activedescendant={active < 0 ? undefined : `${id}-${active}`}
      onFocus={e => {
        if (e.target !== e.currentTarget || active >= 0) return;
        const selectedIndex = options.findIndex(o => isOn(o.value));
        const first = selectedIndex >= 0 ? selectedIndex : options.findIndex(o => o.count !== 0);
        if (first >= 0) move(first);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (active >= 0 && (options[active].count !== 0 || isOn(options[active].value))) toggle(options[active].value);
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const direction = e.key === 'ArrowUp' || e.key === 'End' ? -1 : 1;
        let index = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : active < 0 ? direction > 0 ? 0 : options.length - 1 : active + direction;
        while (index >= 0 && index < options.length && options[index].count === 0 && !isOn(options[index].value)) index += direction;
        if (index < 0 || index >= options.length) return;
        move(index);
      }}>
      <div className={large ? 'fmenu-option-space' : undefined} style={large ? { height: virtual.getTotalSize() } : undefined}>
        {indexes.map(index => {
          const o = options[index];
          return (
            <button key={o.value} id={`${id}-${index}`} type="button" role="option" aria-selected={isOn(o.value)} aria-posinset={index + 1} aria-setsize={options.length} tabIndex={-1}
              data-option-index={index} style={large ? { position: 'absolute', top: index * rowHeight } : undefined}
              className={`option-row fmenu-item${active === index ? ' is-focused' : ''}`} disabled={o.count === 0 && !isOn(o.value)}
              onClick={() => { setActiveValue(o.value); listRef.current?.focus({ preventScroll: true }); toggle(o.value); }} title={o.count === 0 && !isOn(o.value) ? `${o.label}：当前没有匹配组件` : o.label}>
              {multiple && <span className="fmenu-check">{isOn(o.value) && <Check size={11} strokeWidth={2.5} aria-hidden="true" />}</span>}
              <span className="fmenu-label">{o.label}</span>
              {!multiple && <span className="fmenu-tick">{isOn(o.value) && <Check size={14} strokeWidth={2} aria-hidden="true" />}</span>}
              {o.count !== undefined && <span className="count">{o.count}</span>}
            </button>
          );
        })}
      </div>
      {!options.length && <p className="fmenu-empty">{empty}</p>}
    </div>
  );
}
