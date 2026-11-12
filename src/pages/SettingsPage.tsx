import { uiText, useUi } from '../lib/uiI18n.ts';
import { useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import Check from 'lucide-react/icons/check';
import Copy from 'lucide-react/icons/copy';
import Download from 'lucide-react/icons/download';
import ExternalLink from 'lucide-react/icons/external-link';
import FolderOpen from 'lucide-react/icons/folder-open';
import Library from 'lucide-react/icons/library';
import Upload from 'lucide-react/icons/upload';
import X from 'lucide-react/icons/x';
import { FRAMEWORKS } from '../../shared/frameworks.ts';
import { FolderPicker } from '../components/FolderPicker.tsx';
import { ChoiceControl } from '../components/ChoiceControl.tsx';
import { LanguageControl } from '../components/LanguageControl.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { PREF_FRAMEWORK, useContentLocale, usePref } from '../lib/prefs.ts';
import { useLibrary } from '../lib/store.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { parseConfiguration, type Configuration } from '../../shared/configuration.ts';
import { downloadConfiguration, importConfiguration } from '../lib/configuration.ts';
import { useDeviceSettings } from '../lib/deviceSettings.ts';

export function SettingsPage() {
  useUi();
  const { info, categories, tags, refresh, notify } = useLibrary();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [framework, setFramework] = usePref(PREF_FRAMEWORK, FRAMEWORKS[0].id);
  const [locale, setLocale] = useContentLocale();
  const [deviceSettings] = useDeviceSettings();
  const configFile = useRef<HTMLInputElement>(null);
  const [pendingConfig, setPendingConfig] = useState<Configuration | null>(null);
  const [configError, setConfigError] = useState('');
  const [readingConfig, setReadingConfig] = useState(false);
  const location = useLocation();
  if (location.hash === '#tags' || location.hash === '#categories') return <Navigate to={`/organize${location.hash === '#categories' ? '?tab=categories' : ''}`} replace />;

  const copy = async (text: string) => {
    try { await copyText(text); setCopied(text); setTimeout(() => setCopied(''), 1600); }
    catch (e) { notify(errorMessage(e)); }
  };
  const open = async (path?: string) => {
    try { await api.reveal(path); } catch (e) { notify(errorMessage(e)); }
  };
  const switchTo = async (path: string) => {
    setBusy(true);
    try {
      const next = await api.switchLibrary(path);
      await refresh();
      notify(uiText("已切换到 {{value0}}", {value0: next.path}));
    } catch (e) { notify(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const forget = async (path: string) => {
    try { await api.forgetRecent(path); await refresh(); } catch (e) { notify(errorMessage(e)); }
  };
  const readConfigFile = async (file?: File) => {
    if (!file) return;
    setReadingConfig(true);
    setConfigError('');
    try {
      if (file.size > 256 * 1024) throw new Error(uiText("配置文件不能超过 256 KB"));
      setPendingConfig(parseConfiguration(await file.text()));
    } catch (e) { setConfigError(errorMessage(e)); }
    finally { setReadingConfig(false); }
  };

  return <div className="workspace workspace-admin settings">
    <header className="workspace-head"><div><h1>{uiText("设置")}</h1></div></header>

    <div className="settings-layout">
    <section className="settings-section settings-library-section" aria-labelledby="lib-title">
      <div className="settings-heading"><h2 id="lib-title">{uiText("素材库")}</h2><p className="muted">{uiText("组件与项目独立保存。")}</p></div>
      <div className="settings-content">
        <div className="settings-library">
          <div className="lib-card">
            <Library size={18} aria-hidden="true" />
            <div className="lib-card-main">
              <code>{info?.path}</code>
              <span>{info?.assetCount ?? 0}{uiText(" 个组件 · ")}{categories.length}{uiText(" 个分类 · ")}{tags.length}{uiText(" 个标签")}</span>
            </div>
            <button type="button" className="icon-btn icon-btn-sm" title={uiText("复制路径")} aria-label={uiText("复制路径")} onClick={() => void copy(info?.path ?? '')}>{copied && copied === info?.path ? <Check size={15} /> : <Copy size={15} />}</button>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-sm" onClick={() => void open()}><ExternalLink size={14} />{uiText("打开素材文件夹")}</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPicking(true)}><FolderOpen size={14} />{busy ? uiText("正在切换…") : uiText("切换素材库")}</button>
          </div>
        </div>
        {!!info?.recent?.length && <div className="recent">
          <h3>{uiText("最近打开")}</h3>
          <ul>{info.recent.map(r => <li key={r.path} className={r.available ? '' : 'is-missing'}>
            <button type="button" className="recent-open" disabled={!r.available || busy} onClick={() => void switchTo(r.path)} title={r.available ? uiText("切换到 {{value0}}", {value0: r.path}) : uiText("文件夹已移动或删除")}>
              <code>{r.path}</code>{!r.available && <small>{uiText("已移动或删除")}</small>}
            </button>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("从列表移除 {{value0}}", {value0: r.path})} title={uiText("从列表移除")} onClick={() => void forget(r.path)}><X size={14} /></button>
          </li>)}</ul>
        </div>}
        {info?.configDir && <p className="settings-foot">{uiText("换电脑后需重新选择素材库。")}<button type="button" className="text-link" onClick={() => void open(info.configDir)}>{uiText("打开配置文件夹")}<ExternalLink size={12} aria-hidden="true" /></button></p>}
      </div>
    </section>

    <section className="settings-section" aria-labelledby="pref-title">
      <div className="settings-heading"><h2 id="pref-title">{uiText("打开组件时")}</h2><p className="muted">{uiText("自动记住框架和内容语言。")}</p></div>
      <div className="settings-content settings-preferences">
        <div className="settings-row">
          <span className="settings-row-label">{uiText("默认框架")}</span>
          <ChoiceControl label={uiText("默认框架")} value={framework} onChange={setFramework} options={FRAMEWORKS.map(f => ({ value: f.id, label: f.label }))} small />
        </div>
        <div className="settings-row">
          <span className="settings-row-label">{uiText("内容语言")}</span>
          <LanguageControl value={locale} onChange={setLocale} />
        </div>
      </div>
    </section>

    <section className="settings-section" aria-labelledby="config-title">
      <div className="settings-heading"><h2 id="config-title">{uiText("配置迁移")}</h2><p className="muted">{uiText("迁移尺寸预设与偏好，不含组件、草稿和本机路径。")}</p></div>
      <div className="settings-content">
        <div className="settings-row settings-config">
          <div className="settings-config-file">
            <code>cea-settings.json</code>
            {deviceSettings.presets.length > 0 && <span>{deviceSettings.presets.length}{uiText(" 个自定义尺寸预设")}</span>}
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-sm" onClick={() => {
              try { downloadConfiguration(); setConfigError(''); }
              catch (e) { setConfigError(errorMessage(e)); }
            }}><Download size={14} />{uiText("导出配置")}</button>
            <button type="button" className="btn btn-sm" disabled={readingConfig} onClick={() => configFile.current?.click()}><Upload size={14} />{readingConfig ? uiText("读取中…") : uiText("导入配置")}</button>
            <input ref={configFile} type="file" accept=".json,application/json" hidden onChange={e => {
              void readConfigFile(e.target.files?.[0]); e.target.value = '';
            }} />
          </div>
        </div>
        {configError && <p className="form-error" role="alert">{configError}</p>}
      </div>
    </section>
    </div>

    <Dialog open={!!pendingConfig} onClose={() => setPendingConfig(null)} title={uiText("导入配置")}
      footer={<><button type="button" className="btn btn-quiet" data-close-dialog>{uiText("取消")}</button><button type="button" className="btn btn-dark" onClick={() => {
        if (!pendingConfig) return;
        try {
          importConfiguration(JSON.stringify(pendingConfig));
          setPendingConfig(null);
          setConfigError('');
          notify(uiText("配置已导入"));
        } catch (e) { setConfigError(uiText("配置没有导入：{{value0}}", {value0: errorMessage(e)})); }
      }}>{uiText("应用配置")}</button></>}>
      <p>{uiText("将替换当前界面偏好和尺寸预设，包含 ")}{pendingConfig?.devices.presets.length ?? 0}{uiText(" 个自定义预设。素材与草稿保持不变。")}</p>
      {configError && <p className="form-error" role="alert">{configError}</p>}
    </Dialog>
    <FolderPicker open={picking} onClose={() => setPicking(false)} title={uiText("切换素材库")} start={info?.path} confirm={uiText("切换到这里")}
      check={l => l.path.toLowerCase() === info?.path.toLowerCase() ? uiText("正在使用这个素材库")
        : l.kind === 'occupied' ? uiText("这个文件夹里有别的文件。选一个素材库，或一个空文件夹新建素材库")
        : null}
      onPick={path => void switchTo(path)} />
  </div>;
}
