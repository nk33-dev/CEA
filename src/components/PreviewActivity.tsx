import { uiText, useUi } from '../lib/uiI18n.ts';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export const MAX_RETAINED_PREVIEWS = 24;
export const MAX_WARMING_PREVIEWS = 2;
export const MAX_GPU_CONTEXTS = 6;
export const BACKGROUND_RELEASE_MS = 30_000;

export function createActivity() {
  const pending = new Set<symbol>();
  const listeners = new Set<() => void>();
  let retained: readonly string[] = [];
  const warming = new Set<string>();
  const waiting = new Set<string>();
  const gpu = new Map<string, number>();
  const active = new Set<string>();
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = true;
  const publish = () => listeners.forEach(listener => listener());
  const trim = (keep?: string) => {
    let changed = false;
    while (retained.length > MAX_RETAINED_PREVIEWS || [...gpu.values()].reduce((sum, count) => sum + count, 0) > MAX_GPU_CONTEXTS) {
      const oldest = retained.find(id => id !== keep && !active.has(id) && (retained.length > MAX_RETAINED_PREVIEWS || gpu.has(id)));
      if (!oldest) break;
      retained = retained.filter(id => id !== oldest);
      gpu.delete(oldest);
      warming.delete(oldest);
      changed = true;
    }
    return changed;
  };
  const retain = (id: string) => {
    if (retained.at(-1) === id) return;
    retained = [...retained.filter(value => value !== id), id];
    trim(id);
    publish();
  };
  const scheduleWarm = () => {
    if (!visible || warmTimer || !waiting.size || warming.size >= MAX_WARMING_PREVIEWS) return;
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
    visible: () => visible,
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      clearTimeout(releaseTimer);
      if (!visible) {
        clearTimeout(warmTimer);
        warmTimer = undefined;
        releaseTimer = setTimeout(() => {
          retained = [];
          warming.clear();
          gpu.clear();
          active.clear();
          publish();
        }, BACKGROUND_RELEASE_MS);
      } else scheduleWarm();
      publish();
    },
    dispose() { clearTimeout(warmTimer); clearTimeout(releaseTimer); },
    retain(id: string) {
      if (!visible) return;
      waiting.delete(id);
      warming.delete(id);
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
    cancelWarm(id: string) {
      if (!warming.delete(id)) return;
      gpu.delete(id);
      retained = retained.filter(value => value !== id);
      publish();
      scheduleWarm();
    },
    ready(id: string) {
      warming.delete(id);
      scheduleWarm();
    },
    resources(id: string, contexts: number) {
      if (!retained.includes(id) || !Number.isSafeInteger(contexts) || contexts < 1) return;
      gpu.set(id, contexts);
      if (trim(id)) publish();
      scheduleWarm();
    },
    activate(id: string, value: boolean) {
      if (value) active.add(id);
      else active.delete(id);
      if (trim()) publish();
      scheduleWarm();
    },
    release(id: string) {
      waiting.delete(id);
      warming.delete(id);
      gpu.delete(id);
      active.delete(id);
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
  useEffect(() => {
    const sync = () => activity.setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { document.removeEventListener('visibilitychange', sync); activity.dispose(); };
  }, [activity]);
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
  const visible = useSyncExternalStore(activity?.subscribe ?? (() => () => {}), activity?.visible ?? (() => true), () => true);
  useEffect(() => {
    if (visible && requested) activity?.retain(id);
  }, [activity, id, requested, visible]);
  useEffect(() => {
    if (visible && warm && !requested) return activity?.prewarm(id);
  }, [activity, id, warm, requested, visible]);
  useEffect(() => {
    if (!warm && !requested) activity?.cancelWarm(id);
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
