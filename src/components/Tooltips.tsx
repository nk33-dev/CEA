import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 全站统一的按钮提示，替代浏览器原生 title（要停一秒左右才出现，样式也改不了）。
 * 元素上照常写 title：悬停 300ms 或键盘聚焦时显示；已经有提示时移到相邻按钮立即切换。
 * 显示期间把 title 暂存到 data-tip，避免和原生提示叠在一起；离开后还原。
 */
const SHOW_DELAY = 300;
const SWITCH_WINDOW = 400;

interface Tip { text: string; x: number; y: number; below: boolean }

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!tip || !element.current) return;
    element.current.style.left = `${tip.x}px`;
    const box = element.current.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const shift = box.left < 8 ? 8 - box.left : box.right > width - 8 ? width - 8 - box.right : 0;
    element.current.style.left = `${tip.x + shift}px`;
  }, [tip]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = 0;
    const restore = () => {
      if (target?.dataset.tip !== undefined) {
        target.setAttribute('title', target.dataset.tip);
        delete target.dataset.tip;
      }
    };
    const hide = () => {
      clearTimeout(timer);
      if (target) hiddenAt = performance.now();
      restore();
      target = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip ?? el.getAttribute('title') ?? '';
      if (!text || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 48;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const enter = (el: HTMLElement, immediate: boolean) => {
      if (el === target) return;
      hide();
      target = el;
      el.dataset.tip = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      const fast = immediate || performance.now() - hiddenAt < SWITCH_WINDOW;
      timer = setTimeout(() => show(el), fast ? 0 : SHOW_DELAY);
    };
    const find = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('[title], [data-tip]') : null);
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e.target);
      // iframe 里的元素不在这里处理；离开有提示的元素就收起
      if (el && !el.closest('iframe')) enter(el, false);
      else if (target) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && (e.target as Element).matches(':focus-visible')) enter(el, true);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', key);
    document.addEventListener('pointerout', leave);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerout', leave);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip) return null;
  return createPortal(
    <div ref={element} className={`tooltip${tip.below ? ' is-below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>,
    document.body,
  );
}
