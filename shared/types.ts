/**
 * 素材类型。目前只有组件；品牌配色、设计思路、整页参考以后加进来时复用同一套结构：
 * 文案（各语言的简介和思路提示词）+ 可选的代码实现 + 截图。
 */
import type { PreviewViewport } from './preview.ts';
import type { ThemeContract, ComponentTheme } from './theme.ts';

export const ASSET_TYPES = [
  { id: 'component', label: '组件' },
  { id: 'brand', label: '品牌' },
  { id: 'guide', label: '设计思路' },
  { id: 'page', label: '页面' },
] as const;
export type AssetType = (typeof ASSET_TYPES)[number]['id'];

export type FileRole = 'code' | 'media';

export interface Category {
  id: string;
  name: string;
  sort: number;
  count: number;
  labels?: Record<string, string>;
}

export interface TagCount {
  name: string;
  count: number;
  labels?: Record<string, string>;
}

/** path 是相对素材库根目录的路径，例如 assets/<id>/media/cover.png */
export interface AssetFile {
  id: number;
  role: FileRole;
  path: string;
  mime: string;
  size: number;
  label: string;
}

/** 代码文件，path 相对该实现的目录，例如 markup.html、WeatherDaySwitcher.tsx */
export interface CodeFile {
  path: string;
  content: string;
}

/** 某个语言下的文案 */
export interface AssetText {
  title?: string;
  /** 列表与详情页的简介 */
  summary: string;
  /** 思路提示词：描述结构、状态和动效，不含代码 */
  idea: string;
  themeIdeas?: Partial<Record<ComponentTheme, string>>;
}

/** 一种框架下的实现 */
export interface Variant {
  framework: string;
  entry: string;
  dependencies: Record<string, string>;
  supportsDarkMode?: boolean;
  theme?: ThemeContract | null;
  files: CodeFile[];
}

export interface AssetSummary {
  /** 稳定 ID：播放路径 /play/<id>/<framework>/ 和素材目录名 */
  id: string;
  title: string;
  type: AssetType;
  categoryId: string | null;
  tags: string[];
  favorite: boolean;
  cover: string | null;
  previewScale?: number;
  previewViewport?: PreviewViewport | null;
  sourceUrl: string;
  sourceName: string;
  frameworks: string[];
  locales: string[];
  /** 各语言简介，列表展示和搜索用 */
  summaries: Record<string, string>;
  titles?: Record<string, string>;
  /** 小写的全文，供前端搜索：名称、标签、简介、思路提示词 */
  searchText: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDetail extends Omit<AssetSummary, 'summaries' | 'searchText'> {
  texts: Record<string, AssetText>;
  variants: Variant[];
  media: AssetFile[];
}

export interface AssetInput {
  /** 只在新建时生效；留空时根据名称生成 */
  id?: string;
  title: string;
  type?: AssetType;
  categoryId: string | null;
  tags: string[];
  sourceUrl: string;
  sourceName: string;
  texts: Record<string, AssetText>;
  variants: Variant[];
  favorite?: boolean;
  previewScale?: number;
  previewViewport?: PreviewViewport | null;
}

export interface LibraryInfo {
  path: string;
  libraryId: string;
  schemaVersion: number;
  assetCount: number;
  /** 最近打开过的其他素材库，最新的在前 */
  recent?: { path: string; available: boolean }[];
  /** 程序配置所在目录 */
  configDir?: string;
  /** 命令行脚本的完整路径和系统，用来生成在任意目录都能运行的导入命令 */
  cli?: { path: string; platform: string };
}

/** 本机目录浏览：选择素材库位置、导入来源和导出位置时用 */
export interface DirListing {
  /** 空字符串表示「此电脑」，列出各个磁盘 */
  path: string;
  parent: string | null;
  kind: 'library' | 'empty' | 'occupied' | null;
  entries: { name: string; path: string; library: boolean }[];
  home: string;
}

export interface AssetQuery {
  q?: string;
  category?: string;
  framework?: string;
  tags?: string[];
  favorite?: boolean;
  sort?: 'updated' | 'created' | 'title';
  page?: number;
  limit?: number;
}

export interface AssetPage {
  items: AssetSummary[];
  total: number;
  page: number;
  limit: number;
  facets: { categories: Record<string, number>; frameworks: Record<string, number>; tags: Record<string, number>; favorite: number };
}

export type DuplicateStrategy = 'skip' | 'overwrite' | 'copy';

export interface ImportPreview {
  formatVersion: number;
  exportedAt: string;
  assetCount: number;
  categoryCount: number;
  fileCount: number;
  duplicates: { id: string; title: string; existingTitle: string }[];
  /** 将导入的素材 */
  items: { id: string; title: string; frameworks: string[] }[];
  /** backup：本工具导出的备份；folder：按素材文件夹格式识别 */
  source?: 'backup' | 'folder';
  /** 识别失败、会被跳过的素材 */
  problems?: { name: string; reason: string }[];
}

export interface ImportResult {
  created: number;
  overwritten: number;
  copied: number;
  skipped: number;
  libraryPath: string;
}
