import { useRef, useState } from 'react';
import { Link } from 'react-router';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Check from 'lucide-react/icons/check';
import Download from 'lucide-react/icons/download';
import FileArchive from 'lucide-react/icons/file-archive';
import FolderOpen from 'lucide-react/icons/folder-open';
import { strToU8, zipSync } from 'fflate';
import { frameworkLabel } from '../../shared/frameworks.ts';
import type { DuplicateStrategy, ImportPreview, ImportResult } from '../../shared/types.ts';
import { AiPromptCard } from '../components/AiPrompt.tsx';
import { ChoiceControl } from '../components/ChoiceControl.tsx';
import { FolderPicker } from '../components/FolderPicker.tsx';
import { api, errorMessage, type ExportFormat } from '../lib/api.ts';
import { useLibrary } from '../lib/store.tsx';

const STRATEGIES: { value: DuplicateStrategy; label: string; hint: string }[] = [
  { value: 'skip', label: '跳过', hint: '保留库里现有的版本' },
  { value: 'overwrite', label: '覆盖', hint: '换成导入的版本' },
  { value: 'copy', label: '另存副本', hint: '再存一份，名称后加「导入副本」' },
];

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'backup', label: '完整备份', hint: '原样保留组件、收藏和时间，换电脑时使用。' },
  { value: 'folder', label: '素材文件夹', hint: '代码与提示词分文件保存，可修改后重新导入。' },
];


/** 拖进来的文件夹打包成 ZIP 再上传，服务端按同一套规则识别 */
async function readDropped(items: DataTransferItemList): Promise<File | null> {
  const entries = [...items].map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.some(e => e.isDirectory)) return null;
  const files: Record<string, Uint8Array> = {};
  const readEntries = (dir: FileSystemDirectoryEntry) => new Promise<FileSystemEntry[]>((resolve, reject) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    const next = () => reader.readEntries(batch => { if (batch.length) { all.push(...batch); next(); } else resolve(all); }, reject);
    next();
  });
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) return;
    if (entry.isDirectory) {
      for (const child of await readEntries(entry as FileSystemDirectoryEntry)) await walk(child, `${prefix}${entry.name}/`);
    } else {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files[prefix + entry.name] = new Uint8Array(await file.arrayBuffer());
    }
  };
  for (const e of entries) await walk(e, '');
  if (!Object.keys(files).length) files['.empty'] = strToU8('');
  const name = entries.length === 1 ? entries[0].name : '拖入的文件夹';
  return new File([zipSync(files, { level: 0 })], `${name}.zip`, { type: 'application/zip' });
}

export function TransferPage() {
  const { info, refresh, notify } = useLibrary();
  const [format, setFormat] = useState<ExportFormat>('backup');
  const [exporting, setExporting] = useState(false);
  const [exportedTo, setExportedTo] = useState('');
  const [exportError, setExportError] = useState('');
  const [picker, setPicker] = useState<'export' | 'import' | null>(null);
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<{ token: string; preview: ImportPreview } | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<'merge' | 'new'>('merge');
  const [duplicates, setDuplicates] = useState<DuplicateStrategy>('skip');
  const [targetPath, setTargetPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const download = async () => {
    setExporting(true);
    setExportedTo('');
    setExportError('');
    try { notify(`已下载：${await api.exportZip(undefined, format)}`); }
    catch (e) { setExportError(errorMessage(e)); }
    finally { setExporting(false); }
  };
  const exportToFolder = async (dir: string) => {
    setExporting(true);
    setExportError('');
    try { setExportedTo((await api.exportFolder(dir)).path); }
    catch (e) { setExportError(errorMessage(e)); }
    finally { setExporting(false); }
  };

  const load = async (label: string, fn: () => Promise<{ token: string; preview: ImportPreview }>) => {
    if (busy.current || importing) return;
    busy.current = true;
    setSource(label);
    setPreview(null);
    setResult(null);
    setMode('merge');
    setError(null);
    setReading(true);
    try { setPreview(await fn()); }
    catch (e) { setError(errorMessage(e)); }
    finally { busy.current = false; setReading(false); }
  };
  const chooseFile = (f: File) => void load(f.name, () => api.previewImport(f));
  const chooseFolder = (path: string) => void load(path, () => api.previewFolder(path));
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const zipped = await readDropped(e.dataTransfer.items).catch(() => null);
    const file = zipped ?? e.dataTransfer.files[0];
    if (file) chooseFile(file);
  };

  const reset = () => { setSource(''); setPreview(null); setError(null); setResult(null); setMode('merge'); };

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      const targetMode = preview.preview.source === 'backup' ? mode : 'merge';
      const r = await api.runImport({ token: preview.token, mode: targetMode, duplicates, targetPath: targetMode === 'new' ? targetPath.trim() : undefined });
      setResult(r);
      setPreview(null);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { setImporting(false); }
  };

  const p = preview?.preview;

  return (
    <div className="workspace workspace-admin transfer">
      <header className="workspace-head"><div><h1>导入导出</h1><p>当前素材库 <code>{info?.path}</code></p></div>

      </header>

      <div className={`transfer-layout${!p && !result && !error ? ' is-idle' : ''}`}>
      <section className="settings-section" aria-labelledby="import-title">
        <div className="settings-heading">
          <h2 id="import-title">导入</h2>
          <p className="muted">支持备份 ZIP 或组件文件夹，先预览再导入。</p>
        </div>
        <div className="settings-content transfer-import">
          {result ? (
            <div className="import-result" role="status">
              <p className="import-result-title"><Check size={16} strokeWidth={2.4} aria-hidden="true" />导入完成</p>
              <p>
                新增 {result.created} 个
                {result.overwritten > 0 && `，覆盖 ${result.overwritten} 个`}
                {result.copied > 0 && `，另存副本 ${result.copied} 个`}
                {result.skipped > 0 && `，跳过 ${result.skipped} 个`}
              </p>
              <div className="sheet-actions">
                <Link to="/" className="btn btn-dark btn-sm">查看组件</Link>
                <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>继续导入</button>
              </div>
            </div>
          ) : !p ? (
            <div
              className={`transfer-drop${dragging ? ' is-over' : ''}`} aria-busy={reading}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => void onDrop(e)}
            >
              <span className="transfer-upload-icon"><FileArchive size={24} strokeWidth={1.6} aria-hidden="true" /></span>
              <p>{reading ? `正在识别 ${source}…` : '把文件夹或 ZIP 拖到这里'}</p>
              <div className="transfer-drop-actions">
                <button type="button" className="btn" onClick={() => setPicker('import')} disabled={reading}><FolderOpen size={15} />选择文件夹</button>
                <button type="button" className="btn btn-quiet" onClick={() => input.current?.click()} disabled={reading}>选择 ZIP</button>
              </div>
              <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; if (f) chooseFile(f); e.target.value = ''; }} />
            </div>
          ) : (
            <div className="import-plan">
              <div className="import-file">
                {p.source === 'folder' ? <FolderOpen size={18} strokeWidth={1.6} aria-hidden="true" /> : <FileArchive size={18} strokeWidth={1.6} aria-hidden="true" />}
                <span className="import-file-name" title={source}>{source}</span>
                <button type="button" className="link-btn" onClick={reset} disabled={importing}>换一个</button>
              </div>
              <p className="import-facts">
                {p.source === 'backup' ? '完整备份' : '素材文件夹'} · {p.assetCount} 个组件 · {p.fileCount} 个文件
                {p.exportedAt && ` · ${new Date(p.exportedAt).toLocaleDateString('zh-CN')} 导出`}
              </p>
              {p.items.length > 0 && <ul className="import-items">
                {p.items.slice(0, 50).map(a => <li key={a.id}>
                  <span>{a.title}</span><small>{a.frameworks.map(frameworkLabel).join(' · ')}</small>
                  {p.duplicates.some(d => d.id === a.id) && <em>已存在</em>}
                </li>)}
                {p.items.length > 50 && <li className="muted">还有 {p.items.length - 50} 个</li>}
              </ul>}
              {!!p.problems?.length && <div className="import-problems" role="alert">
                <strong>{p.problems.length} 个没认出来，会跳过</strong>
                <ul>{p.problems.map(x => <li key={x.name}><code>{x.name}</code>：{x.reason}</li>)}</ul>
              </div>}

              {p.source === 'backup' && <div className="choice" role="radiogroup" aria-label="导入到">
                <button type="button" role="radio" aria-checked={mode === 'merge'} onClick={() => setMode('merge')} disabled={importing}>
                  <strong>合并到当前库</strong><small>{info?.path}</small>
                </button>
                <button type="button" role="radio" aria-checked={mode === 'new'} onClick={() => setMode('new')} disabled={importing}>
                  <strong>恢复成一个新库</strong><small>导入后切换过去</small>
                </button>
              </div>}
              {mode === 'new' && p.source === 'backup' && (
                <div className="path-pick">
                  <code>{targetPath || '还没选位置'}</code>
                  <button type="button" className="btn btn-sm" onClick={() => setPicker('import')} disabled={importing}>选择空文件夹</button>
                </div>
              )}

              {(mode === 'merge' || p.source === 'folder') && p.duplicates.length > 0 && (
                <div className="dup">
                  <p className="dup-title">{p.duplicates.length} 个已在库里，怎么处理？</p>
                  <ChoiceControl label="重复的组件" value={duplicates} onChange={setDuplicates} options={STRATEGIES} disabled={importing} />
                  <p className="reuse-hint">{STRATEGIES.find(s => s.value === duplicates)?.hint}</p>
                </div>
              )}

              <button type="button" className="btn btn-dark" onClick={runImport}
                disabled={importing || !p.assetCount || (mode === 'new' && p.source === 'backup' && !targetPath.trim())}>
                {importing ? '正在导入…' : `导入 ${p.assetCount} 个组件`}
              </button>
            </div>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}

          {!p && !result && (
            <AiPromptCard />
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="export-title">
        <div className="settings-heading">
          <h2 id="export-title">导出</h2>
          <p className="muted">导出全部 {info?.assetCount ?? 0} 个组件。</p>
        </div>
        <div className="settings-content transfer-export">
          <ChoiceControl label="导出格式" value={format} onChange={next => { setFormat(next); setExportedTo(''); setExportError(''); }} list disabled={exporting}
            options={FORMATS.map(option => ({
              value: option.value, ariaLabel: option.label,
              label: <>
                <span className="transfer-format-icon" aria-hidden="true">{option.value === 'backup' ? <FileArchive size={20} /> : <FolderOpen size={20} />}</span>
                <span className="transfer-format-text"><strong>{option.label}</strong><small>{option.hint}</small></span>
                <span className="transfer-format-check" aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>
              </>,
            }))} />
          <div className="transfer-export-footer">
          <div className="transfer-actions">
            <button type="button" className="btn" onClick={download} disabled={exporting || !info?.assetCount}>
              <Download size={15} />{exporting ? '正在导出…' : '下载 ZIP'}
            </button>
            {format === 'folder' && <button type="button" className="btn" onClick={() => setPicker('export')} disabled={exporting || !info?.assetCount}><FolderOpen size={15} />保存到文件夹</button>}
            <Link to="/?select=1" className="text-link">选择部分组件<ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          {exportError && <p className="form-error" role="alert">导出失败：{exportError}</p>}
          {exportedTo && <p className="transfer-done"><Check size={14} />已导出到 <button type="button" className="link-btn" onClick={() => void api.reveal(exportedTo)}>{exportedTo}</button></p>}
          </div>
        </div>
      </section>
      </div>

      <FolderPicker open={picker === 'export'} onClose={() => setPicker(null)} title="导出到哪里" confirm="导出到这里"
        check={() => null} onPick={dir => void exportToFolder(dir)} />
      <FolderPicker open={picker === 'import' && !(p && mode === 'new')} onClose={() => setPicker(null)} title="选择要导入的文件夹" confirm="导入这个文件夹"
        check={l => l.kind === 'library' ? '这是一个素材库。要用它请到设置里切换' : null} onPick={chooseFolder} />
      <FolderPicker open={picker === 'import' && !!p && mode === 'new'} onClose={() => setPicker(null)} title="恢复到哪个文件夹" confirm="使用这个文件夹"
        check={l => l.kind === 'empty' ? null : '需要一个空文件夹'} onPick={setTargetPath} />

    </div>
  );
}
