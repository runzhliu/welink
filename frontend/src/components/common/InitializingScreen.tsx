/**
 * 初始化加载屏幕 — 与 AI 首页风格保持一致
 */

import React, { useEffect, useState } from 'react';

interface InitializingScreenProps {
  message?: string;
}

const STEPS = [
  '正在创建数据库索引',
  '正在分析联系人数据',
  '正在生成统计报告',
];

export const InitializingScreen: React.FC<InitializingScreenProps> = ({
  message = '正在初始化数据...',
}) => {
  // 依次点亮步骤
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 3000);
    return () => clearInterval(id);
  }, []);

  // 进度条
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setProgress(p => Math.min(p + 1, 90)), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center z-50">
      <div className="flex flex-col items-center gap-0 w-72">

        {/* Logo 区：ai-avatar + WeLink 标题 */}
        <div className="flex items-center gap-4 mb-10">
          <img src="/favicon.svg" alt="WeLink" className="w-16 h-16 rounded-2xl shadow-lg shadow-green-100" />
          <div>
            <h1 className="text-3xl font-black text-[#1d1d1f] tracking-tight leading-none mb-1">
              WeLink
            </h1>
            <p className="text-sm font-semibold text-gray-400 leading-none">
              AI 驱动 · 微信聊天分析
            </p>
          </div>
        </div>

        {/* 当前状态文字 */}
        <p className="text-sm font-semibold text-[#07c160] mb-4 self-start">
          {message}
        </p>

        {/* 进度条 */}
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-gradient-to-r from-[#09d46a] to-[#07c160] rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 步骤列表 */}
        <div className="w-full space-y-2.5">
          {STEPS.map((s, i) => {
            const done    = i < step;
            const active  = i === step;
            const pending = i > step;
            return (
              <div key={s} className="flex items-center gap-3">
                {/* 状态圆点 */}
                {done ? (
                  <svg className="w-4 h-4 flex-shrink-0 text-[#07c160]" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" fill="#e7f8f0" />
                    <path d="M5 8l2 2 4-4" stroke="#07c160" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : active ? (
                  <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-[#07c160] animate-pulse" />
                  </span>
                ) : (
                  <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-gray-200" />
                  </span>
                )}
                <span className={`text-sm font-medium ${
                  done    ? 'text-[#07c160]' :
                  active  ? 'text-[#1d1d1f]' :
                            'text-gray-300'
                }`}>
                  {s}{active ? '…' : done ? ' ✓' : ''}
                </span>
              </div>
            );
          })}
        </div>

        {/* 底部提示 */}
        <p className="mt-10 text-xs text-gray-300 font-medium text-center">
          首次启动需要约 10–30 秒，请耐心等待
        </p>
      </div>
    </div>
  );
};
