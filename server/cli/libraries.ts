import path from 'node:path';
import { Library } from '../library.ts';
import {
  findRegisteredLibrary, libraryStatus, registeredLibraries, registerLibrary, relinkLibrary,
  resolveCliLibrary, unregisterLibrary, updateRegisteredLibrary, type LibraryAccess,
} from '../libraryRegistry.ts';

export function manageLibraries(args: string[], options: { alias?: string; name?: string; access?: string }) {
  const [action = 'list', selector, directory, ...extra] = args;
  if (extra.length) throw new Error('library 命令参数过多，运行 cea --help 查看用法。');
  if (options.access && !['read', 'write'].includes(options.access)) throw new Error('--access 只能是 read 或 write。');
  const patch = { ...options, access: options.access as LibraryAccess | undefined };
  if (action === 'list') {
    if (selector) throw new Error('library list 不接收目录参数。');
    return { libraries: registeredLibraries().map(libraryStatus) };
  }
  if (!selector) throw new Error(`library ${action} 缺少素材库或目录。`);
  if (action === 'add' || action === 'init') {
    if (directory) throw new Error(`library ${action} 只接收一个目录。`);
    if (!patch.alias) throw new Error('请使用 --alias 设置唯一别名，例如 personal。');
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(patch.alias)) throw new Error('别名需以小写字母开头，最多 48 位，可包含数字、短横线和下划线。');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.trim().length > 100)) throw new Error('素材库名称需要 1–100 个字符。');
    if (action === 'init') {
      if (findRegisteredLibrary(patch.alias)) throw new Error(`素材库别名已被占用：${patch.alias}`);
      if (Library.check(selector) !== 'empty') throw new Error('创建新库需要空目录。已有素材库请使用 library add。');
      const lib = Library.open(path.resolve(selector));
      lib.close();
    }
    return { library: registerLibrary(selector, { ...patch, alias: patch.alias }) };
  }
  if (action === 'relink') {
    if (!directory) throw new Error('用法：cea library relink <库 ID 或别名> <新目录>');
    return { library: relinkLibrary(selector, directory) };
  }
  if (directory) throw new Error(`library ${action} 参数过多。`);
  if (action === 'set') return { library: updateRegisteredLibrary(selector, patch) };
  if (action === 'remove') return { library: unregisterLibrary(selector), filesDeleted: false };
  if (action === 'upgrade') {
    const target = resolveCliLibrary(selector, true);
    const lib = Library.openExisting(target.path, false);
    try { return { library: lib.info() }; }
    finally { lib.close(); }
  }
  throw new Error(`不认识的素材库操作：${action}`);
}
