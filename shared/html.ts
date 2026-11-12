/** 文件夹导入和粘贴共用的 HTML 拆分，保留外链资源。 */
export function splitHtml(source: string) {
  const styles: string[] = [];
  const scripts: string[] = [];
  let html = source.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styles.push(css.trim());
    return '';
  });
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs: string, js: string) => {
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']?(?!text\/javascript|module)[\w/+-]+/i.test(attrs)) return whole;
    scripts.push(js.trim());
    return '';
  });
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (body) {
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
    const links = head.match(/<link\b[^>]*>/gi) ?? [];
    html = [...links, body[1]].join('\n');
  } else {
    html = html.replace(/<!doctype[^>]*>|<\/?(html|head|body)\b[^>]*>|<meta\b[^>]*>|<title>[\s\S]*?<\/title>/gi, '');
  }
  return { markup: html.trim() + '\n', style: styles.join('\n\n') + (styles.length ? '\n' : ''), script: scripts.join('\n\n') + (scripts.length ? '\n' : '') };
}
