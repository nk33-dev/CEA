import Minus from 'lucide-react/icons/minus';
import Plus from 'lucide-react/icons/plus';
import Scan from 'lucide-react/icons/scan';
import LocateFixed from 'lucide-react/icons/locate-fixed';
import Hand from 'lucide-react/icons/hand';
import { useState } from 'react';
import { PREVIEW_SCALE_MAX, PREVIEW_SCALE_MIN, previewScale } from '../../shared/preview.ts';

/**
 * 缩放比例。value 为 'fit' 时显示按预览区算出的比例，
 * 加减从当前实际比例开始按 10% 取整，连续点击结果可预期。按钮文字和位置都不随状态变化。
 */
export function ZoomControl({ value, onChange, reset = 1, fitScale, onFit, onCenter, onPan, panning = false, label = '预览缩放' }: {
  value: number | 'fit';
  onChange: (value: number) => void;
  reset?: number;
  fitScale?: number;
  onFit?: () => void;
  onCenter?: () => void;
  onPan?: () => void;
  panning?: boolean;
  label?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const fitting = value === 'fit';
  const current = fitting ? fitScale ?? 1 : value;
  const shown = text ?? String(Math.round(current * 100));
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? Math.floor(current * 10 + 1e-6) / 10 + 0.1 : Math.ceil(current * 10 - 1e-6) / 10 - 0.1;
    onChange(previewScale(next));
  };
  return <div className="zoom-control" role="group" aria-label={label}>
    <button type="button" className="icon-btn icon-btn-sm" aria-label="缩小预览" title="缩小预览"
      disabled={current <= PREVIEW_SCALE_MIN} onClick={() => step(-1)}><Minus size={14} /></button>
    <label className="zoom-value">
      <input aria-label="缩放比例" title="缩放比例" type="number" min={fitting ? Math.min(25, Math.round(current * 100)) : 25} max="300" step="1" value={shown}
        style={{ width: `${Math.max(shown.length, 1) + 0.4}ch` }}
        onChange={e => {
          setText(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && n >= 25 && n <= 300) onChange(previewScale(n / 100));
        }}
        onBlur={e => {
          const n = e.target.valueAsNumber;
          setText(null);
          if (Number.isFinite(n)) onChange(previewScale(n / 100));
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        }} />
      <span aria-hidden="true">%</span>
    </label>
    <button type="button" className="icon-btn icon-btn-sm" aria-label="放大预览" title="放大预览"
      disabled={current >= PREVIEW_SCALE_MAX} onClick={() => step(1)}><Plus size={14} /></button>
    {onPan && <button type="button" className="icon-btn icon-btn-sm" aria-label="移动画布" aria-pressed={panning} title={panning ? '停止移动，操作组件' : '拖动移动画布'} onClick={onPan}><Hand size={15} /></button>}
    {onCenter && <button type="button" className="icon-btn icon-btn-sm" aria-label="回到中央" title="回到中央，保留缩放比例" onClick={onCenter}><LocateFixed size={15} /></button>}
    {onFit
      ? <button type="button" className="icon-btn icon-btn-sm" aria-label="完整显示" title="完整显示并居中" onClick={onFit}><Scan size={15} /></button>
      : <button type="button" className="icon-btn icon-btn-sm" aria-label="还原预览缩放" title={`还原为 ${Math.round(reset * 100)}%`}
        onClick={() => onChange(reset)}><Scan size={14} /></button>}
  </div>;
}
