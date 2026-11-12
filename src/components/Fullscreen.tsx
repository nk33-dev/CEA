import { useEffect, useRef, useState, type ReactNode } from 'react';
import Maximize2 from 'lucide-react/icons/maximize-2';
import Minimize2 from 'lucide-react/icons/minimize-2';

/**
 * 临时全屏看预览：画面占满整个屏幕，按真实窗口大小排版，像在新标签页里打开一样。
 * 用浏览器全屏 API，Esc 或再点一次按钮退出；浏览器不允许全屏时退化为铺满窗口。
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === ref.current && !!ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!active || document.fullscreenElement) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [active]);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (active) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else setActive(false);
      return;
    }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setActive(true));
    else setActive(true);
  };
  return { ref, active, toggle };
}

export function FullscreenButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const label = active ? '退出全屏' : '全屏预览';
  return <button type="button" className="icon-btn" aria-label={label} title={active ? '退出全屏（Esc）' : '全屏预览'} aria-pressed={active} onClick={onToggle}>
    {active ? <Minimize2 size={16} strokeWidth={1.8} aria-hidden="true" /> : <Maximize2 size={16} strokeWidth={1.8} aria-hidden="true" />}
  </button>;
}

/** 全屏时的外层：只保留画面和一个退出按钮 */
export function FullscreenFrame({ fullscreen, children }: { fullscreen: ReturnType<typeof useFullscreen<HTMLDivElement>>; children: ReactNode }) {
  return <div ref={fullscreen.ref} className={`fullscreen-frame${fullscreen.active ? ' is-active' : ''}`}>
    {fullscreen.active && <div className="fullscreen-exit"><FullscreenButton active onToggle={fullscreen.toggle} /></div>}
    {children}
  </div>;
}
