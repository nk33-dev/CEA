import { uiText, useUi } from '../lib/uiI18n.ts';
import { contentLanguages, type LocaleOption } from '../../shared/locales.ts';
import { ChoiceControl } from './ChoiceControl.tsx';
import { SelectControl } from './SelectControl.tsx';

export function LanguageControl({ value, onChange, label = uiText("内容语言"), options = contentLanguages([value]) }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  options?: LocaleOption[];
}) {
  useUi();
  const choices = options.map(option => ({ value: option.id, label: option.label }));
  return choices.length <= 3
    ? <ChoiceControl label={label} value={value} onChange={onChange} options={choices} small />
    : <SelectControl label={label} value={value} onValueChange={onChange} options={options.map(option => ({ value: option.id, label: option.name }))} />;
}
