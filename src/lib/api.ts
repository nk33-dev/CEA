import { uiText } from './uiI18n.ts';
import type {
  AssetDetail, AssetInput, AssetSummary, Category, CodeFile, DirListing, DuplicateStrategy,
  ImportPreview, ImportResult, LibraryInfo, TagCount, AssetPage,
} from '../../shared/types.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const OFFLINE = '连不上本地服务，请确认 CEA 服务仍在运行';

async function request<T>(method: string, url: string, body?: unknown, raw?: Blob, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: {
        'x-cea-client': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(raw ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, OFFLINE);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? uiText("请求失败（{{value0}}）", {value0: res.status}));
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

/** 触发浏览器下载；文件名取服务端 Content-Disposition */
async function download(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'x-cea-client': '1', 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new ApiError(0, OFFLINE);
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error ?? uiText("导出失败（{{value0}}）", {value0: res.status}));
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : 'export.zip';
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}

export const api = {
  library: () => request<LibraryInfo | null>('GET', '/api/library'),
  switchLibrary: (path: string) => request<LibraryInfo>('PUT', '/api/library', { path }),
  forgetRecent: (path: string) => request<LibraryInfo>('DELETE', '/api/library/recent', { path }),

  listDir: (path: string, signal?: AbortSignal) => request<DirListing>('GET', `/api/fs?path=${encodeURIComponent(path)}`, undefined, undefined, signal),
  makeDir: (parent: string, name: string) => request<{ path: string }>('POST', '/api/fs/mkdir', { parent, name }),
  reveal: (path?: string) => request<void>('POST', '/api/fs/reveal', { path }),

  assets: () => request<AssetSummary[]>('GET', '/api/assets'),
  assetPage: (params: URLSearchParams, signal?: AbortSignal) => request<AssetPage>('GET', `/api/assets?paged=1&${params}`, undefined, undefined, signal),
  asset: (id: string, signal?: AbortSignal) => request<AssetDetail>('GET', `/api/assets/${encodeURIComponent(id)}`, undefined, undefined, signal),
  createAsset: (input: AssetInput) => request<AssetDetail>('POST', '/api/assets', input),
  updateAsset: (id: string, input: AssetInput) => request<AssetDetail>('PUT', `/api/assets/${encodeURIComponent(id)}`, input),
  deleteAsset: (id: string) => request<void>('DELETE', `/api/assets/${encodeURIComponent(id)}`),
  manageAssets: (ids: string[], action: 'delete' | 'tag' | 'untag' | 'category', value?: string) => request<{ changed: number }>('POST', '/api/assets/batch', { ids, action, value }),
  setFavorite: (id: string, favorite: boolean) => request<{ favorite: boolean }>('PUT', `/api/assets/${encodeURIComponent(id)}/favorite`, { favorite }),
  draftPlay: (body: { title: string; framework: string; entry: string; files: CodeFile[]; theme?: import('../../shared/theme.ts').ThemeContract | null }, signal?: AbortSignal) => request<{ url: string }>('POST', '/api/play/draft', body, undefined, signal),

  uploadMedia: (id: string, file: Blob, name: string, label = '') =>
    request<AssetDetail>('POST', `/api/assets/${encodeURIComponent(id)}/media?name=${encodeURIComponent(name)}&label=${encodeURIComponent(label)}`, undefined, file),
  updateMedia: (id: string, fileId: number, patch: { label?: string; cover?: boolean }) =>
    request<AssetDetail>('PATCH', `/api/assets/${encodeURIComponent(id)}/media/${fileId}`, patch),
  deleteMedia: (id: string, fileId: number) => request<AssetDetail>('DELETE', `/api/assets/${encodeURIComponent(id)}/media/${fileId}`),

  categories: () => request<Category[]>('GET', '/api/categories'),
  createCategory: (name: string) => request<Category>('POST', '/api/categories', { name }),
  updateCategory: (id: string, patch: { name?: string; sort?: number; labels?: Record<string, string> }) => request<Category>('PATCH', `/api/categories/${encodeURIComponent(id)}`, patch),
  deleteCategory: (id: string) => request<void>('DELETE', `/api/categories/${encodeURIComponent(id)}`),
  deleteCategories: (ids: string[]) => request<{ changed: number }>('POST', '/api/categories/batch', { ids }),
  orderCategories: (ids: string[]) => request<void>('POST', '/api/categories/order', { ids }),
  tags: () => request<TagCount[]>('GET', '/api/tags'),
  renameTag: (from: string, name: string) => request<void>('PATCH', `/api/tags/${encodeURIComponent(from)}`, { name }),
  tagLabels: (name: string, labels: Record<string, string>) => request<void>('PATCH', `/api/tags/${encodeURIComponent(name)}`, { labels }),
  deleteTag: (name: string) => request<void>('DELETE', `/api/tags/${encodeURIComponent(name)}`),
  manageTags: (names: string[], action: 'delete' | 'merge', target?: string) => request<{ changed: number }>('POST', '/api/tags/batch', { names, action, target }),

  exportZip: (ids?: string[], format: ExportFormat = 'backup') => download('POST', '/api/export', { ids, format }),
  exportFolder: (targetDir: string, ids?: string[]) => request<{ path: string }>('POST', '/api/export', { ids, format: 'folder', targetDir }),
  referencePackage: (id: string) => download('GET', `/api/assets/${encodeURIComponent(id)}/package`),
  previewImport: (file: File) => request<{ token: string; preview: ImportPreview }>('POST', `/api/import/preview?name=${encodeURIComponent(file.name)}`, undefined, file),
  previewFolder: (path: string) => request<{ token: string; preview: ImportPreview }>('POST', '/api/import/folder', { path }),
  runImport: (body: { token: string; mode: 'merge' | 'new'; duplicates: DuplicateStrategy; targetPath?: string }) =>
    request<ImportResult>('POST', '/api/import', body),
};

/** backup：完整备份，换电脑恢复用；folder：每个素材一个文件夹，人和 AI 都能直接读改 */
export type ExportFormat = 'backup' | 'folder';

export function fileUrl(rel: string) {
  return '/files/' + rel.split('/').map(encodeURIComponent).join('/');
}

export function errorMessage(e: unknown) {
  return uiText(e instanceof Error ? e.message : String(e));
}
