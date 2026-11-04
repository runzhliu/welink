import { useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { Popover } from './Popover';
import type { SelectOption } from './Select';

interface ComboBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'list'> {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
}

/** Editable suggestions: custom model names remain valid. */
export function ComboBox({ value, onValueChange, options, className = '', onKeyDown, ...props }: ComboBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const visible = options.filter(option => !option.disabled && `${option.label} ${option.value}`.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  const choose = (text: string) => { onValueChange(text); setOpen(false); setActive(-1); inputRef.current?.focus(); };
  return <>
    <input {...props} ref={inputRef} value={value} className={`ui-combobox ${className}`} autoComplete="off" role="combobox" aria-expanded={open && visible.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && visible[active] ? `${listId}-${active}` : undefined} data-popup-open={(open && visible.length > 0) || undefined}
      onFocus={event => { setOpen(true); props.onFocus?.(event); }} onClick={() => setOpen(true)}
      onChange={event => { onValueChange(event.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(index => visible.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length : -1);
        } else if (event.key === 'Enter' && open && visible[active]) {
          event.preventDefault(); choose(visible[active].value);
        } else if (event.key === 'Tab') setOpen(false);
      }} />
    <Popover open={open && !props.disabled && visible.length > 0} anchorRef={inputRef} onClose={() => setOpen(false)} className="ui-select-menu">
      <div id={listId} role="listbox" aria-label={props['aria-label'] || '推荐选项'} className="ui-option-list">
        {visible.map((option, index) => <div id={`${listId}-${index}`} key={option.value} role="option" aria-selected={option.value === value} data-active={index === active} className="ui-option" onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}>
          <span className="min-w-0 flex-1"><span className="block break-words">{option.value}</span>{option.label !== option.value && <span className="block text-xs opacity-70">{option.label}</span>}</span>{option.value === value && <Check size={14} />}
        </div>)}
      </div>
    </Popover>
  </>;
}
