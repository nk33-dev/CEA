import { uiText, useUi } from '../lib/uiI18n.ts';
import Minus from 'lucide-react/icons/minus';
import Plus from 'lucide-react/icons/plus';
import Shrink from 'lucide-react/icons/shrink';
import LocateFixed from 'lucide-react/icons/locate-fixed';
import Hand from 'lucide-react/icons/hand';
import { useRef, useState } from 'react';
import { PREVIEW_SCALE_MAX, PREVIEW_SCALE_MIN, previewScale } from '../../shared/preview.ts';
import { SelectControl } from './SelectControl.tsx';

/**
 * 缩放比例。value 为 'fit' 时显示按预览区算出的比例，
 * 加减从当前实际比例开始按 10% 取整，连续点击结果可预期。按钮文字和位置都不随状态变化。
 */
export function ZoomControl({ value, onChange, reset = 1, fitScale, onFit, onCenter, onPan, panning = false, label = uiText("预览缩放") }: {
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
  useUi();
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);
  const fitting = value === 'fit';
  const current = fitting ? fitScale ?? 1 : value;
  const shown = text ?? String(Math.round(current * 100));
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? Math.floor(current * 10 + 1e-6) / 10 + 0.1 : Math.ceil(current * 10 - 1e-6) / 10 - 0.1;
    onChange(previewScale(next));
  };
  return <div className="preview-view-actions">
    <div className="zoom-control" role="group" aria-label={label}>
    <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("缩小预览")} title={uiText("缩小预览")}
      disabled={current <= PREVIEW_SCALE_MIN} onClick={() => step(-1)}><Minus size={14} /></button>
    <div className="zoom-value">
      <input aria-label={uiText("缩放比例")} title={uiText("缩放比例")} type="number" min={fitting ? Math.min(25, Math.round(current * 100)) : 25} max="300" step="1" value={shown}
        onChange={e => setText(e.target.value)}
        onBlur={e => {
          const n = e.target.valueAsNumber;
          setText(null);
          if (!cancelled.current && text !== null && Number.isFinite(n)) onChange(previewScale(n / 100));
          cancelled.current = false;
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; e.currentTarget.blur(); }
        }} />
    <SelectControl iconOnly icon={<span>%</span>} label={uiText("缩放预设")} value={fitting ? 'fit' : String(Math.round(current * 100))}
      onValueChange={value => { setText(null); if (value === 'fit') onFit?.(); else onChange(Number(value) / 100); }}
      options={[
        ...(onFit ? [{ value: 'fit', label: uiText("适应预览区") }] : []),
        ...[25, 50, 75, 100, 125, 150, 200, 300].map(n => ({ value: String(n), label: `${n}%`, separated: n === 25 && !!onFit })),
      ]} />
    </div>
    <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("放大预览")} title={uiText("放大预览")}
      disabled={current >= PREVIEW_SCALE_MAX} onClick={() => step(1)}><Plus size={14} /></button>
    {onFit
      ? <button type="button" className="preview-fit" aria-label={uiText("完整显示")} title={uiText("适应预览区，完整显示并居中")} onClick={() => { setText(null); onFit(); }}><Shrink size={14} />{uiText("适应")}</button>
      : <button type="button" className="preview-fit" aria-label={uiText("还原预览缩放")} title={uiText("还原为 {{value0}}%", {value0: Math.round(reset * 100)})}
        onClick={() => { setText(null); onChange(reset); }}><Shrink size={14} /></button>}
    </div>
    {(onPan || onCenter) && <div className="canvas-navigation" role="group" aria-label={uiText("画布移动")}>
      {onPan && <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("移动画布")} aria-pressed={panning} title={panning ? uiText("停止移动，操作组件") : uiText("拖动移动画布")} onClick={onPan}><Hand size={15} /></button>}
      {onCenter && <button type="button" className="icon-btn icon-btn-sm" aria-label={uiText("回到中央")} title={uiText("回到中央，保留缩放比例")} onClick={onCenter}><LocateFixed size={15} /></button>}
    </div>}
  </div>;
}
