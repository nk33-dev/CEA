import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useRef, useState } from 'react';
import ArrowUp from 'lucide-react/icons/arrow-up';
import Folder from 'lucide-react/icons/folder';
import FolderPlus from 'lucide-react/icons/folder-plus';
import HardDrive from 'lucide-react/icons/hard-drive';
import Home from 'lucide-react/icons/home';
import Library from 'lucide-react/icons/library';
import type { DirListing } from '../../shared/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { Dialog } from './Dialog.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 打开时先显示的位置 */
  start?: string;
  /** 确认按钮的文字 */
  confirm: string;
  /** 返回 null 表示当前文件夹可以选；否则是不能选的原因 */
  check?: (listing: DirListing) => string | null;
  onPick: (path: string) => void;
}

/**
 * 选本机文件夹。浏览器自带的选择框拿不到完整路径，这里通过本地服务列目录。
 * 可以直接粘贴路径跳转，也可以就地新建文件夹。
 */
export function FolderPicker({ open, onClose, title, start, confirm, check, onPick }: Props) {
  useUi();
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const [creating, setCreating] = useState(false);
  const createBusy = useRef(false);

  const go = async (path: string) => {
    const typedAtStart = typed;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const next = await api.listDir(path, controller.signal);
      if (controller.signal.aborted) return;
      setListing(next);
      setTyped(previous => previous === typedAtStart ? next.path : previous);
      setNaming(null);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void go(start ?? '');
    return () => request.current?.abort();
    // 只在打开时定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = async () => {
    if (!listing?.path || !naming?.trim() || createBusy.current) return;
    createBusy.current = true;
    setCreating(true);
    try {
      const { path } = await api.makeDir(listing.path, naming);
      await go(path);
    } catch (e) {
      setError(errorMessage(e));
    } finally { createBusy.current = false; setCreating(false); }
  };

  const reason = listing ? typed.trim().toLowerCase() !== listing.path.toLowerCase() ? uiText("按回车打开输入的路径")
    : listing.path ? check?.(listing) ?? null : uiText("先选一个磁盘里的文件夹") : uiText("正在读取…");

  return (
    <Dialog open={open} onClose={onClose} title={title} wide locked={creating}
      footer={<>
        <span className="picker-reason">{reason}</span>
        <button type="button" className="btn btn-quiet" data-close-dialog>{uiText("取消")}</button>
        <button type="button" className="btn btn-dark" disabled={!!reason || !!error || loading || creating} onClick={() => { onPick(listing!.path); onClose(); }}>{confirm}</button>
      </>}>
      <form className="picker-path" onSubmit={e => { e.preventDefault(); void go(typed.trim()); }}>
        <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("上一级")} title={uiText("上一级")} disabled={listing?.parent == null} onClick={() => void go(listing!.parent!)}><ArrowUp size={15} /></button>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={uiText("此电脑")} aria-label={uiText("文件夹路径，可以直接粘贴后回车")} spellCheck={false} />
        <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("用户目录")} title={uiText("用户目录")} onClick={() => void go(listing?.home ?? '')}><Home size={15} /></button>
        <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("此电脑")} title={uiText("此电脑")} onClick={() => void go('')}><HardDrive size={15} /></button>
      </form>
      <div className="picker-list" aria-busy={loading}>
        {listing?.entries.map(e => (
          <button key={e.path} type="button" className="picker-item" onClick={() => void go(e.path)}>
            {!listing.path ? <HardDrive size={16} /> : e.library ? <Library size={16} className="picker-lib" /> : <Folder size={16} />}
            <span>{e.name}</span>
            {e.library && <small>{uiText("素材库")}</small>}
          </button>
        ))}
        {listing && !listing.entries.length && <p className="picker-empty">{uiText("没有子文件夹")}</p>}
      </div>
      <div className="picker-foot">
        {naming === null ? (
          <button type="button" className="link-btn" disabled={!listing?.path} onClick={() => setNaming('')}><FolderPlus size={14} />{uiText("新建文件夹")}</button>
        ) : (
          <form className="inline-form" onSubmit={e => { e.preventDefault(); void create(); }}>
            <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder={uiText("新文件夹名称")} aria-label={uiText("新文件夹名称")}
              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
            <button type="submit" className="btn btn-sm" disabled={!naming.trim() || creating}>{creating ? uiText("新建中…") : uiText("新建")}</button>
          </form>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
