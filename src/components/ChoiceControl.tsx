import { useId, type ReactNode } from 'react';
import { SelectionIndicator } from './SelectionIndicator.tsx';
import { uiText, useUi } from '../lib/uiI18n.ts';

export function ChoiceControl<Value extends string>({ label, value, onChange, options, disabled, tabs, small, list }: {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: readonly { value: Value; label: ReactNode; ariaLabel?: string; hint?: string; disabled?: boolean }[];
  disabled?: boolean;
  tabs?: boolean;
  small?: boolean;
  list?: boolean;
}) {
  useUi();
  const name = useId();
  return (
    <div className={`choice-control ${list ? 'choice-list' : tabs ? 'choice-tabs' : `seg${small ? ' seg-sm' : ''}`}`} role="radiogroup" aria-label={label}>
      {!list && <SelectionIndicator value={value} itemsKey={options.map(option => option.value).join('\0')} underline={tabs} selector=".choice-option:has(input:checked)" />}
      {options.map(option => (
        <label key={option.value} className="choice-option" title={option.hint} data-selection-item>
          <input type="radio" name={name} value={option.value} checked={value === option.value} aria-label={option.ariaLabel} aria-description={option.hint}
            disabled={disabled || option.disabled} onChange={() => onChange(option.value)} />
          <span>{typeof option.label === 'string' ? uiText(option.label) : option.label}</span>
        </label>
      ))}
    </div>
  );
}
