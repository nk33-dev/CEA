import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import X from 'lucide-react/icons/x';
import type { Category, LibraryInfo, TagCount } from '../../shared/types.ts';
import { api, errorMessage } from './api.ts';
import { toastController, type ToastHandle } from './toastController.ts';

interface LibraryContextValue {
  info: LibraryInfo | null;
  categories: Category[];
  tags: TagCount[];
  /** 素材、分类或标签变化后调用；revision 递增让列表重新加载 */
  refresh: () => Promise<void>;
  revision: number;
  loadError: string | null;
  notify: (text: string) => void;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary 需要在 LibraryProvider 内使用');
  return ctx;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toastEl = useRef<HTMLDivElement>(null);
  const toast = useRef<ToastHandle | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [i, c, t] = await Promise.all([api.library(), api.categories(), api.tags()]);
      setInfo(i);
      setCategories(c);
      setTags(t);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
    setRevision(r => r + 1);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    toast.current = toastController(toastEl.current!);
    return () => toast.current?.destroy();
  }, []);

  const notify = useCallback((text: string) => toast.current?.show(text, { duration: 4000 }), []);

  return (
    <LibraryContext.Provider value={{ info, categories, tags, refresh, revision, loadError, notify }}>
      {children}
      <div ref={toastEl} className="t-toast toast" role="status" aria-live="polite" aria-hidden="true" inert>
        <span data-toast-message />
        <button type="button" className="toast-close" data-toast-dismiss aria-label="关闭提示">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </LibraryContext.Provider>
  );
}
