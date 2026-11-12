import { useLayoutEffect, useRef } from 'react';
import { createSelectionMotion } from '../lib/selectionMotion.ts';

export function SelectionIndicator({ value, itemsKey, underline = false, selector = '[aria-selected="true"]' }: {
  value: string;
  itemsKey?: string;
  underline?: boolean;
  selector?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const measure = useRef<(animate: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const element = ref.current!;
    const host = element.parentElement!;
    const motion = createSelectionMotion(element, host);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (animate: boolean) => {
      const target = host.querySelector<HTMLElement>(selector);
      if (!target || !target.offsetWidth || !target.offsetHeight) {
        motion.reset();
        return;
      }
      const rect = target.getBoundingClientRect();
      const parent = host.getBoundingClientRect();
      motion.move({
        x: rect.left - parent.left - host.clientLeft,
        y: rect.top - parent.top - host.clientTop + (underline ? rect.height - 2 : 0),
        width: rect.width,
        height: underline ? 2 : rect.height,
      }, animate, media.matches);
    };
    measure.current = update;
    update(false);
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(false));
    });
    resize.observe(host);
    host.querySelectorAll<HTMLElement>('[data-selection-item]').forEach(item => resize.observe(item));
    const reduce = () => { motion.finish(); update(false); };
    media.addEventListener('change', reduce);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      media.removeEventListener('change', reduce);
      motion.destroy();
      measure.current = () => {};
    };
  }, [selector, underline, itemsKey]);

  useLayoutEffect(() => { measure.current(true); }, [value]);

  return <span ref={ref} className={`selection-indicator${underline ? ' is-underline' : ''}`} hidden aria-hidden="true" />;
}
