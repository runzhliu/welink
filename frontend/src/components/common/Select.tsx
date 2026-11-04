import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from './Popover';

export interface SelectOption { value: string; label: string; disabled?: boolean; group?: string }

function labelText(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? labelText(child.props.children) : String(child)).join('');
}

/** Accept option descriptions as JSX, but render only WeLink controls. */
export function selectOptions(children: ReactNode, group?: string): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>(child)) return;
    if (child.type === Fragment || child.type === 'optgroup') {
      options.push(...selectOptions(child.props.children, child.props.label ?? group));
    } else if (child.type === 'option') {
      const label = labelText(child.props.children).trim() || String(child.props.value ?? '');
      options.push({ value: String(child.props.value ?? label), label, disabled: child.props.disabled, group });
    }
  });
  return options;
}

interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'> {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  options?: SelectOption[];
  name?: string;
  placeholder?: string;
}

export function Select({ value, defaultValue, onValueChange, children, options: suppliedOptions, className = '', disabled, name, placeholder = '请选择', onKeyDown, ...props }: SelectProps) {
  const options = useMemo(() => suppliedOptions ?? selectOptions(children), [suppliedOptions, children]);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? options[0]?.value ?? ''));
  const currentValue = String(value ?? internalValue);
  const selected = options.find(option => option.value === currentValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(currentValue);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const visible = options.filter(option => !query || `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const enabled = visible.filter(option => !option.disabled);
  const searchable = options.length > 8;
  const activeIndex = visible.findIndex(option => option.value === active);
  const label = props['aria-label'] || props.title || selected?.label || placeholder;

  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
  }, [open, searchable]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    setQuery('');
    setActive(selected && !selected.disabled ? selected.value : options.find(option => !option.disabled)?.value ?? '');
    setOpen(true);
  };
  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    setInternalValue(option.value);
    if (option.value !== currentValue) onValueChange?.(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!open) { show(); return; }
      const index = enabled.findIndex(option => option.value === active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next]?.value ?? '');
    } else if (open && (event.key === 'Enter' || (event.key === ' ' && event.target === triggerRef.current))) {
      event.preventDefault();
      const option = enabled.find(item => item.value === active);
      if (option) choose(option);
    } else if (event.key === 'Tab') {
      setOpen(false);
      if (event.target === searchRef.current) triggerRef.current?.focus();
    } else if (!searchable && event.key.length === 1 && event.key !== ' ') {
      const match = enabled.find(option => option.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (match) { if (!open) show(); setActive(match.value); }
    }
  };

  return <>
    {name && <input type="hidden" name={name} value={currentValue} disabled={disabled} />}
    <button {...props} ref={triggerRef} type="button" disabled={disabled} role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} data-popup-open={open || undefined}
      className={`ui-select ${className}`} onClick={() => open ? setOpen(false) : show()} onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented) handleKeys(event); }}>
      <span className="truncate flex-1 text-left">{selected?.label || placeholder}</span><ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    <Popover open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} className="ui-select-menu">
      {searchable && <div className="ui-select-search"><Search size={14} /><input ref={searchRef} value={query} placeholder="搜索选项…" aria-label={`搜索${label}`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} onChange={event => { const q = event.target.value; setQuery(q); setActive(options.find(option => !option.disabled && `${option.label} ${option.value}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()))?.value ?? ''); }} onKeyDown={handleKeys} /></div>}
      <div ref={listRef} id={listId} role="listbox" aria-label={label} className="ui-option-list">
        {visible.map((option, index) => <Fragment key={option.value}>
          {option.group && option.group !== visible[index - 1]?.group && <div className="ui-option-group">{option.group}</div>}
          <div id={`${listId}-${index}`} role="option" aria-selected={option.value === currentValue} aria-disabled={option.disabled || undefined} data-active={option.value === active} className="ui-option" onPointerMove={() => !option.disabled && setActive(option.value)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            <span className="min-w-0 flex-1 break-words">{option.label}</span>{option.value === currentValue && <Check size={15} className="shrink-0" />}
          </div>
        </Fragment>)}
        {visible.length === 0 && <div className="ui-option-empty" role="status">没有匹配的选项</div>}
      </div>
    </Popover>
  </>;
}
