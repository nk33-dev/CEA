import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DirListing } from '../shared/types.ts';
import { badRequest } from './errors.ts';
import { Library } from './library.ts';

/**
 * 本机目录浏览。程序只在 127.0.0.1 上监听，浏览器自己的文件选择框拿不到完整路径，
 * 选素材库位置、导入文件夹和导出位置都靠这里列目录。
 */

function drives(): DirListing['entries'] {
  const found: DirListing['entries'] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      fs.accessSync(root);
      found.push({ name: root, path: root, library: false });
    } catch { /* 没有这个盘 */ }
  }
  return found;
}

export function listDir(input: string): DirListing {
  const home = os.homedir();
  if (!input && process.platform === 'win32') return { path: '', parent: null, kind: null, entries: drives(), home };
  const dir = path.resolve(input || home);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw badRequest(`文件夹不存在：${dir}`);
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    throw badRequest(`没有权限读取：${dir}`);
  }
  const entries = names
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && e.name !== 'node_modules' && e.name !== 'System Volume Information')
    .map(e => {
      const full = path.join(dir, e.name);
      return { name: e.name, path: full, library: fs.existsSync(path.join(full, 'library.json')) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const up = path.dirname(dir);
  const parent = up !== dir ? up : process.platform === 'win32' ? '' : null;
  return { path: dir, parent, kind: Library.check(dir), entries, home };
}

export function makeDir(parent: string, name: string): string {
  const clean = name.trim();
  if (!clean || /[<>:"/\\|?*\u0000-\u001f]/.test(clean) || /[. ]$/.test(clean)) throw badRequest('文件夹名称不合法');
  const target = path.join(path.resolve(parent), clean);
  if (fs.existsSync(target)) throw badRequest('已经有同名文件夹');
  fs.mkdirSync(target);
  return target;
}

/** 在系统文件管理器里打开 */
export function reveal(target: string) {
  const dir = path.resolve(target);
  if (!fs.existsSync(dir)) throw badRequest(`文件夹不存在：${dir}`);
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]]
    : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
