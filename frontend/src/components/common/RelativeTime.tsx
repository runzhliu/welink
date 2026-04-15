/**
 * 相对时间显示：「3 天前」/「5 分钟前」/「刚刚」
 * hover 显示绝对时间（title，原生 tooltip 足够）
 * 1 分钟内自动刷新以让"刚刚"→"1 分钟前"
 */
import React, { useEffect, useState } from 'react';

const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

interface Props {
  /** Unix 秒或毫秒；0/null/undefined 时渲染 placeholder */
  ts?: number | null;
  /** ts 的单位，默认秒 */
  unit?: 'seconds' | 'millis';
  placeholder?: string;
  className?: string;
}

function formatRelative(ts: number): string {
  const now = Date.now();
  const diffMs = ts - now; // 负数表示过去
  const absSec = Math.abs(diffMs / 1000);
  if (absSec < 30) return '刚刚';
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60000), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffMs / 86400000), 'day');
  if (absSec < 86400 * 365) return rtf.format(Math.round(diffMs / (86400000 * 30)), 'month');
  return rtf.format(Math.round(diffMs / (86400000 * 365)), 'year');
}

function formatAbsolute(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const RelativeTime: React.FC<Props> = ({ ts, unit = 'seconds', placeholder = '-', className }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    // 每 60s 触发一次重渲染（"5 分钟前" → "6 分钟前"）
    const id = setInterval(() => tick(v => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!ts || ts <= 0) return <span className={className}>{placeholder}</span>;
  const ms = unit === 'seconds' ? ts * 1000 : ts;
  return (
    <span className={className} title={formatAbsolute(ms)}>
      {formatRelative(ms)}
    </span>
  );
};
