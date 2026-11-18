import { uiText, useUi } from '../lib/uiI18n.ts';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export const MAX_RETAINED_PREVIEWS = 12;
export const MAX_WARMING_PREVIEWS = 2;

export function createActivity() {
  const pending = new Set<symbol>();
  const listeners = new Set<() => void>();
  let retained: readonly string[] = [];
  const warming = new Set<string>();
  const waiting = new Set<string>();
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => listeners.forEach(listener => listener());
  const retain = (id: string) => {
    if (retained.at(-1) === id) return;
    const next = [...retained.filter(value => value !== id), id].slice(-MAX_RETAINED_PREVIEWS);
    for (const previous of retained) if (!next.includes(previous)) warming.delete(previous);
    retained = next;
    publish();
  };
  const scheduleWarm = () => {
    if (warmTimer || !waiting.size || warming.size >= MAX_WARMING_PREVIEWS) return;
    warmTimer = setTimeout(() => {
      warmTimer = undefined;
      for (const id of waiting) {
        if (warming.size >= MAX_WARMING_PREVIEWS) break;
        waiting.delete(id);
        warming.add(id);
        retain(id);
      }
    }, 120);
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => pending.size,
    resident: () => retained,
    retain(id: string) {
      waiting.delete(id);
      retain(id);
      scheduleWarm();
    },
    prewarm(id: string) {
      if (!retained.includes(id)) { waiting.add(id); scheduleWarm(); }
      return () => {
        waiting.delete(id);
        if (!waiting.size && warmTimer) { clearTimeout(warmTimer); warmTimer = undefined; }
      };
    },
    ready(id: string) {
      warming.delete(id);
      scheduleWarm();
    },
    release(id: string) {
      waiting.delete(id);
      warming.delete(id);
      scheduleWarm();
      if (!retained.includes(id)) return;
      retained = retained.filter(value => value !== id);
      publish();
    },
    begin() {
      const id = Symbol();
      pending.add(id);
      publish();
      return () => { if (pending.delete(id)) publish(); };
    },
  };
}

const ActivityContext = createContext<ReturnType<typeof createActivity> | null>(null);

export function PreviewActivity({ children }: { children: ReactNode }) {
  useUi();
  const [activity] = useState(createActivity);
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>;
}

export function usePreviewActivity() {
  const activity = useContext(ActivityContext);
  return { activity };
}

const EMPTY_RESIDENTS: readonly string[] = [];

export function useRetainedPreview(id: string, requested: boolean, warm = false) {
  const activity = useContext(ActivityContext);
  const retained = useSyncExternalStore(
    activity?.subscribe ?? (() => () => {}),
    activity?.resident ?? (() => EMPTY_RESIDENTS),
    () => EMPTY_RESIDENTS,
  );
  useEffect(() => {
    if (requested) activity?.retain(id);
  }, [activity, id, requested]);
  useEffect(() => {
    if (warm && !requested) return activity?.prewarm(id);
  }, [activity, id, warm, requested]);
  useEffect(() => () => activity?.release(id), [activity, id]);
  return activity ? retained.includes(id) : requested;
}

export function PreviewActivityStatus({ fetching }: { fetching: boolean }) {
  useUi();
  const activity = useContext(ActivityContext)!;
  const count = useSyncExternalStore(activity.subscribe, activity.snapshot, () => 0);
  const busy = fetching || count > 0;
  return <div className="browse-progress" data-busy={busy || undefined} role={busy ? 'status' : undefined}
    aria-label={busy ? fetching ? uiText("正在更新组件") : uiText("正在加载组件预览") : undefined} aria-hidden={!busy || undefined}>
    <span aria-hidden="true" />
  </div>;
}
