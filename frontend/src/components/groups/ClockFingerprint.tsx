/**
 * 群聊时钟指纹 —— 7×24 热图徽章
 * 星期放行（纵轴），小时放列（横轴）。颜色深浅表示消息量。
 */

import React, { useMemo } from 'react';

interface Props {
  matrix: number[][]; // [weekday 0=Sun ... 6=Sat][hour 0-23]
  compact?: boolean;  // 小版：挂在列表行末（10×4 px 一格）
  title?: string;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export const ClockFingerprint: React.FC<Props> = ({ matrix, compact = false, title }) => {
  const max = useMemo(() => {
    let m = 0;
    for (const row of matrix || []) for (const v of row || []) if (v > m) m = v;
    return m;
  }, [matrix]);

  if (!matrix || matrix.length !== 7 || max === 0) return null;

  const cellW = compact ? 3 : 12;
  const cellH = compact ? 3 : 12;
  const gap = compact ? 1 : 1;
  const labelW = compact ? 0 : 18;
  const labelH = compact ? 0 : 12;

  const colorFor = (v: number): string => {
    if (v === 0) return 'rgba(148,163,184,0.12)';
    const t = Math.log1p(v) / Math.log1p(max);
    // 绿色阶 #e7f8f0 → #07c160
    const r = Math.round(231 + (7 - 231) * t);
    const g = Math.round(248 + (193 - 248) * t);
    const b = Math.round(240 + (96 - 240) * t);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div className="inline-block" title={title}>
      <div className="flex">
        {!compact && <div style={{ width: labelW }} />}
        {Array.from({ length: 24 }).map((_, h) => (
          <div
            key={h}
            style={{
              width: cellW + gap,
              fontSize: 8,
              color: '#9ca3af',
              textAlign: 'center',
              visibility: !compact && (h % 6 === 0) ? 'visible' : 'hidden',
            }}
          >
            {h}
          </div>
        ))}
      </div>
      {matrix.map((row, w) => (
        <div key={w} className="flex items-center">
          {!compact && (
            <div style={{ width: labelW, fontSize: 9, color: '#9ca3af', textAlign: 'right', paddingRight: 4 }}>
              {WEEKDAY_LABELS[w]}
            </div>
          )}
          {row.map((v, h) => (
            <div
              key={h}
              title={`${WEEKDAY_LABELS[w]} ${h}:00 · ${v} 条`}
              style={{
                width: cellW,
                height: cellH,
                marginRight: gap,
                marginBottom: gap,
                backgroundColor: colorFor(v),
                borderRadius: compact ? 1 : 2,
              }}
            />
          ))}
        </div>
      ))}
      {!compact && (
        <div style={{ height: labelH, fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
          0h — 23h
        </div>
      )}
    </div>
  );
};
