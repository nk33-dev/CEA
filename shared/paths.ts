const BAD_SEGMENT = /[<>:"|?*\u0000-\u001f]/;

/**
 * 把用户输入或压缩包里的相对路径规范成 a/b/c 形式。
 * 绝对路径、盘符、.. 以及 Windows 不允许的字符都会被拒绝，返回 null。
 */
export function normalizeRelPath(input: string): string | null {
  const p = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p || /^[a-zA-Z]:/.test(p) || /^[\\/]{2}/.test(input)) return null;
  const segments = p.split('/');
  for (const s of segments) {
    if (!s || s === '.' || s === '..' || BAD_SEGMENT.test(s) || /[. ]$/.test(s)) return null;
  }
  return segments.join('/');
}

/** 素材 ID 同时是目录名和播放路径的一段：小写字母、数字和连字符 */
export const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

export function assetDir(id: string): string {
  return `assets/${id}`;
}

/** 统一播放地址：/play/<id>/<framework>/；不写框架时播放第一个实现 */
export function playPath(id: string, framework?: string): string {
  return framework ? `/play/${id}/${framework}/` : `/play/${id}/`;
}

export function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', json: 'application/json', md: 'text/markdown',
  txt: 'text/plain', vue: 'text/plain', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  woff2: 'font/woff2',
};

export function mimeOf(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream';
}

export function isImage(mime: string) {
  return mime.startsWith('image/');
}

export function isVideo(mime: string) {
  return mime.startsWith('video/');
}

/** 代码块的语言标记 */
export function fenceLang(path: string): string {
  const ext = extOf(path);
  return ({ htm: 'html', mjs: 'js', vue: 'vue' } as Record<string, string>)[ext] ?? ext;
}
