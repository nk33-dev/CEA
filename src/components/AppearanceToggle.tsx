import { uiText, useUi } from '../lib/uiI18n.ts';
import Moon from 'lucide-react/icons/moon';
import Sun from 'lucide-react/icons/sun';
import { ChoiceControl } from './ChoiceControl.tsx';
import type { ThemeSupport } from '../../shared/theme.ts';

export type Appearance = 'light' | 'dark';

export function PreviewBackgroundToggle({ value, onChange }: { value: Appearance; onChange: (value: Appearance) => void }) {
  useUi();
  return <span className="preview-background-toggle">
    <span className="preview-scope">{uiText("背景")}</span>
    <ChoiceControl label={uiText("舞台背景")} value={value} onChange={onChange} small options={[
      { value: 'light', label: <Sun size={14} aria-hidden="true" />, ariaLabel: uiText("浅色"), hint: uiText("浅色预览背景") },
      { value: 'dark', label: <Moon size={14} aria-hidden="true" />, ariaLabel: uiText("深色"), hint: uiText("深色预览背景") },
    ]} />
  </span>;
}

/**
 * 只切换已声明的组件双主题；舞台背景由独立的预览控件管理。
 */
export function AppearanceToggle({ value, onChange, support }: { value: Appearance; onChange: (value: Appearance) => void; support: ThemeSupport }) {
  useUi();
  if (support.source !== 'declared' || support.mode !== 'both') return null;
  return <span className="appearance-toggle">
    <span className="preview-scope">{uiText("组件")}</span>
    <ChoiceControl label={uiText("组件主题")} value={value} onChange={onChange} small options={[
      { value: 'light', label: <><Sun size={13} aria-hidden="true" />{uiText("浅色")}</> },
      { value: 'dark', label: <><Moon size={13} aria-hidden="true" />{uiText("深色")}</> },
    ]} />
  </span>;
}
