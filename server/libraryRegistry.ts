import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { configDir, resolveLibraryPath } from './config.ts';
import { Library } from './library.ts';

const accessSchema = z.enum(['read', 'write']);
const aliasSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const entrySchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1).max(100),
  alias: aliasSchema, path: z.string().min(1), access: accessSchema,
});
const registrySchema = z.object({ version: z.literal(1), libraries: z.array(entrySchema) });
export type RegisteredLibrary = z.infer<typeof entrySchema>;
export type LibraryAccess = z.infer<typeof accessSchema>;
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function registeredLibraries(): RegisteredLibrary[] {
  const file = path.join(configDir(), 'libraries.json');
  try {
    const result = registrySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (new Set(result.libraries.map(library => library.id)).size !== result.libraries.length ||
      new Set(result.libraries.map(library => library.alias)).size !== result.libraries.length) {
      throw new Error('素材库注册表包含重复 ID 或别名');
    }
    return result.libraries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(`无法读取素材库注册表 ${file}，请检查文件后重试。`, { cause: error });
  }
}

function saveLibraries(libraries: RegisteredLibrary[]) {
  const directory = configDir();
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `libraries-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(registrySchema.parse({ version: 1, libraries }), null, 2), { flag: 'wx' });
    fs.renameSync(temporary, path.join(directory, 'libraries.json'));
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function findRegisteredLibrary(selector: string): RegisteredLibrary | undefined {
  return registeredLibraries().find(library => library.id === selector || library.alias === selector);
}

export function registerLibrary(directory: string, options: { alias: string; name?: string; access?: LibraryAccess }): RegisteredLibrary {
  const identity = Library.identify(directory);
  const libraries = registeredLibraries();
  const existing = libraries.find(library => library.id === identity.libraryId);
  if (existing && !samePath(existing.path, identity.root)) {
    throw new Error(`此库 ID 已注册在 ${existing.path}。移动目录请使用 cea library relink ${existing.alias} <新路径>。`);
  }
  const entry = entrySchema.parse({
    id: identity.libraryId, alias: options.alias, name: options.name ?? existing?.name ?? path.basename(identity.root),
    path: identity.root, access: options.access ?? existing?.access ?? 'read',
  });
  if (libraries.some(library => library.id !== entry.id && (library.alias === entry.alias || library.id === entry.alias || library.alias === entry.id))) {
    throw new Error(`素材库别名已被占用：${entry.alias}`);
  }
  saveLibraries([...libraries.filter(library => library.id !== entry.id), entry]);
  return entry;
}

export function updateRegisteredLibrary(selector: string, patch: { alias?: string; name?: string; access?: LibraryAccess }): RegisteredLibrary {
  const entry = findRegisteredLibrary(selector);
  if (!entry) throw new Error(`素材库未注册：${selector}`);
  return registerLibrary(entry.path, {
    alias: patch.alias ?? entry.alias, name: patch.name ?? entry.name, access: patch.access ?? entry.access,
  });
}

export function relinkLibrary(selector: string, directory: string): RegisteredLibrary {
  const libraries = registeredLibraries();
  const existing = libraries.find(library => library.id === selector || library.alias === selector);
  if (!existing) throw new Error(`素材库未注册：${selector}`);
  const identity = Library.identify(directory);
  if (identity.libraryId !== existing.id) throw new Error('目标目录的库 ID 不匹配，原关联未修改。');
  const entry = { ...existing, path: identity.root };
  saveLibraries(libraries.map(library => library.id === entry.id ? entry : library));
  return entry;
}

export function unregisterLibrary(selector: string): RegisteredLibrary {
  const libraries = registeredLibraries();
  const entry = libraries.find(library => library.id === selector || library.alias === selector);
  if (!entry) throw new Error(`素材库未注册：${selector}`);
  saveLibraries(libraries.filter(library => library.id !== entry.id));
  return entry;
}

export function libraryStatus(entry: RegisteredLibrary) {
  try {
    const identity = Library.identify(entry.path);
    if (identity.libraryId !== entry.id) throw new Error('目录中的库 ID 已改变，请重新关联');
    return { ...entry, available: true as const };
  } catch (error) {
    return { ...entry, available: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface LibraryTarget {
  id: string;
  alias?: string;
  name: string;
  path: string;
  access: LibraryAccess;
}

export function resolveCliLibrary(selector?: string, write = false): LibraryTarget {
  const libraries = registeredLibraries();
  if (!selector && write && libraries.length > 1) throw new Error('存在多个素材库，写入必须使用 --library <库 ID、别名或路径> 指定目标。');
  const selected = selector ?? process.env.CEA_LIBRARY;
  let registered = selected ? libraries.find(library => library.id === selected || library.alias === selected) : undefined;
  let directory: string | undefined;
  if (registered) directory = registered.path;
  else if (selected) {
    const looksLikePath = path.isAbsolute(selected) || selected.startsWith('.') || /[/\\]/.test(selected);
    if (!looksLikePath && !fs.existsSync(selected)) throw new Error(`素材库未注册：${selected}。运行 cea library list 查看可用库。`);
    directory = path.resolve(selected);
  } else if (libraries.length === 1) {
    registered = libraries[0];
    directory = registered.path;
  } else if (libraries.length > 1) {
    throw new Error('存在多个素材库，请使用 --library 指定，或用 search --all-libraries 跨库搜索。');
  } else directory = resolveLibraryPath([])?.path;
  if (!directory) throw new Error('尚未配置素材库。使用 cea library add <已有目录> --alias <别名>，或 library init 创建新库。');
  const identity = Library.identify(directory);
  registered ??= libraries.find(library => library.id === identity.libraryId || samePath(library.path, identity.root));
  if (registered && registered.id !== identity.libraryId) throw new Error('目录中的库 ID 与注册记录不一致，请使用 library relink 重新关联。');
  if (registered && !samePath(registered.path, identity.root)) throw new Error('同一库 ID 已关联其他目录，请使用 library relink 明确切换位置。');
  if (write && registered?.access === 'read') throw new Error(`素材库 ${registered.alias} 为只读。可使用 cea library set ${registered.alias} --access write 明确授权写入。`);
  return {
    id: identity.libraryId, alias: registered?.alias, name: registered?.name ?? path.basename(identity.root),
    path: identity.root, access: registered?.access ?? 'write',
  };
}
