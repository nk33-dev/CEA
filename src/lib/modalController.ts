// 来自 frontend 技能的 modal 配方：原生 dialog，关闭动画播完再 close，焦点回到打开前的元素
export interface ModalHandle {
  open(): void;
  close(): void;
  destroy(): void;
}

export function modalController(dialog: HTMLDialogElement, onClosed?: () => void): ModalHandle {
  const events = new AbortController();
  const on = { signal: events.signal };
  let revision = 0, closing = false, disposed = false;
  let opener: HTMLElement | null = null;
  function restoreFocus() {
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
  }
  function open() {
    if (disposed || (dialog.open && !closing)) return;
    revision++; closing = false;
    if (!dialog.open) {
      opener = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
    dialog.classList.remove('is-closing');
    void dialog.offsetWidth;
    dialog.classList.add('is-open');
  }
  function close() {
    if (disposed || !dialog.open || closing) return;
    const own = ++revision;
    closing = true;
    dialog.classList.remove('is-open');
    dialog.classList.add('is-closing');
    Promise.allSettled(dialog.getAnimations().map(animation => animation.finished)).then(() => {
      if (disposed || own !== revision) return;
      closing = false;
      dialog.close();
      dialog.classList.remove('is-closing');
      restoreFocus();
      onClosed?.();
    });
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, on);
  dialog.addEventListener('click', event => {
    if (event.target === dialog || (event.target as Element).closest('[data-close-dialog]')) close();
  }, on);
  dialog.addEventListener('close', () => {
    // close 事件可能在紧接着的 showModal() 之前排队
    if (dialog.open) return;
    revision++; closing = false;
    dialog.classList.remove('is-open', 'is-closing');
    restoreFocus();
  }, on);
  return {
    open, close,
    destroy() {
      disposed = true; revision++;
      events.abort();
      if (dialog.open) { dialog.close(); restoreFocus(); }
      dialog.classList.remove('is-open', 'is-closing');
    },
  };
}
