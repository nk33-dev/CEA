import { useEffect, useRef, useState } from 'react';
import type { CodeFile } from '../../shared/types.ts';
import type { ThemeContract } from '../../shared/theme.ts';
import { api, errorMessage } from './api.ts';

interface PreviewInput {
  title: string;
  framework: string;
  entry: string;
  files: CodeFile[];
  theme?: ThemeContract | null;
}

export function useDraftPreview(input: PreviewInput | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, { input: PreviewInput; url: string; at: number }>());
  const current = useRef<string | null>(null);
  const lastRetry = useRef(0);

  useEffect(() => {
    if (!input || !input.files.some(file => file.content.trim())) {
      setUrl(null);
      setPending(false);
      setError('');
      return;
    }
    const cached = cache.current.get(input.framework);
    const fresh = cached && Date.now() - cached.at < 5 * 60_000;
    const same = cached && cached.input.entry === input.entry && cached.input.files === input.files && cached.input.theme === input.theme;
    if (fresh && same) {
      setUrl(cached.url);
      setError('');
      setPending(false);
      current.current = input.framework;
      return;
    }
    const switching = current.current !== input.framework;
    const retrying = lastRetry.current !== retry;
    lastRetry.current = retry;
    current.current = input.framework;
    const controller = new AbortController();
    setError('');
    setPending(true);
    const timer = setTimeout(() => {
      api.draftPlay(input, controller.signal).then(result => {
        if (controller.signal.aborted) return;
        cache.current.set(input.framework, { input, url: result.url, at: Date.now() });
        setUrl(result.url);
      }).catch(e => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      }).finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    }, switching || !url || retrying ? 0 : 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [input?.framework, input?.entry, input?.files, input?.theme, retry]);

  return { url, error, pending, retry: () => setRetry(value => value + 1) };
}
