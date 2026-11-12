import { useRef, useState, type ReactNode } from 'react';
import ArrowRight from 'lucide-react/icons/arrow-right';
import FolderOpen from 'lucide-react/icons/folder-open';
import Database from 'lucide-react/icons/database';
import { FolderPicker } from './FolderPicker.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useLibrary } from '../lib/store.tsx';

export function LibrarySetup({ children }: { children: ReactNode }) {
  const { info, initialized, loadError, refresh } = useLibrary();
  const [path, setPath] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  if (info) return children;

  const open = async () => {
    if (!path.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await api.switchLibrary(path.trim());
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <main className="setup">
    <header className="setup-brand"><strong>CEA</strong><span>Craft Every Aspect</span></header>
    <section className="setup-content" aria-labelledby="setup-title">
      {!initialized ? <p role="status">正在读取本机配置…</p> : <>
        <div className="setup-heading"><Database size={22} strokeWidth={1.5} aria-hidden="true" />
          <h1 id="setup-title">选择素材库位置</h1></div>
        <p className="setup-lead">组件代码、提示词和媒体文件会保存在这里，与程序分开。</p>
        <form onSubmit={e => { e.preventDefault(); void open(); }} className="setup-form">
          <label htmlFor="library-path">素材库文件夹</label>
          <div className="setup-path">
            <input id="library-path" value={path} onChange={e => setPath(e.target.value)} disabled={busy}
              placeholder="选择文件夹，或填写完整路径" spellCheck={false}
              aria-describedby="library-path-help" aria-invalid={!!error} />
            <button type="button" className="btn" disabled={busy} onClick={() => setPicking(true)}>
              <FolderOpen size={16} aria-hidden="true" />浏览</button>
          </div>
          <p id="library-path-help" className="setup-help">选择空文件夹创建新库，或打开已有素材库。已有文件不会被覆盖。</p>
          {(error || loadError) && <div className="setup-error" role="alert">
            <p>{error || loadError}</p>
            {loadError && <button type="button" className="text-link" onClick={() => void refresh()}>重新连接</button>}
          </div>}
          <div className="setup-actions">
            <span>之后可以在设置中切换位置。</span>
            <button type="submit" className="btn btn-dark" disabled={!path.trim() || busy || !!loadError}>
              {busy ? '正在打开…' : '打开素材库'}<ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        </form>
      </>}
    </section>
    <FolderPicker open={picking} onClose={() => setPicking(false)} title="选择素材库文件夹" confirm="使用此文件夹"
      check={listing => listing.kind === 'occupied' ? '请选择空文件夹或已有素材库，也可以新建文件夹' : null}
      onPick={value => { setPath(value); setError(''); }} />
  </main>;
}
