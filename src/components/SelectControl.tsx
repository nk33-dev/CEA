import { useRef, useState, type ReactNode } from 'react';
import * as Select from '@radix-ui/react-select';
import Check from 'lucide-react/icons/check';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** 选项右侧的弱化标记，例如「原有」，不进入触发器显示的文字 */
  note?: string;
  /** 在这一项前面加分隔线，用于和尺寸列表性质不同的操作 */
  separated?: boolean;
}

export function SelectControl({ value, onValueChange, options, label, placeholder = '请选择', disabled, fullWidth, filter, icon, align, iconOnly }: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  filter?: boolean;
  icon?: ReactNode;
  align?: 'start' | 'end';
  iconOnly?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const fullscreenOwner = useRef<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement>();
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer');
  const index = options.findIndex(option => option.value === value);
  return (
    <Select.Root value={index < 0 ? '' : String(index)} disabled={disabled}
      onValueChange={next => { const option = options[Number(next)]; if (option) onValueChange(option.value); }}
      onOpenChange={open => {
        // 原生 dialog 外的 Portal 会被浏览器设为不可交互。
        if (open) {
          fullscreenOwner.current = trigger.current?.closest<HTMLElement>('.fullscreen-frame.is-active') ?? null;
          setContainer(trigger.current?.closest('dialog') ?? fullscreenOwner.current ??
            (document.fullscreenElement as HTMLElement | null) ?? document.body);
        }
      }}>
      <Select.Trigger ref={trigger} className={`cea-select-trigger${fullWidth ? ' is-full' : ''}${filter ? ' is-filter' : ''}${iconOnly ? ' is-icon-only' : ''}`} aria-label={label} title={label}
        onPointerDown={() => setInputMode('pointer')} onKeyDown={() => setInputMode('keyboard')}>
        {icon && <span className="cea-select-leading" aria-hidden="true">{icon}</span>}
        {iconOnly ? <span hidden><Select.Value placeholder={placeholder} /></span> : <Select.Value placeholder={placeholder} />}
        <Select.Icon className="cea-select-chevron"><ChevronDown size={14} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal container={container}>
        <Select.Content className={`option-surface cea-select-content${filter ? ' is-filter' : ''}`} position="popper" sideOffset={6} collisionPadding={12} align={align ?? (filter ? 'end' : 'start')}
          onCloseAutoFocus={event => {
            // 下拉的退出动画可能晚于全屏退出，不能再抢回焦点。
            if (fullscreenOwner.current && !fullscreenOwner.current.classList.contains('is-active')) event.preventDefault();
            fullscreenOwner.current = null;
          }}
          data-input={inputMode} onKeyDownCapture={() => setInputMode('keyboard')} onPointerMoveCapture={() => setInputMode('pointer')}>
          <Select.ScrollUpButton className="cea-select-scroll"><ChevronUp size={14} aria-hidden="true" /></Select.ScrollUpButton>
          <Select.Viewport className="cea-select-viewport">
            {options.map((option, i) => [
              option.separated && <Select.Separator key={`${option.value}-sep`} className="cea-select-separator" />,
              <Select.Item className="option-row cea-select-item" key={option.value} value={String(i)} disabled={option.disabled} textValue={option.label}>
                <Select.ItemText>{option.label}</Select.ItemText>
                {option.note && <span className="cea-select-note">{option.note}</span>}
                <Select.ItemIndicator className="cea-select-check"><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
              </Select.Item>,
            ])}
          </Select.Viewport>
          <Select.ScrollDownButton className="cea-select-scroll"><ChevronDown size={14} aria-hidden="true" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
