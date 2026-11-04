import { Select } from './Select';

/** Explicit hour/minute controls use the same WeLink menu on every platform. */
export function TimePicker({ value, onValueChange, className = '', disabled, 'aria-label': label = '时间' }: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [hour = '09', minute = '00'] = value.split(':');
  return <div className={`ui-time-picker ${className}`} role="group" aria-label={label}>
    <Select aria-label={`${label}：小时`} value={hour} disabled={disabled} className="flex-1 !border-0 !bg-transparent !shadow-none" onValueChange={hour => onValueChange(`${hour}:${minute}`)}>{Array.from({ length: 24 }, (_, index) => { const value = String(index).padStart(2, '0'); return <option key={value} value={value}>{value} 时</option>; })}</Select>
    <span aria-hidden="true" className="text-[var(--text-muted)]">:</span>
    <Select aria-label={`${label}：分钟`} value={minute} disabled={disabled} className="flex-1 !border-0 !bg-transparent !shadow-none" onValueChange={minute => onValueChange(`${hour}:${minute}`)}>{Array.from({ length: 60 }, (_, index) => { const value = String(index).padStart(2, '0'); return <option key={value} value={value}>{value} 分</option>; })}</Select>
  </div>;
}
