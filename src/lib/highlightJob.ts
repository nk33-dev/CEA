import type { SourcePart } from '../../shared/prompt.ts';
import { chunkHtml, escapeHtml } from './codeChunks.ts';
import { highlight, highlightPrompt } from './highlight.ts';

export interface HighlightJob {
  text: string;
  parts?: SourcePart[];
}

export function renderCode(job: HighlightJob): string[] {
  const html = job.parts
    ? job.parts.map(p => (p.label ? `<span class="hl-comment">${escapeHtml(p.label)}</span>\n` : '') + highlight(p.code, p.lang)).join('\n\n')
    : highlightPrompt(job.text);
  return chunkHtml(html);
}
