import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SourcePart } from '../../shared/prompt.ts';
import { chunkHtml, codePreview, escapeHtml } from '../lib/codeChunks.ts';
import { highlightAsync } from '../lib/codeWorker.ts';

export const CodeView = memo(function CodeView({ text, parts, prose, label }: {
  text: string; parts?: SourcePart[]; prose?: boolean; label: string;
}) {
  const job = useMemo(() => ({ text, parts }), [text, parts]);
  const preview = useMemo(() => prose ? [] : codePreview(text), [text, prose]);
  const [result, setResult] = useState<{ job: typeof job; chunks: string[] } | null>(null);
  useEffect(() => {
    if (prose) return;
    let active = true;
    let task: ReturnType<typeof highlightAsync> | undefined;
    const fallback = () => active && setResult({ job, chunks: chunkHtml(escapeHtml(text)) });
    try {
      task = highlightAsync(job);
      task.promise.then(chunks => active && setResult({ job, chunks })).catch(fallback);
    } catch {
      fallback();
    }
    return () => {
      active = false;
      task?.cancel();
    };
  }, [job, prose, text]);

  if (prose) return <pre className="reuse-text is-prose" dir="auto" tabIndex={0} aria-label={label}>{text}</pre>;
  const ready = result?.job === job;
  return <VirtualCode chunks={ready ? result.chunks : preview} label={label} busy={!ready} />;
});

function VirtualCode({ chunks, label, busy }: { chunks: string[]; label: string; busy: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer<HTMLDivElement, HTMLPreElement>({
    count: chunks.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 420,
    overscan: 1,
  });
  return (
    <div ref={scroll} className="reuse-text code-viewport" tabIndex={0} aria-label={label} aria-busy={busy || undefined}
      onKeyDown={e => {
        if (!(e.ctrlKey || e.metaKey) || !['Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        virtual.scrollToIndex(e.key === 'Home' ? 0 : chunks.length - 1, { align: e.key === 'Home' ? 'start' : 'end' });
      }}>
      <div className="code-space" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map(item => (
          <pre key={item.key} data-index={item.index} ref={virtual.measureElement} className="code-chunk"
            style={{ transform: `translateY(${item.start}px)` }} dangerouslySetInnerHTML={{ __html: chunks[item.index] }} />
        ))}
      </div>
    </div>
  );
}
