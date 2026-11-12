import type { Library } from '../library.ts';
import type { ParsedPackage } from './zip.ts';

/**
 * 素材库里已有的分类、标签和依赖。命令行把它们列给 AI 看，导入时用来对照，
 * 让新素材尽量沿用已有的叫法；新词照样能建，只是会说明哪些是新的、和谁相近。
 */

export interface Term {
  name: string;
  labels?: Record<string, string>;
  count: number;
}

export interface Vocabulary {
  categories: Term[];
  tags: Term[];
  /** 按框架列出用到的 npm 包和版本 */
  dependencies: { framework: string; name: string; versions: string[]; count: number }[];
}

export function libraryVocabulary(lib: Library): Vocabulary {
  const deps = new Map<string, Vocabulary['dependencies'][number]>();
  for (const id of lib.repo.allAssetIds()) {
    for (const v of lib.repo.getVariants(id)) {
      for (const [name, version] of Object.entries(v.dependencies)) {
        const key = `${v.framework}\n${name}`;
        const entry = deps.get(key) ?? { framework: v.framework, name, versions: [], count: 0 };
        if (!entry.versions.includes(version)) entry.versions.push(version);
        entry.count++;
        deps.set(key, entry);
      }
    }
  }
  return {
    categories: lib.listCategories().map(({ name, labels, count }) => ({ name, labels, count })),
    tags: lib.repo.listTags(),
    dependencies: [...deps.values()].sort((a, b) => a.framework.localeCompare(b.framework) || b.count - a.count || a.name.localeCompare(b.name)),
  };
}

const names = (t: Term) => [t.name, ...Object.values(t.labels ?? {})];
/** 比较相近时忽略大小写、空格和连字符 */
const loose = (s: string) => s.toLowerCase().replace(/[\s_\-·./]+/g, '');

/** 同一个词：名称或任一语言的显示名相同，不分大小写 */
function findSame(terms: Term[], name: string) {
  const n = name.toLowerCase();
  return terms.find(t => t.name.toLowerCase() === n) ?? terms.find(t => names(t).some(v => v.toLowerCase() === n));
}

/** 相近的词：去掉空格连字符后相同，或一个包含另一个 */
function findSimilar(terms: Term[], name: string) {
  const k = loose(name);
  if (k.length < 2) return [];
  return terms
    .filter(t => names(t).some(v => {
      const vk = loose(v);
      return vk.length >= 2 && (vk === k || vk.includes(k) || k.includes(vk));
    }))
    .map(t => t.name)
    .slice(0, 3);
}

export interface TermNote {
  /** 素材里写的名字 */
  name: string;
  /** existing 已有；mapped 写的是已有词的显示名，已改成那个词；new 新建 */
  status: 'existing' | 'mapped' | 'new';
  /** 实际使用的名字 */
  target: string;
  /** 新词才有：相近的已有词 */
  similar: string[];
  /** 新词才有：是否写了中英文显示名 */
  labeled: boolean;
  /** 新标签和某个分类同名 */
  sameAsCategory?: boolean;
}

export interface AssetVocabularyNote {
  id: string;
  category: TermNote | null;
  tags: TermNote[];
}

/**
 * 把包里的分类和标签对到库里已有的词上：写的是已有词的名称或显示名时改用那个词，
 * 其余保持原样作为新词。会修改 pkg，重复调用结果不变。
 */
export function alignVocabulary(lib: Library, pkg: ParsedPackage): AssetVocabularyNote[] {
  const vocab = libraryVocabulary(lib);
  const categoryNotes = new Map<string, TermNote>();
  for (const c of pkg.categories) {
    if (lib.repo.getCategory(c.id)) {
      const name = lib.repo.getCategory(c.id)!.name;
      categoryNotes.set(c.id, { name: c.name, status: 'existing', target: name, similar: [], labeled: true });
      continue;
    }
    const same = findSame(vocab.categories, c.name);
    if (same) {
      const status = same.name.toLowerCase() === c.name.toLowerCase() ? 'existing' : 'mapped';
      categoryNotes.set(c.id, { name: c.name, status, target: same.name, similar: [], labeled: true });
      c.name = same.name;
    } else {
      categoryNotes.set(c.id, { name: c.name, status: 'new', target: c.name, similar: findSimilar(vocab.categories, c.name), labeled: !!c.labels && Object.keys(c.labels).length > 0 });
    }
  }

  return pkg.assets.map(a => {
    const labels = new Map(Object.entries(a.tagLabels ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const tags = a.tags.map((tag): TermNote => {
      const same = findSame(vocab.tags, tag);
      if (same) return { name: tag, status: same.name.toLowerCase() === tag.toLowerCase() ? 'existing' : 'mapped', target: same.name, similar: [], labeled: true };
      return {
        name: tag,
        status: 'new',
        target: tag,
        similar: findSimilar(vocab.tags, tag),
        labeled: Object.keys(labels.get(tag.toLowerCase()) ?? {}).length > 0,
        sameAsCategory: !!findSame(vocab.categories, tag) || pkg.categories.some(c => c.name.toLowerCase() === tag.toLowerCase()),
      };
    });
    a.tags = tags.map(t => t.target);
    return { id: a.id, category: a.categoryId ? categoryNotes.get(a.categoryId) ?? null : null, tags };
  });
}
