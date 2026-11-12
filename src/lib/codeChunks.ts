export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function chunkHtml(html: string, size = 20): string[] {
  // 跨块的着色标签在块尾闭合、下一块重新打开，各块才能独立挂载。
  const chunks: string[] = [];
  const open: string[] = [];
  let line = 0;
  let characters = 0;
  let current = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        current += escapeHtml(html.slice(i));
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith('</')) open.pop();
      else open.push(tag);
      current += tag;
      i = end + 1;
      continue;
    }
    let token = html[i++];
    if (token === '&') {
      const end = html.indexOf(';', i);
      if (end >= i && end - i < 12) { token += html.slice(i, end + 1); i = end + 1; }
    }
    current += token;
    characters += token.length;
    if ((token === '\n' && ++line % size === 0) || characters >= 12_000) {
      chunks.push(current + '</span>'.repeat(open.length));
      current = open.join('');
      characters = 0;
    }
  }
  if (current || !chunks.length) chunks.push(current + '</span>'.repeat(open.length));
  return chunks;
}

export function codePreview(text: string): string[] {
  return chunkHtml(escapeHtml(text.slice(0, 12_000)));
}
