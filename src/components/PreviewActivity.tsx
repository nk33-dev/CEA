import { uiText, useUi } from '../lib/uiI18n.ts';
import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export const MAX_RETAINED_PREVIEWS = 24;
export const MAX_WARMING_PREVIEWS = 1;
export const PREVIEW_IDLE_MS = 600;
export const SCROLL_SETTLE_MS = 220;
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
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = true;
  let moving = false;
  let navigating = false;
  const canInteract = () => visible && !moving && !navigating;
  const canWarm = () => canInteract() && active.size === 0;
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
    if (!canWarm() || warmTimer || !waiting.size || warming.size >= MAX_WARMING_PREVIEWS) return;
    warmTimer = setTimeout(() => {
      warmTimer = undefined;
      for (const id of waiting) {
        if (warming.size >= MAX_WARMING_PREVIEWS) break;
        waiting.delete(id);
        warming.add(id);
        retain(id);
      }
    }, PREVIEW_IDLE_MS);
  };
  const stopWarm = () => { clearTimeout(warmTimer); warmTimer = undefined; };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => pending.size,
    resident: () => retained,
    visible: () => visible,
    canInteract,
    suspended: (id: string) => !canInteract() || active.size > 0 && !active.has(id),
    setNavigating(value: boolean) {
      if (navigating === value) return;
      navigating = value;
      if (value) stopWarm();
      else scheduleWarm();
      publish();
    },
    scroll() {
      clearTimeout(scrollTimer);
      stopWarm();
      if (!moving) { moving = true; publish(); }
      scrollTimer = setTimeout(() => { moving = false; publish(); scheduleWarm(); }, SCROLL_SETTLE_MS);
    },
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
    dispose() { clearTimeout(warmTimer); clearTimeout(releaseTimer); clearTimeout(scrollTimer); },
    retain(id: string) {
      if (!canInteract()) return;
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
      const changed = active.has(id) !== value;
      if (value) active.add(id);
      else active.delete(id);
      if (value) stopWarm();
      if (trim() || changed) publish();
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

export function PreviewActivity({ children, navigating = false }: { children: ReactNode; navigating?: boolean }) {
  useUi();
  const [activity] = useState(createActivity);
  useLayoutEffect(() => activity.setNavigating(navigating), [activity, navigating]);
  useEffect(() => {
    const sync = () => activity.setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    const scroll = () => activity.scroll();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('wheel', scroll, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('wheel', scroll);
      activity.dispose();
    };
  }, [activity]);
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>;
}

export function usePreviewActivity() {
  const activity = useContext(ActivityContext);
  return { activity };
}

export function usePreviewSuspended(id: string) {
  const activity = useContext(ActivityContext);
  return useSyncExternalStore(activity?.subscribe ?? (() => () => {}), () => activity?.suspended(id) ?? false, () => false);
}

const EMPTY_RESIDENTS: readonly string[] = [];

export function useRetainedPreview(id: string, requested: boolean, warm = false) {
  const activity = useContext(ActivityContext);
  const retained = useSyncExternalStore(
    activity?.subscribe ?? (() => () => {}),
    activity?.resident ?? (() => EMPTY_RESIDENTS),
    () => EMPTY_RESIDENTS,
  );
  const visible = useSyncExternalStore(activity?.subscribe ?? (() => () => {}), activity?.canInteract ?? (() => true), () => true);
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
