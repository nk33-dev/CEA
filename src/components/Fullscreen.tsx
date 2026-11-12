import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Maximize2 from 'lucide-react/icons/maximize-2';
import Minimize2 from 'lucide-react/icons/minimize-2';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';

/**
 * 组件按全屏视口排版，常规视图的倍率和设备选择由工作区独立保留。
 * 用浏览器全屏 API，Esc 或再点一次按钮退出；浏览器不允许全屏时退化为铺满窗口。
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === ref.current && !!ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!active || document.fullscreenElement) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const editing = e.target instanceof Element && !!e.target.closest('input,textarea,[contenteditable=true]');
      const overlay = ref.current?.querySelector('dialog[open],[role=listbox][data-state=open],[role=menu][data-state=open]');
      if (!overlay && (!e.defaultPrevented || !editing)) setActive(false);
    };
    const receive = (e: MessageEvent) => {
      if (e.data?.type === 'cea:escape' && [...ref.current?.querySelectorAll('iframe') ?? []].some(frame => frame.contentWindow === e.source)) setActive(false);
    };
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    for (let node: HTMLElement | null = ref.current; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement) {
        siblings.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    window.addEventListener('keydown', close);
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('message', receive);
      siblings.forEach(({ element, inert }) => { element.inert = inert; });
    };
  }, [active]);
  useEffect(() => {
    const el = ref.current;
    return () => { if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!active && opener.current) {
      if (opener.current.isConnected) opener.current.focus({ preventScroll: true });
      opener.current = null;
    }
  }, [active]);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (active) {
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => setActive(false));
      else setActive(false);
      return;
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setActive(true));
    else setActive(true);
  };
  return { ref, active, toggle };
}

export function FullscreenButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  useUi();
  const label = active ? uiText("退出全屏") : uiText("全屏预览");
  return <button type="button" className="preview-fullscreen" aria-label={label} title={active ? uiText("退出全屏（Esc）") : uiText("全屏预览")} aria-pressed={active} onClick={onToggle}>
    {active ? <Minimize2 size={16} strokeWidth={1.8} aria-hidden="true" /> : <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true" />}
    <span>{active ? uiText("退出全屏") : uiText("全屏")}</span>
  </button>;
}

/** 工具栏和画布一起进入全屏，iframe 保持原位置和实例。 */
export function FullscreenFrame({ fullscreen, children }: { fullscreen: ReturnType<typeof useFullscreen<HTMLDivElement>>; children: ReactNode }) {
  useUi();
  const [tools, setTools] = useState(false);
  const id = useId();
  useEffect(() => { setTools(false); }, [fullscreen.active]);
  return <div ref={fullscreen.ref} id={id} className={`fullscreen-frame${fullscreen.active ? ' is-active' : ''}${tools ? ' tools-open' : ''}`}>
    {children}
    {fullscreen.active && <div className="fullscreen-dock">
      <button type="button" className="icon-btn" aria-label={tools ? uiText("收起预览工具") : uiText("展开预览工具")} title={tools ? uiText("收起预览工具") : uiText("展开预览工具")}
        aria-expanded={tools} aria-controls={id} onClick={() => setTools(value => !value)}><SlidersHorizontal size={17} /></button>
      <button type="button" className="icon-btn" aria-label={uiText("退出全屏")} title={uiText("退出全屏（Esc）")} onClick={fullscreen.toggle}><Minimize2 size={17} /></button>
    </div>}
  </div>;
}
