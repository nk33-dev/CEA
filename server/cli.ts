import fs from 'node:fs';
import path from 'node:path';
import { cliCommand, folderGuide, quotePath } from '../shared/folderGuide.ts';
import { frameworkLabel } from '../shared/frameworks.ts';
import { resolveTheme, themeLabel } from '../shared/theme.ts';
import type { DuplicateStrategy } from '../shared/types.ts';
import { LOCAL_CLI, resolveLibraryPath } from './config.ts';
import { Library } from './library.ts';
import { folderFiles, parseFolderFiles, readFolder, writeFolder, type FolderPackage } from './transfer/folder.ts';
import { alignVocabulary, libraryVocabulary, type Term, type TermNote } from './transfer/vocabulary.ts';
import { importPackage, isBackupPackage, parsePackageFiles, previewImport, unzipSafe, type ParsedPackage } from './transfer/zip.ts';

/**
 * 命令行，主要给 AI 用：npm run cea -- <命令>
 *   guide                      打印素材文件夹格式，后面附上素材库已有的分类、标签和依赖
 *   vocab                      只看已有的分类、标签和依赖；--json 输出 JSON
 *   check <文件夹或 ZIP>        只检查，不写入
 *   import <文件夹或 ZIP>       导入；--overwrite 覆盖同 ID，--copy 另存副本，默认跳过
 *   export <位置> [id ...]      导出成素材文件夹
 *   list                       列出素材库里的组件，带分类和标签
 *   audit                      只读检查主题声明与兼容状态；--json 输出 JSON
 * 都可以加 --library <目录>。程序运行时也能用，导入后刷新页面即可看到。
 * 有素材没认出来或写入失败时退出码为 1，方便 AI 判断要不要继续改。
 */

const USAGE = `用法：npm run cea -- <命令>
  guide                     打印素材文件夹格式和素材库已有的分类、标签
  vocab                     只看已有的分类、标签和依赖（--json 输出 JSON）
  check <文件夹或 ZIP>       只检查，不写入
  import <文件夹或 ZIP>      导入（--overwrite 覆盖同 ID，--copy 另存副本，默认跳过）
  export <位置> [id ...]     导出成素材文件夹
  list                      列出组件，带分类和标签
  audit                     检查主题声明与兼容状态，只读（--json 输出 JSON）
  都可以加 --library <目录> 指定素材库`;

const argv = process.argv.slice(2);
const takeFlag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const takeValue = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = argv.splice(i, 2);
  return value;
};

const libraryArg = takeValue('--library');
const legacy = takeValue('--duplicates') as DuplicateStrategy | undefined;
const duplicates: DuplicateStrategy = takeFlag('--overwrite') ? 'overwrite' : takeFlag('--copy') ? 'copy' : legacy ?? 'skip';
const dryRun = takeFlag('--dry-run');
const asJson = takeFlag('--json');
const [command, ...rest] = argv;

function openLibrary() {
  const target = libraryArg ? { path: path.resolve(libraryArg) } : resolveLibraryPath([]);
  if (!target) throw new Error('尚未选择素材库。请先在页面中完成配置，或使用 --library <目录> 指定位置。');
  if ('fromConfig' in target && target.fromConfig && Library.check(target.path) !== 'library') {
    throw new Error('保存的素材库位置不可用，请重新选择或使用 --library <目录> 指定位置。');
  }
  return Library.open(target.path);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readSource(source: string | undefined) {
  if (!source) fail(USAGE);
  const abs = path.resolve(source);
  if (!fs.existsSync(abs)) fail(`找不到 ${abs}`);
  const files = fs.statSync(abs).isFile() ? unzipSafe(fs.readFileSync(abs)) : readFolder(abs);
  const name = path.basename(abs).replace(/\.zip$/i, '');
  const pkg: ParsedPackage | FolderPackage = isBackupPackage(files) ? parsePackageFiles(files) : parseFolderFiles(files, name);
  return { pkg, problems: (pkg as Partial<FolderPackage>).problems ?? [] };
}

const labelText = (t: { name: string; labels?: Record<string, string> }) => {
  const others = [...new Set(Object.values(t.labels ?? {}))].filter(v => v !== t.name);
  return others.length ? `${t.name}（${others.join(' / ')}）` : t.name;
};
const termLine = (terms: Term[]) => terms.map(t => `${labelText(t)} ×${t.count}`).join('，') || '（还没有）';

/** 素材库里已有的分类、标签和依赖，给 AI 写 asset.json 时参考 */
function vocabularyText(lib: Library) {
  const v = libraryVocabulary(lib);
  const deps = v.dependencies.map(d => `${d.framework}: ${d.name}@${d.versions.join(' / ')} ×${d.count}`);
  return [
    `## 当前素材库已有（${lib.root}，${lib.repo.countAssets()} 个组件）`,
    '',
    '括号里是显示名，× 后是组件数。',
    '',
    `分类：${termLine(v.categories)}`,
    '',
    `标签：${termLine(v.tags)}`,
    '',
    `依赖：${deps.length ? deps.join('，') : '（无）'}`,
  ].join('\n');
}

/** check / import 时说明分类和标签对上了哪个已有的、哪些是新的 */
function noteText(kind: string, n: TermNote) {
  if (n.status === 'existing') return null;
  if (n.status === 'mapped') return `${kind}：${n.name} → ${n.target}`;
  const hints = [
    n.similar.length ? `相近：${n.similar.join('、')}` : '',
    n.sameAsCategory ? '与分类同名' : '',
    n.labeled ? '' : '无译名',
  ].filter(Boolean);
  return `新${kind}：${n.name}${hints.length ? `（${hints.join('；')}）` : ''}`;
}

try {
  if (!command || command === 'guide') {
    let guideCommand = cliCommand(LOCAL_CLI);
    let vocabulary: string;
    try {
      const lib = openLibrary();
      try {
        guideCommand += ` --library ${quotePath(lib.root, LOCAL_CLI.platform)}`;
        vocabulary = vocabularyText(lib);
      } finally {
        lib.close();
      }
    } catch (e) {
      vocabulary = `（没能读取素材库里已有的分类和标签：${e instanceof Error ? e.message : e}）`;
    }
    console.log(folderGuide(guideCommand));
    console.log(`\n${vocabulary}`);
  } else if (command === 'vocab' || command === 'tags') {
    const lib = openLibrary();
    console.log(asJson ? JSON.stringify(libraryVocabulary(lib), null, 2) : vocabularyText(lib));
    lib.close();
  } else if (command === 'help' || command === '--help') {
    console.log(USAGE);
  } else if (command === 'audit') {
    const lib = openLibrary();
    try {
      const items = lib.repo.allAssetIds().flatMap(id => lib.getAsset(id).variants.map(variant => {
        const theme = resolveTheme(variant);
        return { id, framework: variant.framework, ...theme, action: theme.source === 'declared' ? 'keep' : 'optional-review' };
      }));
      console.log(asJson ? JSON.stringify(items, null, 2) : [
        '主题检查（不改写素材；兼容识别不等于实际配色验证）',
        ...items.map(item => `${item.id} · ${frameworkLabel(item.framework)}：${themeLabel(item.mode)} · ${item.source === 'declared' ? '已声明' : '兼容读取，可保持原样'}`),
      ].join('\n'));
    } finally { lib.close(); }
  } else if (command === 'list' || command === 'info') {
    const lib = openLibrary();
    const assets = lib.listAssets();
    const categories = new Map(lib.listCategories().map(c => [c.id, c.name]));
    if (asJson) {
      console.log(JSON.stringify(assets.map(a => ({ id: a.id, title: a.title, category: a.categoryId ? categories.get(a.categoryId) ?? null : null, tags: a.tags, frameworks: a.frameworks, summary: a.summaries })), null, 2));
    } else {
      console.log(`素材库：${lib.root}，${assets.length} 个组件`);
      for (const a of assets) {
        const category = a.categoryId ? categories.get(a.categoryId) : null;
        console.log(`  ${a.id}  ${a.title}  （${a.frameworks.map(frameworkLabel).join(' · ')}）${category ? `  分类：${category}` : ''}${a.tags.length ? `  标签：${a.tags.join('、')}` : ''}`);
      }
    }
    lib.close();
  } else if (command === 'check' || command === 'import') {
    const { pkg, problems } = readSource(rest[0]);
    const lib = openLibrary();
    const preview = previewImport(lib, pkg);
    const notes = pkg.formatVersion ? [] : alignVocabulary(lib, pkg);
    for (const a of pkg.assets) {
      const exists = preview.duplicates.some(d => d.id === a.id);
      const action = !exists ? '新增' : duplicates === 'overwrite' ? '覆盖' : duplicates === 'copy' ? '副本' : '跳过';
      console.log(`${action}  ${a.id}  ${a.title}  （${a.variants.map(v => frameworkLabel(v.framework)).join(' · ')}）${exists && duplicates === 'skip' ? '：已存在，加 --overwrite 覆盖' : ''}`);
      const note = notes.find(n => n.id === a.id);
      if (!note) continue;
      for (const line of [note.category && noteText('分类', note.category), ...note.tags.map(t => noteText('标签', t))]) {
        if (line) console.log(`      ${line}`);
      }
    }
    for (const p of problems) console.error(`错误  ${p.name}：${p.reason}`);
    if (command === 'check' || dryRun) {
      console.log(problems.length ? `\n有 ${problems.length} 个需要修改。` : '\n格式检查通过，可以导入；运行效果需在预览中验证。');
    } else if (pkg.assets.length) {
      const r = importPackage(lib, pkg, duplicates);
      console.log(`\n新增 ${r.created}，覆盖 ${r.overwritten}，副本 ${r.copied}，跳过 ${r.skipped}。素材库：${lib.root}`);
      if (r.created || r.overwritten || r.copied) {
        console.log('预览验收：对照原版检查电脑、手机及实际交互；有连续动效时验证暂停、继续和重播。导入成功不代表运行或视觉验收通过。');
      }
    }
    lib.close();
    if (problems.length) process.exit(1);
  } else if (command === 'export') {
    const target = rest[0];
    if (!target) fail(USAGE);
    const lib = openLibrary();
    const ids = rest.slice(1);
    for (const id of ids) if (!lib.repo.getAsset(id)) fail(`没有这个组件：${id}`);
    const out = writeFolder(target, ids.length === 1 ? ids[0] : `cea-export-${new Date().toISOString().slice(0, 10)}`, folderFiles(lib, ids));
    console.log(`已导出到 ${out}`);
    lib.close();
  } else {
    fail(`不认识的命令：${command}\n\n${USAGE}`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
