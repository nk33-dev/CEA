import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

function createActivity() {
  const pending = new Set<symbol>();
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => pending.size,
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
  const [activity] = useState(createActivity);
  return <ActivityContext.Provider value={activity}>{children}</ActivityContext.Provider>;
}

export function usePreviewActivity() {
  const activity = useContext(ActivityContext);
  return { activity };
}

export function PreviewActivityStatus({ fetching }: { fetching: boolean }) {
  const activity = useContext(ActivityContext)!;
  const count = useSyncExternalStore(activity.subscribe, activity.snapshot, () => 0);
  const busy = fetching || count > 0;
  return <div className="browse-progress" data-busy={busy || undefined} role={busy ? 'status' : undefined}
    aria-label={busy ? fetching ? '正在更新组件' : '正在加载组件预览' : undefined} aria-hidden={!busy || undefined}>
    <span aria-hidden="true" />
  </div>;
}
