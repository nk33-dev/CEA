import { Fragment, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AssetSummary } from '../../shared/types.ts';

export function AssetGrid({ items, children }: { items: AssetSummary[]; children: (asset: AssetSummary) => ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const committedIds = useRef<string[]>([]);
  // React 的普通 DOM 重排会重启 iframe；保留挂载顺序，再用 moveBefore 移动已连接的节点。
  const stableItems = useMemo(() => {
    const byId = new Map(items.map(item => [item.id, item]));
    const retained = committedIds.current.filter(id => byId.has(id));
    const retainedIds = new Set(retained);
    return [...retained.map(id => byId.get(id)!), ...items.filter(item => !retainedIds.has(item.id))];
  }, [items]);

  useLayoutEffect(() => {
    committedIds.current = stableItems.map(item => item.id);
    const grid = host.current!;
    const elements = new Map([...grid.children].map(element => [(element as HTMLElement).dataset.assetId, element]));
    let before: Element | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const element = elements.get(items[i].id)!;
      if (element.nextElementSibling !== before) {
        if (typeof grid.moveBefore === 'function') grid.moveBefore(element, before);
        else grid.insertBefore(element, before);
      }
      before = element;
    }
  }, [items, stableItems]);

  return <div className="grid" ref={host}>
    {stableItems.map(item => <Fragment key={item.id}>{children(item)}</Fragment>)}
  </div>;
}
