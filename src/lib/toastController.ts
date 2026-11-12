// 来自 frontend 技能的 toast 配方：退出动画播完再隐藏，悬停或聚焦时暂停计时，关闭后焦点回到触发处
export interface ToastHandle {
  show(text: string, options?: { duration?: number; focusTarget?: Element | null }): void;
  hide(): void;
  destroy(): void;
}

export function toastController(el: HTMLElement): ToastHandle {
  const message = el.querySelector<HTMLElement>('[data-toast-message]')!;
  const events = new AbortController();
  const on = { signal: events.signal };
  let timer = 0, remaining = 0, deadline = 0, revision = 0, frame = 0, disposed = false;
  let hovered = false;
  let returnFocus: HTMLElement | null = null;
  function pause() {
    if (!deadline) return;
    clearTimeout(timer);
    remaining = Math.max(0, deadline - performance.now());
    deadline = 0;
  }
  function resume() {
    clearTimeout(timer);
    if (disposed || !remaining || hovered || el.contains(document.activeElement) || document.hidden) return;
    deadline = performance.now() + remaining;
    timer = window.setTimeout(hide, remaining);
  }
  function hide() {
    revision++; cancelAnimationFrame(frame); clearTimeout(timer); remaining = 0; deadline = 0;
    if (el.contains(document.activeElement)) {
      if (returnFocus?.isConnected && !returnFocus.closest('[inert]')) returnFocus.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    el.classList.remove('is-open');
  }
  function show(text: string, { duration = 5000, focusTarget = document.activeElement }: { duration?: number; focusTarget?: Element | null } = {}) {
    if (disposed) return;
    const own = ++revision;
    cancelAnimationFrame(frame); clearTimeout(timer);
    if (focusTarget instanceof HTMLElement && !el.contains(focusTarget)) returnFocus = focusTarget;
    el.inert = false;
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
    // 先清空再写入，重复的同一句提示也会被读屏播报
    message.textContent = '';
    frame = requestAnimationFrame(() => {
      if (disposed || own !== revision) return;
      message.textContent = String(text);
    });
    remaining = duration;
    deadline = 0;
    resume();
  }
  el.addEventListener('pointerenter', () => { hovered = true; pause(); }, on);
  el.addEventListener('pointerleave', () => { hovered = false; resume(); }, on);
  el.addEventListener('focusin', pause, on);
  el.addEventListener('focusout', () => queueMicrotask(resume), on);
  el.addEventListener('click', event => { if ((event.target as Element).closest('[data-toast-dismiss]')) hide(); }, on);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); }, on);
  return { show, hide, destroy() { hide(); disposed = true; events.abort(); } };
}
