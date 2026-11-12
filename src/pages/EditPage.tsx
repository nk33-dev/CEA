import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ClipboardPaste from 'lucide-react/icons/clipboard-paste';
import Plus from 'lucide-react/icons/plus';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import X from 'lucide-react/icons/x';
import Trash2 from 'lucide-react/icons/trash-2';
import { framework as frameworkInfo, FRAMEWORKS } from '../../shared/frameworks.ts';
import { DEFAULT_LOCALE, contentLanguages, localeName } from '../../shared/locales.ts';
import type { AssetDetail, AssetInput, AssetText, Variant } from '../../shared/types.ts';
import { normalizeRelPath, playPath, slugify } from '../../shared/paths.ts';
import { parseReplicaPrompt, pickText } from '../../shared/prompt.ts';
import { Dialog } from '../components/Dialog.tsx';
import { FitStage, PreviewLoading, Stage } from '../components/Stage.tsx';
import { DeviceWorkspace, DeviceTools, DeviceZoom, DeviceCanvas, DeviceBackground } from '../components/DeviceWorkspace.tsx';
import { FullscreenButton, FullscreenFrame, useFullscreen } from '../components/Fullscreen.tsx';
import { SelectControl } from '../components/SelectControl.tsx';
import { ChoiceControl } from '../components/ChoiceControl.tsx';
import { LanguageControl } from '../components/LanguageControl.tsx';
import { SelectionIndicator } from '../components/SelectionIndicator.tsx';
import { handleTabKeys } from '../lib/tabKeys.ts';
import { composeIdea, ideaParts } from '../../shared/idea.ts';
import { codeNotes } from '../../shared/notes.ts';
import { motionLabel, presentNote } from '../../shared/notePresentation.ts';
import { previewThemeFor, resolveTheme, type ComponentTheme, type ThemeContract } from '../../shared/theme.ts';
import { AppearanceToggle, type Appearance } from '../components/AppearanceToggle.tsx';
import { usePreviewSession } from '../lib/previewSession.ts';
import type { PreviewViewport } from '../../shared/preview.ts';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import { useLibrary } from '../lib/store.tsx';
import { useDraftPreview } from '../lib/draftPreview.ts';

const HTML_LABEL: Record<string, string> = { 'markup.html': 'Markup', 'style.css': 'Styles', 'script.js': 'Script' };
const HTML_PLACEHOLDER: Record<string, string> = { 'markup.html': '<div class="card">…</div>', 'style.css': '.card { … }', 'script.js': '// 在结构之后运行一次' };

interface Draft {
  id: string;
  title: string;
  categoryId: string;
  tags: string[];
  sourceUrl: string;
  sourceName: string;
  previewScale: number;
  previewViewport: PreviewViewport | null;
  texts: Record<string, AssetText>;
  /** 依赖在编辑时是一段文本，每行一个 */
  variants: (Omit<Variant, 'dependencies'> & { deps: string })[];
}

function newVariant(fw: string): Draft['variants'][number] {
  const info = frameworkInfo(fw)!;
  return { framework: fw, entry: info.entry, deps: '', theme: { version: 1, mode: 'original', default: 'light' }, files: structuredClone(info.template) };
}

function emptyDraft(): Draft {
  return { id: '', title: '', categoryId: '', tags: [], sourceUrl: '', sourceName: '', previewScale: 1, previewViewport: null, texts: {}, variants: [newVariant('html')] };
}

function fromAsset(a: AssetDetail): Draft {
  return {
    id: a.id,
    title: a.title,
    categoryId: a.categoryId ?? '',
    tags: a.tags,
    sourceUrl: a.sourceUrl,
    sourceName: a.sourceName,
    previewScale: a.previewScale ?? 1,
    previewViewport: a.previewViewport ?? null,
    texts: a.texts,
    variants: a.variants.map(({ dependencies, ...v }) => ({ ...v, deps: Object.entries(dependencies).map(([n, ver]) => `${n}@${ver}`).join('\n') })),
  };
}

/** 每行一个依赖：name、name@version 或 @scope/name@version */
function parseDeps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)) {
    const at = line.lastIndexOf('@');
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1) || 'latest';
    else out[line] = 'latest';
  }
  return out;
}

const DRAFT_KEY = 'cea:draft:new:v2';

/** 组件配色声明合成一个下拉：双主题的默认色直接写进选项，不再多一个「默认主题」 */
const THEME_KEYS = {
  legacy: null,
  original: { version: 1, mode: 'original', default: 'light' },
  light: { version: 1, mode: 'light', default: 'light' },
  dark: { version: 1, mode: 'dark', default: 'dark' },
  'both-light': { version: 1, mode: 'both', default: 'light' },
  'both-dark': { version: 1, mode: 'both', default: 'dark' },
} as const satisfies Record<string, ThemeContract | null>;
function themeKey(theme: ThemeContract | null | undefined): keyof typeof THEME_KEYS {
  if (!theme) return 'legacy';
  return theme.mode === 'both' ? `both-${theme.default}` : theme.mode;
}

export function EditPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { categories, tags: allTags, refresh, notify } = useLibrary();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState('');
  const initialDraft = useRef<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fw, setFw] = useState('html');
  const [activeFile, setActiveFile] = useState('markup.html');
  const [textLocale, setTextLocale] = useState(DEFAULT_LOCALE);
  const [ideaTheme, setIdeaTheme] = useState<'original' | ComponentTheme>('original');
  const { background, setBackground, componentTheme, setComponentTheme } = usePreviewSession();
  const [reloadKey, setReloadKey] = useState(0);
  const [previewTab, setPreviewTab] = useState<'live' | 'card'>('live');
  const [editorTab, setEditorTab] = useState<'code' | 'info'>('code');
  const fullscreen = useFullscreen<HTMLDivElement>();
  const [tagInput, setTagInput] = useState('');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [fileDialog, setFileDialog] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [removingFramework, setRemovingFramework] = useState(false);
  const saved = useRef(false);

  const open = (d: Draft) => {
    setDraft(d);
    const v = d.variants[0];
    setFw(v.framework);
    setActiveFile(v.entry);
  };

  useEffect(() => {
    if (editing) {
      const controller = new AbortController();
      api.asset(id!, controller.signal).then(a => {
        if (controller.signal.aborted) return;
        const d = fromAsset(a);
        open(d);
        initialDraft.current = d;
        setInitial(JSON.stringify(d));
      }).catch(e => { if (!controller.signal.aborted) setLoadError(e instanceof ApiError && e.status === 404 ? '这个素材不存在或已被删除' : errorMessage(e)); });
      return () => controller.abort();
    }
    const fresh = emptyDraft();
    initialDraft.current = fresh;
    setInitial(JSON.stringify(fresh));
    let d = fresh;
    const stored = localStorage.getItem(DRAFT_KEY);
    if (stored) {
      try {
        d = { ...fresh, ...JSON.parse(stored) };
        setRestored(true);
      } catch { /* 草稿损坏时用空白模板 */ }
    }
    open(d);
  }, [editing, id]);

  // 停止输入 300ms 后再比较内容并保存草稿，长代码打字时不卡
  useEffect(() => {
    if (!draft) return;
    if (draft === initialDraft.current) {
      setDirty(false);
      return;
    }
    setDirty(true);
    const t = setTimeout(() => {
      const json = JSON.stringify(draft);
      const changed = json !== initial;
      setDirty(changed);
      // 新建时自动把草稿存到本机，意外关闭页面后可以继续
      if (editing || saved.current) return;
      if (changed) localStorage.setItem(DRAFT_KEY, json);
      else localStorage.removeItem(DRAFT_KEY);
    }, 300);
    return () => clearTimeout(t);
  }, [draft, initial, editing]);

  const variant = draft?.variants.find(v => v.framework === fw) ?? draft?.variants[0];
  const themeSupport = useMemo(() => resolveTheme(variant), [variant?.theme, variant?.files]);

  const draftPreview = useDraftPreview(variant ? {
    title: draft?.title || '草稿', framework: variant.framework, entry: variant.entry, files: variant.files, theme: variant.theme,
  } : null);
  const previewUrl = draftPreview.url;

  useEffect(() => {
    if (!dirty || !editing) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty, editing]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => editing && dirty && !saved.current && currentLocation.pathname !== nextLocation.pathname);

  const suggestedId = useMemo(() => slugify(draft?.title ?? ''), [draft?.title]);

  if (loadError) {
    return (
      <div className="page-narrow">
        <div className="empty">
          <p className="empty-title">素材没有加载出来</p>
          <p className="empty-text">{loadError}</p>
          <Link to="/" className="btn">回到素材库</Link>
        </div>
      </div>
    );
  }
  if (!draft || !variant) return <div className="page-narrow" aria-busy="true" />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => d && { ...d, [key]: value });
  const info = frameworkInfo(variant.framework)!;
  const current = variant.files.find(f => f.path === activeFile) ?? variant.files[0];
  const text = draft.texts[textLocale] ?? { summary: '', idea: '' };
  const idea = ideaParts(ideaTheme === 'original' ? text.idea : text.themeIdeas?.[ideaTheme] ?? '');
  const missingFrameworks = FRAMEWORKS.filter(f => !draft.variants.some(v => v.framework === f.id));
  // 主题声明优先；未声明的旧素材仍按代码兼容识别。
  const appearance: Appearance = componentTheme ?? themeSupport.default;
  const effectiveTheme = previewThemeFor(themeSupport, appearance);

  const setVariant = (patch: Partial<Draft['variants'][number]>) =>
    setDraft(d => d && { ...d, variants: d.variants.map(v => (v.framework === variant.framework ? { ...v, ...patch } : v)) });
  const setText = (field: 'title' | 'summary' | 'idea', value: string) =>
    setDraft(d => d && { ...d, texts: { ...d.texts, [textLocale]: { ...(d.texts[textLocale] ?? { summary: '', idea: '' }), [field]: value } } });
  const setIdea = (value: string) => {
    if (ideaTheme === 'original') setText('idea', value);
    else setDraft(d => d && { ...d, texts: { ...d.texts, [textLocale]: {
      ...(d.texts[textLocale] ?? { summary: '', idea: '' }),
      themeIdeas: { ...d.texts[textLocale]?.themeIdeas, [ideaTheme]: value },
    } } });
  };

  const showFramework = (f: string) => {
    if (f === variant.framework) return;
    const v = draft.variants.find(x => x.framework === f)!;
    setFw(f);
    setActiveFile(v.entry);
  };

  const addFramework = (f: string) => {
    const v = newVariant(f);
    setDraft({ ...draft, variants: [...draft.variants, v] });
    setFw(f);
    setActiveFile(v.entry);
  };

  const removeFramework = () => {
    if (draft.variants.length < 2) return;
    const rest = draft.variants.filter(v => v.framework !== variant.framework);
    setDraft({ ...draft, variants: rest });
    showFramework(rest[0].framework);
    setRemovingFramework(false);
  };

  const updateFile = (content: string) => setVariant({ files: variant.files.map(f => (f.path === current.path ? { ...f, content } : f)) });

  const addFile = () => {
    const clean = normalizeRelPath(fileName.trim());
    if (!clean) { setFileError('填写有效的相对路径，如 components/Button.tsx'); return; }
    if (variant.files.some(f => f.path.toLowerCase() === clean.toLowerCase())) { setFileError('已有同名文件，请换一个名称'); return; }
    setVariant({ files: [...variant.files, { path: clean, content: '' }] });
    setActiveFile(clean);
    setFileDialog(false);
  };

  const removeFile = (path: string) => {
    setVariant({ files: variant.files.filter(f => f.path !== path) });
    if (activeFile === path) setActiveFile(variant.entry);
  };

  const addTag = (raw: string) => {
    const parts = raw.split(/[,，\n]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    if (!parts.length) return;
    const next = [...draft.tags];
    for (const p of parts) {
      // 和已有标签只差大小写时用已有的写法，避免同一个标签出现两种拼写
      const known = allTags.find(t => t.name.toLowerCase() === p.toLowerCase())?.name ?? p;
      if (!next.some(t => t.toLowerCase() === known.toLowerCase())) next.push(known);
    }
    set('tags', next);
    setTagInput('');
  };

  const tagQuery = tagInput.trim().replace(/^#/, '').toLowerCase();
  const tagSuggestions = allTags
    .filter(t => !draft.tags.some(x => x.toLowerCase() === t.name.toLowerCase()) && (!tagQuery || t.name.toLowerCase().includes(tagQuery)))
    .slice(0, 12);

  const applyPaste = () => {
    const parsed = parseReplicaPrompt(pasteText);
    if (!parsed) {
      setPasteError('没有找到 HTML 代码。请粘贴 HTML 源码或带 HTML 代码块的复刻提示词；多文件组件请通过文件夹导入。');
      return;
    }
    const html: Draft['variants'][number] = {
      framework: 'html',
      entry: 'markup.html',
      deps: '',
      files: [
        { path: 'markup.html', content: parsed.markup ? parsed.markup + '\n' : '' },
        { path: 'style.css', content: parsed.style ? parsed.style + '\n' : '' },
        { path: 'script.js', content: parsed.script ? parsed.script + '\n' : '' },
      ],
    };
    setDraft(d => d && {
      ...d,
      title: parsed.title || d.title,
      sourceUrl: parsed.sourceUrl || d.sourceUrl,
      sourceName: parsed.sourceName || d.sourceName,
      texts: parsed.summary ? { ...d.texts, en: { ...d.texts.en, summary: parsed.summary, idea: d.texts.en?.idea ?? '' } } : d.texts,
      variants: [html, ...d.variants.filter(v => v.framework !== 'html')],
    });
    setFw('html');
    setActiveFile('markup.html');
    setTextLocale('en');
    setPasteOpen(false);
    setPasteText('');
    notify(`已填入「${parsed.title || '素材'}」`);
  };

  const createCategory = async () => {
    const name = newCategory?.trim();
    if (!name) return;
    try {
      const c = await api.createCategory(name);
      await refresh();
      set('categoryId', c.id);
      setNewCategory(null);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) {
      const invalid = e.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>(':invalid');
      if (invalid?.closest('.editor-info')) setEditorTab('info');
      requestAnimationFrame(() => { invalid?.focus(); invalid?.reportValidity(); });
      return;
    }
    const pendingTag = tagInput.trim();
    const input: AssetInput = {
      id: editing ? undefined : draft.id.trim() || undefined,
      title: draft.title,
      categoryId: draft.categoryId || null,
      tags: pendingTag ? [...draft.tags, pendingTag] : draft.tags,
      sourceUrl: draft.sourceUrl,
      sourceName: draft.sourceName,
      previewScale: draft.previewScale,
      previewViewport: draft.previewViewport,
      texts: draft.texts,
      variants: draft.variants.map(({ deps, ...v }) => ({ ...v, dependencies: parseDeps(deps) })),
    };
    setSaving(true);
    setSaveError(null);
    try {
      const result = editing ? await api.updateAsset(id!, input) : await api.createAsset(input);
      saved.current = true;
      if (!editing) localStorage.removeItem(DRAFT_KEY);
      await refresh();
      notify(editing ? '修改已保存' : `已添加「${result.title}」`);
      navigate(`/a/${result.id}`, { replace: true });
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    open(emptyDraft());
    setRestored(false);
  };

  const fileTabs = info.fixed
    ? [...info.fixed, ...variant.files.map(f => f.path).filter(p => !info.fixed!.includes(p))]
    : variant.files.map(f => f.path);

  return (
    <form className="studio editor" onSubmit={save} noValidate>
      <header className="studio-head">
        <Link to={editing ? `/a/${id}` : '/'} className="icon-btn" aria-label="返回">
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </Link>
        <div className="studio-title">
          <h1>{editing ? `编辑 ${draft.title}` : '添加素材'}</h1>
          {restored && !editing && (
            <span className="studio-note">已恢复上次没保存的内容 · <button type="button" className="link-btn" onClick={discardDraft}>清空重来</button></span>
          )}
        </div>
        <div className="studio-actions">
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          {!editing && (
            <button type="button" className="btn btn-quiet" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={15} strokeWidth={1.8} aria-hidden="true" />
              粘贴代码
            </button>
          )}
          <Link to={editing ? `/a/${id}` : '/'} className="btn btn-quiet">取消</Link>
          <button type="submit" className="btn btn-dark" disabled={saving}>{saving ? '正在保存…' : '保存'}</button>
        </div>
      </header>

      <div className="workspace-tabs editor-tabs" role="tablist" aria-label="编辑内容" onKeyDown={handleTabKeys}>
        <SelectionIndicator value={editorTab} underline />
        {([{ value: 'code', label: '代码与预览' }, { value: 'info', label: '信息与提示词' }] as const).map(tab => (
          <button key={tab.value} type="button" role="tab" id={`editor-tab-${tab.value}`} aria-controls={`editor-panel-${tab.value}`}
            aria-selected={editorTab === tab.value} tabIndex={editorTab === tab.value ? 0 : -1} data-selection-item onClick={() => setEditorTab(tab.value)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="editor-body">
        <section className="editor-work" role="tabpanel" id="editor-panel-code" aria-labelledby="editor-tab-code" hidden={editorTab !== 'code'} inert={editorTab !== 'code'}>
          <div className="panel editor-code-panel">
            <div className="panel-bar">
              <div className="fw-tabs" role="tablist" aria-label="实现" onKeyDown={handleTabKeys}>
                <SelectionIndicator value={variant.framework} itemsKey={draft.variants.map(v => v.framework).join('\0')} underline />
                {draft.variants.map(v => (
                  <button key={v.framework} type="button" role="tab" aria-selected={v.framework === variant.framework} tabIndex={v.framework === variant.framework ? 0 : -1} onClick={() => showFramework(v.framework)} data-selection-item>
                    {frameworkInfo(v.framework)?.label}
                  </button>
                ))}
              </div>
              {missingFrameworks.length > 0 && (
                <SelectControl label="添加实现" placeholder="+ 添加实现" value="" onValueChange={addFramework}
                  options={missingFrameworks.map(f => ({ value: f.id, label: f.label }))} />
              )}
            </div>
            <div className="file-tabs" role="group" aria-label="代码文件">
              <SelectControl label="代码文件" value={current?.path ?? ''} onValueChange={setActiveFile}
                options={fileTabs.map(p => ({ value: p, label: info.fixed ? HTML_LABEL[p] ?? p : p, note: p === variant.entry ? '入口' : undefined }))} />
              <span className="file-count">{fileTabs.length} 个文件</span>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="添加文件" title="添加文件" onClick={() => {
                setFileName(''); setFileError(''); setFileDialog(true);
              }}><Plus size={15} aria-hidden="true" /></button>
              {current && !info.fixed?.includes(current.path) && current.path !== variant.entry &&
                <button type="button" className="icon-btn icon-btn-sm icon-btn-danger" aria-label={`删除文件 ${current.path}`} title="删除当前文件" onClick={() => removeFile(current.path)}><Trash2 size={14} aria-hidden="true" /></button>}
            </div>
            {current && (
              <textarea
                className="code-editor"
                value={current.content}
                onChange={e => updateFile(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Tab' || e.shiftKey) return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: s, selectionEnd: end } = el;
                  updateFile(el.value.slice(0, s) + '  ' + el.value.slice(end));
                  requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                }}
                spellCheck={false}
                placeholder={info.fixed ? HTML_PLACEHOLDER[current.path] : ''}
                aria-label={`编辑 ${current.path}`}
              />
            )}
            <details className="code-options">
              <summary>实现设置</summary>
            {!info.fixed && (
              <div className="code-meta">
                <label className="field">
                  <span>入口文件 <small>默认导出组件</small></span>
                  <SelectControl label="入口文件" fullWidth value={variant.entry} onValueChange={entry => setVariant({ entry })}
                    options={variant.files.filter(f => info.entryExt.includes(f.path.split('.').pop()!)).map(f => ({ value: f.path, label: f.path }))} />
                </label>
                <label className="field">
                  <span>依赖 <small>每行一个，如 motion@^12</small></span>
                  <textarea rows={2} value={variant.deps} onChange={e => setVariant({ deps: e.target.value })} spellCheck={false} className="mono" />
                </label>
              </div>
            )}
            <div className="theme-contract-editor" title="写明这份代码实际带了哪些配色，决定预览能否切换深浅色和提示词怎么写；不会改动代码">
              <span>组件配色</span>
              <SelectControl label="组件配色" value={themeKey(variant.theme)} onValueChange={value => setVariant({ theme: THEME_KEYS[value as keyof typeof THEME_KEYS] })}
                options={[
                  { value: 'legacy', label: '未确认 · 按原样预览' },
                  { value: 'original', label: '一套固定配色' },
                  { value: 'light', label: '只有浅色' },
                  { value: 'dark', label: '只有深色' },
                  { value: 'both-light', label: '浅色 + 深色 · 默认浅色' },
                  { value: 'both-dark', label: '浅色 + 深色 · 默认深色' },
                ]} />
            </div>
            {draft.variants.length > 1 && <button type="button" className="link-btn link-danger remove-implementation" onClick={() => setRemovingFramework(true)}>删除 {info.label} 实现</button>}
            </details>
            <NotesPreview files={variant.files} framework={variant.framework} />
          </div>
          <DeviceWorkspace background={background} onBackgroundChange={setBackground}><div className="panel panel-preview editor-preview">
            <div className="panel-bar">
              <ChoiceControl label="预览内容" value={previewTab} onChange={setPreviewTab}
                options={[{ value: 'live', label: '实时预览' }, { value: 'card', label: '卡片外观' }]} small />
              {previewTab === 'live' && <AppearanceToggle value={appearance} onChange={setComponentTheme} support={themeSupport} />}
              <div className="panel-bar-right">
                {previewTab === 'live' && <DeviceBackground />}
                <button type="button" className="icon-btn" aria-label="重播" title="重播" onClick={() => setReloadKey(k => k + 1)}>
                  <RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
                {previewTab === 'live' && <FullscreenButton active={fullscreen.active} onToggle={fullscreen.toggle} />}
              </div>
            </div>
            {draftPreview.error && <div className="workspace-feedback" role="alert">
              <span><strong>预览未更新</strong>{draftPreview.error}</span>
              <button type="button" className="btn btn-sm btn-quiet" disabled={draftPreview.pending} onClick={draftPreview.retry}>重试</button>
            </div>}
            {previewTab === 'live' ? <>
              <div className="panel-subbar">
                <DeviceTools />
                <DeviceZoom />
              </div>
              <FullscreenFrame fullscreen={fullscreen}>
              <div className={`preview-well preview-well-edit${background === 'dark' ? ' theme-dark' : ''}`}>
                <PreviewLoading busy={draftPreview.pending} />
                {previewUrl
                  ? <DeviceCanvas fullscreen={fullscreen.active} active={editorTab === 'code'}>{(device, onBounds, framing) => <Stage src={previewUrl} title={draft.title || '草稿'} reloadKey={reloadKey} componentTheme={effectiveTheme} theme={background === 'dark' ? 'dark' : 'light'} active={editorTab === 'code'} device={device} framing={framing} onBounds={onBounds} />}</DeviceCanvas>
                  : variant.files.some(f => f.content.trim())
                    ? <div className="stage-host" aria-busy="true"><PreviewLoading /></div>
                    : <p className="preview-empty">填入代码后在这里预览</p>}
              </div>
              </FullscreenFrame>
            </> : (
              <div className="card-look">
                <div className="card-look-sample">
                  <CardSample draft={draft} locale={textLocale} previewUrl={previewUrl} reloadKey={reloadKey} />
                </div>
              </div>
            )}
          </div></DeviceWorkspace>
        </section>

        <section className="panel editor-info" role="tabpanel" id="editor-panel-info" aria-labelledby="editor-tab-info" hidden={editorTab !== 'info'} inert={editorTab !== 'info'}>
          <div className="editor-col editor-col-meta">
            <div className="editor-col-head"><h2>基本信息</h2></div>
            <div className="field-row field-row-even">
            <label className="field">
              <span>默认名称</span>
              <input value={draft.title} onChange={e => set('title', e.target.value)} required maxLength={120} placeholder="Weather Day Switcher" />
            </label>
            <label className="field">
              <span>分类</span>
              {newCategory === null ? (
                <SelectControl label="分类" fullWidth value={draft.categoryId}
                  onValueChange={value => value === '__new' ? setNewCategory('') : set('categoryId', value)}
                  options={[{ value: '', label: '未分类' }, ...categories.map(c => ({ value: c.id, label: c.name })), { value: '__new', label: '新建分类…' }]} />
              ) : (
                <span className="inline-create">
                  <input autoFocus value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="分类名称" maxLength={40}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createCategory(); } if (e.key === 'Escape') setNewCategory(null); }} />
                  <button type="button" className="btn btn-sm" onClick={createCategory}>添加</button>
                  <button type="button" className="icon-btn" aria-label="取消新建分类" onClick={() => setNewCategory(null)}><X size={15} aria-hidden="true" /></button>
                </span>
              )}
            </label>
            </div>
            {!editing && (
              <label className="field">
                <span>ID <small>{playPath(draft.id.trim() || suggestedId || '…')}</small></span>
                <input value={draft.id} onChange={e => set('id', e.target.value.toLowerCase())} placeholder={suggestedId || '留空时按名称生成'} pattern="[a-z0-9][a-z0-9\-]*" maxLength={64} spellCheck={false} className="mono" />
              </label>
            )}
            <div className="field editor-tags-field">
              <span id="tags-label">标签</span>
              <div className="tag-input" role="group" aria-labelledby="tags-label">
                {draft.tags.map(t => (
                  <span key={t} className="tag-static">
                    {t}
                    <button type="button" aria-label={`移除标签 ${t}`} onClick={() => set('tags', draft.tags.filter(x => x !== t))}><X size={11} aria-hidden="true" /></button>
                  </span>
                ))}
                <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addTag(tagInput); }
                    if (e.key === 'Backspace' && !tagInput && draft.tags.length) set('tags', draft.tags.slice(0, -1));
                  }}
                  onBlur={() => addTag(tagInput)} placeholder={draft.tags.length ? '' : '输入后回车'} aria-label="添加标签" />
              </div>
              {tagSuggestions.length > 0 && (
                <div className="tag-suggest" aria-label="已有标签">
                  {tagSuggestions.map(t => (
                    <button key={t.name} type="button" className="tag-chip" onMouseDown={e => e.preventDefault()} onClick={() => addTag(t.name)}>
                      <Plus size={11} strokeWidth={2.4} aria-hidden="true" />{t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="field-row field-row-even">
              <label className="field">
                <span>来源名称</span>
                <input value={draft.sourceName} onChange={e => set('sourceName', e.target.value)} placeholder="作者、网站或项目名称（选填）" />
              </label>
              <label className="field">
                <span>来源地址</span>
                <input value={draft.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://…" type="url" spellCheck={false} />
              </label>
            </div>

          </div>
          <div className="editor-col editor-col-copy">
            <div className="editor-col-head">
              <h2>文案</h2>
              <LanguageControl label="文案语言" value={textLocale} onChange={setTextLocale}
                options={contentLanguages(Object.keys(draft.texts))} />
            </div>
            <label className="field">
              <span>名称 · {localeName(textLocale)}</span>
              <input lang={textLocale} dir="auto" value={text.title ?? ''} onChange={e => setText('title', e.target.value)} maxLength={120} placeholder={draft.title} />
            </label>
            <label className="field editor-summary-field">
              <span>简介</span>
              <textarea lang={textLocale} dir="auto" rows={2} value={text.summary} onChange={e => setText('summary', e.target.value)} />
            </label>
          </div>
          <div className="editor-idea">
            <div className="editor-col-head editor-sub-head">
              <h3>思路</h3>
              <ChoiceControl label="思路版本" value={ideaTheme} onChange={setIdeaTheme} small options={[
                { value: 'original', label: '通用' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]} />
            </div>
            <div className="editor-idea-fields">
            <label className="field">
              <span>参照描述</span>
              <textarea lang={textLocale} dir="auto" rows={2} value={idea.reference} onChange={e => setIdea(composeIdea(e.target.value, idea.details))}
                placeholder={ideaTheme === 'dark' ? '做一个深色的力扣提交热力图卡片。' : '做一个力扣风格的提交热力图卡片。'} />
            </label>
            <label className="field">
              <span>关键差异与交互</span>
              <textarea lang={textLocale} dir="auto" rows={5} value={idea.details} onChange={e => setIdea(composeIdea(idea.reference, e.target.value))}
                placeholder={'按月分块，月份写在下方。\n悬停格子显示日期和提交次数。'} />
            </label>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={fileDialog} onClose={() => setFileDialog(false)} title="添加文件"
        footer={<><button type="button" className="btn btn-quiet" data-close-dialog>取消</button>
          <button type="button" className="btn btn-dark" disabled={!fileName.trim()} onClick={addFile}>添加文件</button></>}>
        <label className="field"><span>文件路径</span>
          <input autoFocus value={fileName} onChange={event => { setFileName(event.target.value); setFileError(''); }}
            placeholder="如 components/Button.tsx" spellCheck={false} aria-invalid={!!fileError}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addFile(); } }} />
        </label>
        {fileError && <p className="form-error" role="alert">{fileError}</p>}
      </Dialog>
      <Dialog open={removingFramework} onClose={() => setRemovingFramework(false)} title={`删除 ${info.label} 实现？`}
        footer={<><button type="button" className="btn btn-quiet" data-close-dialog>取消</button>
          <button type="button" className="btn btn-danger" onClick={removeFramework}>删除实现</button></>}>
        <p>这份实现的全部代码会从草稿中移除，其他框架保留。保存后生效。</p>
      </Dialog>
      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="粘贴代码"
        wide
        footer={
          <>
            <button type="button" className="btn btn-quiet" data-close-dialog>取消</button>
            <button type="button" className="btn btn-dark" onClick={applyPaste} disabled={!pasteText.trim()}>填入表单</button>
          </>
        }
      >
        <p>粘贴 HTML 源码或带 HTML 代码的复刻提示词。能识别的名称、来源和代码会填入表单，保存前可以修改。</p>
        <textarea className="paste-area" aria-label="HTML 代码或复刻提示词" value={pasteText} onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
          placeholder={'<div class="card">…</div>\n<style>…</style>\n<script>…</script>'} spellCheck={false} autoFocus />
        {pasteError && <p className="form-error" role="alert">{pasteError}</p>}
      </Dialog>

      <Dialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.state === 'blocked' && blocker.reset()}
        title="放弃没保存的修改？"
        footer={
          <>
            <button type="button" className="btn btn-quiet" data-close-dialog>继续编辑</button>
            <button type="button" className="btn btn-danger" onClick={() => blocker.state === 'blocked' && blocker.proceed()}>放弃修改</button>
          </>
        }
      >
        <p>离开后，这次对「{draft.title || '素材'}」的修改不会保存。</p>
      </Dialog>
    </form>
  );
}

/** 和浏览页的卡片同样的结构和尺寸，保存前就能看到素材在列表里的样子 */
function CardSample({ draft, locale, previewUrl, reloadKey }: { draft: Draft; locale: string; previewUrl: string | null; reloadKey: number }) {
  const summary = pickText(draft, locale, 'summary');
  return (
    <article className="card card-sample" aria-label="列表卡片预览">
      <div className="card-stage">
        {previewUrl && <FitStage src={previewUrl} title="列表缩略图" viewport={draft.previewViewport} zoom={draft.previewScale}
          active={false} inert reloadKey={reloadKey} />}
      </div>
      <div className="card-meta">
        <span className="card-head">
          <span className="card-title">{draft.title || '未命名素材'}</span>
          <span className="card-fw">{draft.variants.map(v => frameworkInfo(v.framework)?.label).join(' · ')}</span>
        </span>
        {summary && <span className="card-sub">{summary}</span>}
      </div>
      <div className="card-foot">
        <div className="card-tags">
          {draft.tags.slice(0, 3).map(t => <span key={t} className="card-tag">{t}</span>)}
          {draft.tags.length > 3 && <span className="card-more">+{draft.tags.length - 3}</span>}
        </div>
      </div>
    </article>
  );
}

/**
 * 详情页「说明」的内容来自代码注释，这里实时显示当前实现能提取到什么：
 * 以 Icons: / Touch: / Note: 等开头的注释、许可声明，以及 CSS 里的 @motion 参数块。
 */
function NotesPreview({ files, framework }: { files: Draft['variants'][number]['files']; framework: string }) {
  const [open, setOpen] = useState(false);
  const notes = useMemo(() => (open ? codeNotes({ framework, entry: '', dependencies: {}, files }) : null), [open, files, framework]);
  return (
    <details className="notes-preview" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary><span>说明</span><small>许可、备注与动效参数</small></summary>
      {notes && (
        <div className="notes-preview-body">
          {notes.notes.length || notes.motion.length ? (
            <>
              {notes.notes.map(n => <p key={n} className="notes-preview-note">{presentNote(n, 'zh').body}</p>)}
              {notes.motion.map(g => <p key={g.title} className="notes-preview-motion"><strong>{motionLabel(g.title, 'zh')}</strong>{g.params.map(p => motionLabel(p.label, 'zh')).join('、')}</p>)}
            </>
          ) : <p className="muted">还没有可提取的注释。</p>}
          <div className="notes-preview-help">
            <p>想在详情页显示说明，在代码里这样写注释：</p>
            <ul>
              <li><code>{'/* Icons: Heroicons, MIT License */'}</code> 许可、来源</li>
              <li><code>{'/* Touch: No hover on touch screens. | zh: 触屏上没有悬停效果 */'}</code> 使用时要注意的行为，也可以用 Note:；<code>| zh:</code> 后面写中文，详情页切到中文时显示</li>
              <li>CSS 开头的 <code>{'/* @motion … */'}</code> 列出动效参数，值从 :root 里读；参数名同样可以加 <code>| zh: 中文名</code></li>
            </ul>
          </div>
        </div>
      )}
    </details>
  );
}
