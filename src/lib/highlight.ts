import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { escapeHtml } from './codeChunks.ts';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);

const ALIAS: Record<string, string> = {
  html: 'xml', htm: 'xml', vue: 'xml', svg: 'xml', xml: 'xml',
  css: 'css', js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
};

/** 返回已转义的 HTML，可以直接放进 innerHTML */
export function highlight(code: string, lang: string): string {
  // 压缩依赖的超长行着色成本很高，保留原文即可，复制内容不受影响。
  if (code.length > 80_000 || /[^\n]{4000}/.test(code)) return escapeHtml(code);
  const language = ALIAS[lang];
  return language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
}

/** 提示词：正文原样显示，``` 代码块按语言着色，围栏本身保留 */
export function highlightPrompt(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/```([a-z]*)\n([\s\S]*?)\n```/g)) {
    out += escapeHtml(text.slice(last, m.index));
    out += `<span class="hl-fence">\`\`\`${m[1]}</span>\n${highlight(m[2], m[1])}\n<span class="hl-fence">\`\`\`</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}
