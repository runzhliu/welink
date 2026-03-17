/**
 * 初始化加载屏幕
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface InitializingScreenProps {
  message?: string;
}

export const InitializingScreen: React.FC<InitializingScreenProps> = ({
  message = '正在初始化数据...',
}) => {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[#f8f9fb] to-[#e7f8f0] flex items-center justify-center z-50">
      <div className="text-center">
        {/* Logo with Animation */}
        <div className="mb-8 relative">
          <div className="w-24 h-24 mx-auto rounded-[32px] shadow-2xl shadow-green-200/50 animate-pulse overflow-hidden">
            <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
          </div>

          {/* Spinning Loader */}
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
            <div className="bg-white rounded-full p-3 shadow-lg">
              <Loader2 size={24} className="text-[#07c160] animate-spin" strokeWidth={3} />
            </div>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-4xl font-black text-[#1d1d1f] mb-3 tracking-tight">
          WeLink
        </h2>

        {/* Subtitle */}
        <p className="text-gray-500 font-semibold text-lg mb-8">
          微信聊天数据分析平台
        </p>

        {/* Status Message */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl px-8 py-4 inline-block shadow-lg">
          <p className="text-[#07c160] font-bold text-sm tracking-wide">
            {message}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="mt-12 space-y-3 text-left max-w-md mx-auto">
          <div className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-[#07c160] animate-pulse" />
            <span className="text-gray-600 font-medium">正在创建数据库索引...</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-[#07c160] animate-pulse animation-delay-200" />
            <span className="text-gray-600 font-medium">正在分析联系人数据...</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse animation-delay-400" />
            <span className="text-gray-400 font-medium">正在生成统计报告...</span>
          </div>
        </div>

        {/* Hint */}
        <p className="mt-12 text-xs text-gray-400 font-medium">
          首次启动需要约 10-30 秒，请耐心等待...
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animation-delay-200 {
          animation-delay: 200ms;
        }
        .animation-delay-400 {
          animation-delay: 400ms;
        }
      `}</style>
    </div>
  );
};
