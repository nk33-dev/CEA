import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLoaderData, useNavigate, useRouteError } from 'react-router';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Code from 'lucide-react/icons/code';
import ExternalLink from 'lucide-react/icons/external-link';
import FolderOpen from 'lucide-react/icons/folder-open';
import Heart from 'lucide-react/icons/heart';
import ImagePlus from 'lucide-react/icons/image-plus';
import MoreHorizontal from 'lucide-react/icons/more-horizontal';
import Package from 'lucide-react/icons/package';
import Pause from 'lucide-react/icons/pause';
import Pencil from 'lucide-react/icons/pencil';
import Play from 'lucide-react/icons/play';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Star from 'lucide-react/icons/star';
import Trash2 from 'lucide-react/icons/trash-2';
import Palette from 'lucide-react/icons/palette';
import { frameworkLabel, FRAMEWORK_IDS } from '../../shared/frameworks.ts';
import { locale as language } from '../../shared/locales.ts';
import type { AssetDetail, AssetFile } from '../../shared/types.ts';
import { isImage, isVideo, playPath } from '../../shared/paths.ts';
import { codeNotes } from '../../shared/notes.ts';
import { motionLabel, presentNote } from '../../shared/notePresentation.ts';
import { buildReuse, pickText, pickVariant, sourceParts, type ReuseKind } from '../../shared/prompt.ts';
import { CodeView } from '../components/CodeView.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { SelectControl } from '../components/SelectControl.tsx';
import { ContentLanguage } from '../components/ContentLanguage.tsx';
import { SelectionIndicator } from '../components/SelectionIndicator.tsx';
import { handleTabKeys } from '../lib/tabKeys.ts';
import { localizedName, localizedTitle } from '../../shared/contentLocale.ts';
import { PreviewStages } from '../components/Stage.tsx';
import { previewThemeFor, resolveTheme, type ReuseTheme } from '../../shared/theme.ts';
import { AppearanceToggle, type Appearance } from '../components/AppearanceToggle.tsx';
import { DeviceWorkspace, DeviceTools, DeviceZoom, DeviceCanvas, DeviceBackground } from '../components/DeviceWorkspace.tsx';
import { FullscreenButton, FullscreenFrame, useFullscreen } from '../components/Fullscreen.tsx';
import { api, ApiError, errorMessage, fileUrl } from '../lib/api.ts';
import { pickFramework, PREF_FRAMEWORK, useContentLocale, usePref } from '../lib/prefs.ts';
import { useLibrary } from '../lib/store.tsx';
import { reuseThemeOptions } from '../lib/themeChoices.ts';
import { usePreviewSession } from '../lib/previewSession.ts';

type Tab = ReuseKind | 'notes' | 'media';

const REUSE: { kind: ReuseKind; label: string; caption: string; copy: string; byFramework: boolean; byLocale: boolean }[] = [
  { kind: 'source', label: '源码', caption: '原样代码', copy: '复制源码', byFramework: true, byLocale: false },
  { kind: 'replica', label: '复刻', caption: '含源码', copy: '复制提示词', byFramework: true, byLocale: true },
  { kind: 'idea', label: '思路', caption: '不含源码', copy: '复制思路', byFramework: false, byLocale: true },
];

export function DetailPage() {
  const loadedAsset = useLoaderData<AssetDetail>();
  return <DetailView key={`${loadedAsset.id}:${loadedAsset.updatedAt}`} initialAsset={loadedAsset} />;
}

function DetailView({ initialAsset }: { initialAsset: AssetDetail }) {
  const navigate = useNavigate();
  const { notify, refresh, tags, categories } = useLibrary();
  const [asset, setAsset] = useState(initialAsset);
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState(true);
  const resumePreview = useCallback(() => setPlaying(true), []);
  const { background, setBackground, componentTheme, setComponentTheme } = usePreviewSession();
  const [themeChoice, setTargetTheme] = useState<ReuseTheme>('original');
  const [preferredFramework, setFramework] = usePref(PREF_FRAMEWORK, FRAMEWORK_IDS[0]);
  const [locale] = useContentLocale();
  const fullscreen = useFullscreen<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>('replica');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [packing, setPacking] = useState(false);

  const fw = asset ? pickFramework(asset.frameworks, preferredFramework) : preferredFramework;
  const support = useMemo(() => resolveTheme(asset.variants.find(v => v.framework === fw)), [asset.variants, fw]);
  const appearance: Appearance = componentTheme ?? support.default;
  const previewTheme = previewThemeFor(support, appearance);
  const targetTheme = themeChoice;
  const current = REUSE.find(r => r.kind === tab);
  const content = useMemo(() => (asset && current ? buildReuse(asset, current.kind, { framework: fw, locale, targetTheme }) : ''), [asset, current, fw, locale, targetTheme]);
  const parts = useMemo(() => asset && tab === 'source' ? sourceParts(asset, fw) : undefined, [asset, tab, fw]);
  const notes = useMemo(() => (asset ? codeNotes(pickVariant(asset, fw)) : { motion: [], notes: [] }), [asset, fw]);

  const toggleFavorite = async () => {
    const next = !asset.favorite;
    setAsset({ ...asset, favorite: next });
    try {
      await api.setFavorite(asset.id, next);
      void refresh();
    } catch (e) {
      setAsset(a => a && { ...a, favorite: !next });
      notify(`收藏没有保存：${errorMessage(e)}`);
    }
  };

  const downloadPackage = async () => {
    setMenuOpen(false);
    setPacking(true);
    try {
      notify(`参考包已下载：${await api.referencePackage(asset.id)}`);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setPacking(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteAsset(asset.id);
      await refresh();
      notify(`已删除「${localizedTitle(asset, locale)}」`);
      navigate('/', { replace: true });
    } catch (e) {
      notify(errorMessage(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const summary = pickText(asset, locale, 'summary');
  const title = localizedTitle(asset, locale);
  const category = categories.find(c => c.id === asset.categoryId);
  const tagLabels = new Map(tags.map(t => [t.name.toLowerCase(), localizedName(t.name, t.labels, locale)]));
  const tabs: { value: Tab; label: string }[] = [
    ...REUSE.map(r => ({ value: r.kind as Tab, label: r.label })),
    { value: 'notes', label: '说明' },
    { value: 'media', label: asset.media.length ? `截图 ${asset.media.length}` : '截图' },
  ];

  return (
    <div className="studio studio-detail">
      <header className="studio-head">
        <button type="button" className="icon-btn" aria-label="返回" onClick={() => (history.state?.idx > 0 ? navigate(-1) : navigate('/'))}>
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <div className="studio-title">
          <h1>{title}</h1>
          {asset.sourceUrl && (
            <a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="studio-source">
              {asset.sourceName || new URL(asset.sourceUrl).host}
              <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          )}
        </div>
        <div className="studio-actions">
          <ContentLanguage />
          <button type="button" className={`btn btn-quiet fav-btn${asset.favorite ? ' is-on' : ''}`} aria-pressed={asset.favorite} onClick={toggleFavorite}>
            <Heart size={16} strokeWidth={1.8} aria-hidden="true" />
            {asset.favorite ? '已收藏' : '收藏'}
          </button>
          <Link to={`/a/${asset.id}/edit`} className="btn btn-quiet">
            <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
            编辑
          </Link>
          <div className="menu-wrap">
            <button type="button" className="icon-btn icon-btn-round" aria-label="更多操作" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>
              <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="menu" role="menu" onKeyDown={e => e.key === 'Escape' && setMenuOpen(false)}>
                  <button type="button" role="menuitem" onClick={downloadPackage} disabled={packing}>
                    <Package size={15} strokeWidth={1.8} aria-hidden="true" />下载参考包
                  </button>
                  <a role="menuitem" href={playPath(asset.id, fw)} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                    <ExternalLink size={15} strokeWidth={1.8} aria-hidden="true" />在新标签页打开
                  </a>
                  <button type="button" role="menuitem" className="menu-danger" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>
                    <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />删除素材
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {(summary || category || asset.tags.length > 0) && <section className="studio-context" aria-label="组件信息">
        {summary && <p className="reuse-desc">{summary}</p>}
        {(category || asset.tags.length > 0) && (
          <ul className="tag-list" aria-label="分类与标签">
            {category && <li><Link to={`/?category=${encodeURIComponent(category.id)}`} className="tag-chip" title={`分类：${localizedName(category.name, category.labels, locale)}`}><FolderOpen size={12} aria-hidden="true" />{localizedName(category.name, category.labels, locale)}</Link></li>}
            {asset.tags.map(t => <li key={t}><Link to={`/?tags=${encodeURIComponent(JSON.stringify([t]))}`} className="tag-chip">{tagLabels.get(t.toLowerCase()) ?? t}</Link></li>)}
          </ul>
        )}
      </section>}

      <div className="studio-body">
        <DeviceWorkspace background={background} onBackgroundChange={setBackground}><section className="panel panel-preview" aria-label="预览">
          <div className="panel-bar">
            {asset.frameworks.length > 1 && <SelectControl label="实现框架" value={fw} onValueChange={setFramework} icon={<Code size={14} />}
              options={asset.frameworks.map(f => ({ value: f, label: frameworkLabel(f) }))} />}
            <AppearanceToggle value={appearance} onChange={setComponentTheme} support={support} />
            <div className="panel-bar-right">
              <DeviceBackground />
              <button type="button" className="icon-btn" aria-label={playing ? '暂停预览' : '播放预览'} title={playing ? '暂停预览' : '播放预览'} aria-pressed={!playing} onClick={() => setPlaying(p => !p)}>
                {playing ? <Pause size={16} strokeWidth={1.8} aria-hidden="true" /> : <Play size={16} strokeWidth={1.8} aria-hidden="true" />}
              </button>
              <button type="button" className="icon-btn" aria-label="重播" title="重播" onClick={() => { setPlaying(true); setReloadKey(k => k + 1); }}>
                <RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <FullscreenButton active={fullscreen.active} onToggle={fullscreen.toggle} />
            </div>
          </div>
          <div className="panel-subbar">
            <DeviceTools />
            <DeviceZoom />
          </div>
          <FullscreenFrame fullscreen={fullscreen}>
          <div className={`preview-well${background === 'dark' ? ' theme-dark' : ''}`}>
            <DeviceCanvas fullscreen={fullscreen.active}>{(device, onBounds, framing) =>
              <PreviewStages key={`${initialAsset.id}:${initialAsset.updatedAt}`} assetId={asset.id} framework={fw} version={initialAsset.updatedAt} title={title} componentTheme={previewTheme} theme={background === 'dark' ? 'dark' : 'light'} reloadKey={reloadKey} active={playing} onResume={resumePreview} device={device} framing={framing} onBounds={onBounds} />
            }</DeviceCanvas>
          </div>
          </FullscreenFrame>
        </section></DeviceWorkspace>

        <aside className="panel panel-reuse" aria-label="复用">
          <div className="reuse-tabs" role="tablist" aria-label="复用方式" onKeyDown={handleTabKeys}>
            <SelectionIndicator value={tab} underline />
            {tabs.map(t => (
              <button key={t.value} type="button" role="tab" id={`tab-${t.value}`} aria-controls="reuse-panel" data-selection-item
                aria-selected={tab === t.value} tabIndex={tab === t.value ? 0 : -1} onClick={() => setTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>

          <div id="reuse-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="reuse-body">
            {current ? (
              <>
                <div className="reuse-top">
                  <span className="reuse-caption" title={current.caption}>{current.byFramework ? `${frameworkLabel(fw)} · ` : ''}{current.caption}</span>
                  <div className="reuse-tools">
                    {current.kind !== 'source' && content && <SelectControl label="AI 配色目标" value={targetTheme}
                      onValueChange={v => setTargetTheme(v as ReuseTheme)} options={reuseThemeOptions()} align="end" icon={<Palette size={14} aria-hidden="true" />} />}
                    <CopyButton key={current.kind} text={() => content} label={current.copy} className="icon-btn reuse-copy copy-compact" />
                  </div>
                </div>
                {content
                  ? <CodeView text={content} parts={parts} prose={current.kind === 'idea'} label={`${current.label}内容`} />
                  : <p className="reuse-empty">还没有写{current.label}，<Link to={`/a/${asset.id}/edit`} className="link-btn">去补上</Link></p>}
              </>
            ) : tab === 'notes' ? (
              <NotesPanel notes={notes} locale={locale} />
            ) : (
              <MediaPanel asset={asset} onChange={a => { setAsset(a); void refresh(); }} />
            )}
          </div>
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除这个素材？"
        locked={deleting}
        footer={
          <>
            <button type="button" className="btn btn-quiet" data-close-dialog disabled={deleting}>取消</button>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={deleting}>{deleting ? '正在删除…' : '删除'}</button>
          </>
        }
      >
        <p>「{title}」的代码、截图和提示词会从素材库中一并删除，无法恢复。</p>
      </Dialog>
    </div>
  );
}

export function DetailError() {
  const error = useRouteError();
  const missing = error instanceof ApiError && error.status === 404;
  return <div className="page-narrow"><div className="empty">
    <p className="empty-title">{missing ? '这个素材不存在' : '素材没有加载出来'}</p>
    <p className="empty-text">{missing ? '它可能已被删除，或者当前打开的是另一个素材库。' : errorMessage(error)}</p>
    <Link to="/" className="btn">回到素材库</Link>
  </div></div>;
}

/** 动效参数和代码里的附注（许可、全局行为），不用翻代码就能看到 */
function NotesPanel({ notes, locale }: { notes: ReturnType<typeof codeNotes>; locale: string }) {
  const messages = language(locale).notes;
  return (
    <div className="notes" lang={locale} dir="auto">
      <section aria-labelledby="notes-extra">
        <h3 id="notes-extra" className="notes-title">{messages.heading}</h3>
        {notes.notes.length
          ? <div className="note-rows">{notes.notes.map(n => {
            const note = presentNote(n, locale);
            return <section className="note-row" key={n}>
              <h4>{note.title}</h4><p>{note.body}</p>
              {note.url && <a className="license-link" href={note.url} target="_blank" rel="noreferrer">{note.link}<ExternalLink size={12} /></a>}
              {note.original && note.original !== note.body && <details className="note-original"><summary>{messages.original}</summary><p>{note.original}</p></details>}
            </section>;
          })}</div>
          : <p className="reuse-empty">{messages.empty}</p>}
      </section>
      {notes.motion.length > 0 && (
        <section aria-labelledby="notes-motion">
          <h3 id="notes-motion" className="notes-title">{messages.motion}</h3>
          {notes.motion.map((g, index) => (
            <details key={g.title} className="motion-group" open={index === 0}>
              <summary className="motion-head">{motionLabel(g.title, locale)}<span>{g.params.find(p => /duration/i.test(p.label))?.value}</span></summary>
              <dl className="motion-params">
                {g.params.map(p => (
                  <div key={p.name}><dt title={p.name}>{motionLabel(p.label, locale)}</dt><dd>{p.value || '—'}</dd></div>
                ))}
              </dl>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

function MediaPanel({ asset, onChange }: { asset: AssetDetail; onChange: (a: AssetDetail) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);

  const upload = async (files: FileList | File[]) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError('');
    let latest: AssetDetail | null = null;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        setError(`${file.name} 不是图片或视频，已跳过`);
        continue;
      }
      setUploading(file.name);
      try {
        latest = await api.uploadMedia(asset.id, file, file.name);
      } catch (e) {
        setError(`${file.name} 上传失败：${errorMessage(e)}`);
      }
    }
    setUploading(null);
    busy.current = false;
    setWorking(false);
    if (latest) onChange(latest);
  };

  const act = async (fn: () => Promise<AssetDetail>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError('');
    try {
      onChange(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally { busy.current = false; setWorking(false); }
  };

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div
        className={`drop${dragging ? ' is-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
      >
        <ImagePlus size={20} strokeWidth={1.6} aria-hidden="true" />
        <p>{uploading ? `正在上传 ${uploading}…` : '拖入截图或录屏'}</p>
        <button type="button" className="btn btn-sm" onClick={() => input.current?.click()} disabled={working}>选择文件</button>
        <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }} />
      </div>
      {asset.media.length > 0 && (
        <ul className="media-list">
          {asset.media.map(f => (
            <MediaItem key={f.id} file={f} isCover={asset.cover === f.path} disabled={working}
              onCover={() => act(() => api.updateMedia(asset.id, f.id, { cover: true }))}
              onLabel={label => act(() => api.updateMedia(asset.id, f.id, { label }))}
              onDelete={() => act(() => api.deleteMedia(asset.id, f.id))} />
          ))}
        </ul>
      )}
    </>
  );
}

function MediaItem({ file, isCover, disabled, onCover, onLabel, onDelete }: {
  file: AssetFile; isCover: boolean; disabled: boolean; onCover: () => void; onLabel: (label: string) => void; onDelete: () => void;
}) {
  const [label, setLabel] = useState(file.label);
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  useEffect(() => setLabel(file.label), [file.label]);
  return (
    <li className="media-item">
      <div className="media-thumb">
        {isImage(file.mime) ? <img src={fileUrl(file.path)} alt={file.label || name} loading="lazy" />
          : isVideo(file.mime) ? <video src={fileUrl(file.path)} muted loop playsInline controls preload="metadata" /> : null}
        {isCover && <span className="cover-badge">封面</span>}
      </div>
      <div className="media-info">
        <input className="media-label" value={label} placeholder="添加说明" aria-label={`${name} 的说明`} disabled={disabled}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => label !== file.label && onLabel(label)}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <div className="media-row">
          <span className="media-name" title={name}>{name}</span>
          {isImage(file.mime) && !isCover && <button type="button" className="link-btn" disabled={disabled} onClick={onCover}><Star size={12} aria-hidden="true" />设为封面</button>}
          <button type="button" className="link-btn link-danger" disabled={disabled} onClick={onDelete} aria-label={`删除 ${name}`}>删除</button>
        </div>
      </div>
    </li>
  );
}
