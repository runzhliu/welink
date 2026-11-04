import { useRef, useState, useId, type ButtonHTMLAttributes, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from './Popover';
import { Select } from './Select';

interface DatePickerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onChange' | 'type'> {
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  name?: string;
  required?: boolean;
  placeholder?: string;
}

function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Local-date calendar, independent of OS/browser popup styling. */
export function DatePicker({ value, onValueChange, min, max, name, required, disabled, placeholder = '选择日期', className = '', ...props }: DatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => value ? parseDate(value) : new Date());
  const [focused, setFocused] = useState(value);
  const id = useId();
  const year = view.getFullYear(), month = view.getMonth();
  const earliestYear = min ? parseDate(min).getFullYear() : Math.min(1900, year);
  const latestYear = max ? parseDate(max).getFullYear() : Math.max(new Date().getFullYear() + 20, year);
  const years = Array.from({ length: Math.max(0, latestYear - earliestYear + 1) }, (_, index) => earliestYear + index);
  const allowed = (date: string) => (!min || date >= min) && (!max || date <= max);
  const clamp = (date: string) => min && date < min ? min : max && date > max ? max : date;
  const monthStart = new Date(year, month, 1);
  const offset = (monthStart.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(year, month, index - offset + 1));
  const visibleFocus = days.some(date => dateKey(date) === focused && allowed(focused))
    ? focused : dateKey(days.find(date => date.getMonth() === month && allowed(dateKey(date))) ?? monthStart);
  const today = dateKey(new Date());
  const show = () => {
    const initial = clamp(value || today);
    setView(parseDate(initial)); setFocused(initial); setOpen(true);
    requestAnimationFrame(() => calendarRef.current?.querySelector<HTMLButtonElement>(`[data-date="${initial}"]`)?.focus());
  };
  const choose = (date: string) => { onValueChange(date); setOpen(false); triggerRef.current?.focus(); };
  const moveFocus = (date: Date) => {
    const key = clamp(dateKey(date));
    setFocused(key); setView(parseDate(key));
    requestAnimationFrame(() => calendarRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus());
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const next = new Date(date);
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in delta) next.setDate(next.getDate() + delta[event.key]);
    else if (event.key === 'Home') next.setDate(next.getDate() - (next.getDay() + 6) % 7);
    else if (event.key === 'End') next.setDate(next.getDate() + 6 - (next.getDay() + 6) % 7);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next.setMonth(next.getMonth() + (event.key === 'PageDown' ? 1 : -1));
    else return;
    event.preventDefault(); moveFocus(next);
  };

  return <>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button {...props} ref={triggerRef} type="button" disabled={disabled} aria-label={props['aria-label'] || props.title || '选择日期'} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-required={required || undefined} data-popup-open={open || undefined} className={`ui-date-trigger ${className}`} onClick={() => open ? setOpen(false) : show()}>
      <span className={`truncate flex-1 text-left ${value ? '' : 'text-[var(--text-muted)]'}`}>{value || placeholder}</span><CalendarDays size={15} className="shrink-0 text-[var(--text-muted)]" />
    </button>
    <Popover open={open && !disabled} anchorRef={triggerRef} onClose={() => setOpen(false)} minWidth={300} className="ui-calendar-popover">
      <div id={id} role="dialog" aria-label="选择日期" ref={calendarRef} className="ui-calendar">
        <div className="flex items-center gap-1 mb-3">
          <button type="button" className="ui-icon-button !w-8 !h-8" aria-label="上个月" disabled={!!min && dateKey(new Date(year, month, 0)) < min} onClick={() => setView(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
          <Select aria-label="年份" value={year} onValueChange={value => setView(new Date(Number(value), month, 1))} className="flex-1 !min-h-8 !px-2 !text-xs">{years.map(year => <option key={year} value={year}>{year} 年</option>)}</Select>
          <Select aria-label="月份" value={month} onValueChange={value => setView(new Date(year, Number(value), 1))} className="flex-1 !min-h-8 !px-2 !text-xs">{Array.from({ length: 12 }, (_, index) => <option key={index} value={index} disabled={(!!min && dateKey(new Date(year, index + 1, 0)) < min) || (!!max && dateKey(new Date(year, index, 1)) > max)}>{index + 1} 月</option>)}</Select>
          <button type="button" className="ui-icon-button !w-8 !h-8" aria-label="下个月" disabled={!!max && dateKey(new Date(year, month + 1, 1)) > max} onClick={() => setView(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="ui-calendar-grid" role="grid" aria-label={`${year} 年 ${month + 1} 月`}>
          <div role="row" className="contents">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day} role="columnheader" className="ui-calendar-weekday">{day}</span>)}</div>
          {Array.from({ length: 6 }, (_, week) => <div key={week} role="row" className="contents">{days.slice(week * 7, week * 7 + 7).map(date => {
            const key = dateKey(date);
            return <div key={key} role="gridcell" aria-selected={key === value} className="contents"><button type="button" data-date={key} tabIndex={key === visibleFocus ? 0 : -1} disabled={!allowed(key)} aria-label={key} aria-current={key === today ? 'date' : undefined} className={`ui-calendar-day ${key === value ? 'is-selected' : ''} ${date.getMonth() !== month ? 'is-outside' : ''}`} onKeyDown={event => keyboard(event, date)} onClick={() => choose(key)}>{date.getDate()}</button></div>;
          })}</div>)}
        </div>
        <div className="flex justify-between border-t dk-border pt-2 mt-2">
          <button type="button" className="ui-button !min-h-8 !text-xs" disabled={required || !value} onClick={() => choose('')}>清除</button>
          <button type="button" className="ui-button !min-h-8 !text-xs" disabled={!allowed(today)} onClick={() => choose(today)}>今天</button>
        </div>
      </div>
    </Popover>
  </>;
}
