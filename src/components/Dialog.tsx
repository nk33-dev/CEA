import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import X from 'lucide-react/icons/x';
import { modalController, type ModalHandle } from '../lib/modalController.ts';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
  /** 进行中的操作不允许关闭 */
  locked?: boolean;
}

export function Dialog({ open, onClose, title, children, footer, wide, locked, className }: DialogProps) {
  useUi();
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const handle = useRef<ModalHandle | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const dialog = ref.current!;
    handle.current = modalController(dialog, () => onCloseRef.current());
    const guard = (e: Event) => {
      if (lockedRef.current) e.stopImmediatePropagation();
    };
    dialog.addEventListener('cancel', guard, { capture: true });
    dialog.addEventListener('click', guard, { capture: true });
    return () => {
      dialog.removeEventListener('cancel', guard, { capture: true });
      dialog.removeEventListener('click', guard, { capture: true });
      handle.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (open) handle.current?.open();
    else handle.current?.close();
  }, [open]);

  return (
    <dialog ref={ref} className={`t-modal dialog${wide ? ' dialog-wide' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={titleId}>
      <div className="dialog-body">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" data-close-dialog aria-label={uiText("关闭")} disabled={locked}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog-content">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
