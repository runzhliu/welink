import React from 'react';
import { EyeOff } from 'lucide-react';

export const RecordingSection: React.FC<{
  privacyMode?: boolean;
  onTogglePrivacyMode?: (v: boolean) => void;
}> = ({ privacyMode = false, onTogglePrivacyMode }) => (
  <section className="mb-8" data-section-id="recording" data-settings-tags="隐私 录屏 privacy 屏蔽马赛克">
    <div className="flex items-center gap-2 mb-3">
      <EyeOff size={18} className="text-[#07c160]" />
      <h3 className="text-base font-bold text-[#1d1d1f] dk-text">录屏模式</h3>
    </div>
    <p className="text-sm text-gray-400 mb-4">开启后，所有联系人姓名、群名及词云内容将模糊显示，适合录制演示视频时保护隐私。<span className="text-amber-500 font-medium">注意：AI 首页的分析对象名字也会模糊，请选择好分析对象再开启。</span></p>
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between dk-card dk-border">
      <div>
        <p className="text-sm font-semibold text-[#1d1d1f] dk-text">模糊姓名与词云</p>
        <p className="text-xs text-gray-400 mt-0.5">页面刷新后仍保持此设置</p>
      </div>
      <button
        onClick={() => onTogglePrivacyMode?.(!privacyMode)}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${privacyMode ? 'bg-[#07c160]' : 'bg-gray-200 dark:bg-white/15'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${privacyMode ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  </section>
);
