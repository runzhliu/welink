import React, { useState } from 'react';
import { BarChart2 } from 'lucide-react';
import {
  MEMBER_RANK_LIMIT_KEY, MEMBER_NAME_WIDTH_KEY,
  DEFAULT_RANK_LIMIT, DEFAULT_NAME_WIDTH,
} from '../constants';

export const DisplaySection: React.FC<{
  dark?: boolean;
  onToggleDark?: () => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}> = ({ dark = false, onToggleDark, fontSize = 16, onFontSizeChange }) => {
  const [rankLimit, setRankLimit] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_RANK_LIMIT_KEY)) || DEFAULT_RANK_LIMIT
  );
  const [nameWidth, setNameWidth] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_NAME_WIDTH_KEY)) || DEFAULT_NAME_WIDTH
  );

  return (
    <section className="mb-8" data-section-id="display" data-settings-tags="显示 暗色 主题 字号 group 群成员 宽度 name 暗黑">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">显示设置</h3>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5 dk-card dk-border">
        {onToggleDark && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dk-text">暗色模式</p>
              <p className="text-xs text-gray-400 mt-0.5">切换界面深色 / 浅色主题</p>
            </div>
            <button
              type="button"
              onClick={onToggleDark}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${dark ? 'bg-[#07c160]' : 'bg-gray-200 dark:bg-white/20'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        )}
        {/* 字号调节 */}
        {onFontSizeChange && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dk-text">字号大小</p>
              <p className="text-xs text-gray-400 mt-0.5">调整全局文字大小（默认 16px）</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-6 text-right">{fontSize}</span>
              <input
                type="range"
                min={12}
                max={22}
                step={1}
                value={fontSize}
                onChange={e => onFontSizeChange(Number(e.target.value))}
                className="w-28 accent-[#07c160]"
              />
              <div className="flex gap-1">
                {[14, 16, 18, 20].map(s => (
                  <button
                    key={s}
                    onClick={() => onFontSizeChange(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                      fontSize === s ? 'bg-[#07c160] text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dk-text">群聊发言排行显示人数</p>
            <p className="text-xs text-gray-400 mt-0.5">默认展示 Top N，最多支持 500（实时生效）</p>
          </div>
          <input
            type="number"
            min={1}
            max={500}
            value={rankLimit}
            onChange={(e) => {
              const v = Math.min(500, Math.max(1, Number(e.target.value) || DEFAULT_RANK_LIMIT));
              setRankLimit(v);
              localStorage.setItem(MEMBER_RANK_LIMIT_KEY, String(v));
            }}
            className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dk-text">发言排行名字列宽度</p>
            <p className="text-xs text-gray-400 mt-0.5">单位 px，也可在排行图表中直接拖拽调整（实时生效）</p>
          </div>
          <input
            type="number"
            min={60}
            max={400}
            value={nameWidth}
            onChange={(e) => {
              const v = Math.min(400, Math.max(60, Number(e.target.value) || DEFAULT_NAME_WIDTH));
              setNameWidth(v);
              localStorage.setItem(MEMBER_NAME_WIDTH_KEY, String(v));
            }}
            className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
          />
        </div>
      </div>
    </section>
  );
};
