import { uiText, useUi } from '../lib/uiI18n.ts';
import { useEffect, useRef, useState } from 'react';
import Check from 'lucide-react/icons/check';
import Copy from 'lucide-react/icons/copy';
import { copyText } from '../lib/clipboard.ts';
import { useLibrary } from '../lib/store.tsx';

/** 复制按钮：成功后图标换成对勾 1.6 秒，失败时给出提示 */
export function CopyButton({ text, label, className = 'btn', icon = true }: { text: () => string; label: string; className?: string; icon?: boolean }) {
  useUi();
  label = uiText(label);
  const { notify } = useLibrary();
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await copyText(text());
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify(uiText("没能写入剪贴板，可以手动选中文字复制"));
    }
  };

  return (
    <button type="button" className={`${className}${copied ? ' is-copied' : ''}`} onClick={copy} title={copied ? uiText("已复制") : label} aria-label={copied ? uiText("已复制") : label}>
      {icon && (
        <span className="copy-icon" aria-hidden="true">
          <Copy size={15} strokeWidth={1.8} className="copy-icon-a" />
          <Check size={15} strokeWidth={2.2} className="copy-icon-b" />
        </span>
      )}
      <span className="copy-label">
        <span className="copy-label-size" aria-hidden="true">{label}</span>
        <span className="copy-label-size" aria-hidden="true">{uiText("已复制")}</span>
        <span>{copied ? uiText("已复制") : label}</span>
      </span>
    </button>
  );
}
