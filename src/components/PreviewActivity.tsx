import { uiText, useUi } from '../lib/uiI18n.ts';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

export const MAX_RETAINED_PREVIEWS = 12;

export function createActivity() {
  const pending = new Set<symbol>();
  const listeners = new Set<() => void>();
  let retained: readonly string[] = [];
  const publish = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => pending.size,
    resident: () => retained,
    retain(id: string) {
      if (retained.at(-1) === id) return;
      retained = [...retained.filter(value => value !== id), id].slice(-MAX_RETAINED_PREVIEWS);
      publish();
    },
    release(id: string) {
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

export function useRetainedPreview(id: string, requested: boolean) {
  const activity = useContext(ActivityContext);
  const retained = useSyncExternalStore(
    activity?.subscribe ?? (() => () => {}),
    activity?.resident ?? (() => EMPTY_RESIDENTS),
    () => EMPTY_RESIDENTS,
  );
  useEffect(() => {
    if (requested) activity?.retain(id);
  }, [activity, id, requested]);
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
