import Package from 'lucide-react/icons/package';
import type { ResourceFile } from '../../shared/types.ts';
import { uiText, useUi } from '../lib/uiI18n.ts';

export function ResourceList({ files, download, busy = false }: { files?: ResourceFile[]; download?: () => void; busy?: boolean }) {
  useUi();
  if (!files?.length) return null;
  return <div className="resource-files">
    <details>
      <summary>{uiText("资源文件 {{count}}", { count: files.length })}</summary>
      <ul>{files.map(file => <li key={file.path}>
        <span title={file.path}>{file.path}</span>
        <small>{(file.size / 1024).toFixed(file.size < 1024 ? 1 : 0)} KB</small>
      </li>)}</ul>
    </details>
    {download && <button type="button" className="icon-btn icon-btn-sm" disabled={busy} onClick={download}
      aria-label={uiText("下载源码与资源")} title={uiText("下载源码与资源")}>
      <Package size={15} aria-hidden="true" />
    </button>}
  </div>;
}
