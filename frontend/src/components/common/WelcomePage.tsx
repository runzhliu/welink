/**
 * 欢迎页 — 使用指南 + 时间范围选择
 */

import React, { useState } from 'react';
import { ChevronRight, Loader2, Monitor, Terminal, Database, ExternalLink, Github, Calendar } from 'lucide-react';

interface TimeOption {
  label: string;
  sublabel: string;
  months: number | null;
  custom?: true;
}

const OPTIONS: TimeOption[] = [
  { label: '近 1 个月', sublabel: '最近 30 天的聊天', months: 1 },
  { label: '近 3 个月', sublabel: '最近 90 天的聊天', months: 3 },
  { label: '近 6 个月', sublabel: '最近半年的聊天', months: 6 },
  { label: '近 1 年',   sublabel: '最近 365 天的聊天', months: 12 },
  { label: '全部数据',  sublabel: '分析所有历史聊天记录', months: null },
  { label: '自定义范围', sublabel: '指定任意起止日期', months: 0, custom: true },
];

interface WelcomePageProps {
  onStart: (from: number | null, to: number | null, label: string) => void;
  loading: boolean;
  isAppMode?: boolean;
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ onStart, loading, isAppMode = false }) => {
  const [selected, setSelected] = useState<number>(2);
  const today = new Date().toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(today);

  const handleStart = () => {
    const opt = OPTIONS[selected];
    if (opt.custom) {
      const from = customFrom ? Math.floor(new Date(customFrom).getTime() / 1000) : null;
      const to = customTo ? Math.floor(new Date(customTo).getTime() / 1000) + 86399 : null;
      const label = customFrom ? `${customFrom} ~ ${customTo || '至今'}` : `至 ${customTo}`;
      onStart(from, to, label);
    } else if (opt.months === null) {
      onStart(null, null, opt.label);
    } else {
      const now = Math.floor(Date.now() / 1000);
      const from = now - opt.months * 30 * 86400;
      onStart(from, null, opt.label);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] dk-subtle overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Logo & Title */}
        <div className="text-center mb-10">
          <div className="inline-block w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-green-200 overflow-hidden">
            <img src="/favicon.svg" alt="WeLink" className="w-full h-full" />
          </div>
          <h1 className="text-4xl font-black text-[#1d1d1f] dk-text tracking-tight">WeLink</h1>
          <p className="text-gray-400 mt-2 text-sm font-medium">微信聊天记录 AI 助手</p>
          <a
            href="https://github.com/runzhliu/WeLink"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full bg-[#1d1d1f] text-white text-xs font-semibold hover:bg-[#333] transition-colors"
          >
            <Github size={13} />
            runzhliu/welink
          </a>
        </div>

        {/* Platform Notice */}
        <div className="bg-[#1d1d1f] text-white rounded-2xl p-4 mb-3 flex items-start gap-3">
          <Monitor size={18} className="text-gray-300 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold">支持 macOS 12+ 和 Windows 10+</p>
            <p className="text-xs text-gray-400 mt-0.5">App 版本启动后在设置页面选择 decrypted/ 目录路径即可，放在任意位置均可</p>
          </div>
        </div>

        {/* Data Safety Notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <span className="text-amber-500 flex-shrink-0 text-base leading-5">⚠️</span>
          <div>
            <p className="text-sm font-bold text-amber-800">注意数据安全</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              请仅分析您本人的聊天数据，未经他人同意分析其私人聊天记录可能违反隐私法律。所有数据仅在本地处理，不会上传至任何服务器。
            </p>
          </div>
        </div>

        {/* How-to Guide */}
        <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border shadow-sm p-6 mb-4">
          <h2 className="text-base font-black text-[#1d1d1f] dk-text mb-4">使用前准备：获取聊天数据库</h2>

          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#07c16015] text-[#07c160] text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">1</div>
              <div>
                <p className="text-sm font-bold text-[#1d1d1f] dk-text">将手机聊天记录同步到电脑（推荐）</p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">打开手机微信 → 「我」→「设置」→「通用」→「聊天记录迁移与备份」→「迁移」，将记录迁移到电脑端，可获得更完整的历史数据</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#07c16015] text-[#07c160] text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">2</div>
              <div>
                <p className="text-sm font-bold text-[#1d1d1f] dk-text">确保微信在电脑上保持运行</p>
                <p className="text-xs text-gray-400 mt-0.5">解密工具（macOS / Windows 均支持）需要从运行中的微信进程内存读取密钥</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#07c16015] text-[#07c160] text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">3</div>
              <div>
                <p className="text-sm font-bold text-[#1d1d1f] dk-text">克隆并运行解密工具</p>
                <a
                  href="https://github.com/ylytdeng/wechat-decrypt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#07c160] hover:underline mt-0.5"
                >
                  github.com/ylytdeng/wechat-decrypt
                  <ExternalLink size={11} />
                </a>
                <div className="mt-2 bg-[#f8f9fb] dk-subtle rounded-xl px-3 py-2 flex items-center gap-2">
                  <Terminal size={12} className="text-gray-400 flex-shrink-0" />
                  <code className="text-xs text-gray-600 dark:text-gray-300 font-mono">sudo python3 main.py</code>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">选择 <span className="font-mono bg-gray-100 dark:bg-white/10 px-1 rounded">decrypt</span> 模式，工具会自动提取密钥并解密所有数据库</p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#07c16015] text-[#07c160] text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">4</div>
              <div>
                <p className="text-sm font-bold text-[#1d1d1f] dk-text">将解密后的数据库放入目录</p>
                <div className="mt-2 bg-[#f8f9fb] dk-subtle rounded-xl px-3 py-2 flex items-start gap-2">
                  <Database size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <code className="text-xs text-gray-600 dark:text-gray-300 font-mono leading-relaxed">
                    decrypted/<br />
                    ├── contact/contact.db<br />
                    └── message/message_*.db
                  </code>
                </div>
                {isAppMode ? (
                  <p className="text-xs text-[#07c160] mt-1.5 font-medium">✓ App 模式：decrypted/ 可放在任意位置，在设置页面选择路径即可</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">Docker 模式需将 decrypted/ 放在项目仓库根目录内</p>
                )}
              </div>
            </div>

            {/* Step 5：仅 Docker/Web 模式显示 */}
            {!isAppMode && (
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-[#07c16015] text-[#07c160] text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">5</div>
                <div>
                  <p className="text-sm font-bold text-[#1d1d1f] dk-text">启动 WeLink</p>
                  <div className="mt-2 bg-[#f8f9fb] dk-subtle rounded-xl px-3 py-2 flex items-center gap-2">
                    <Terminal size={12} className="text-gray-400 flex-shrink-0" />
                    <code className="text-xs text-gray-600 dark:text-gray-300 font-mono">docker compose up</code>
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">访问 <span className="font-mono">localhost:3418</span> 即可开始分析</p>
                </div>
              </div>
            )}
          </div>

          {/* Credit */}
          <div className="mt-5 pt-4 border-t border-gray-100 dk-border flex items-center gap-2">
            <Monitor size={13} className="text-gray-300" />
            <p className="text-xs text-gray-400">
              解密方案由{' '}
              <a
                href="https://github.com/ylytdeng/wechat-decrypt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#07c160] hover:underline font-medium"
              >
                ylytdeng/wechat-decrypt
              </a>
              {' '}提供，感谢开源贡献
            </p>
          </div>
        </div>

        {/* Time Range Selection */}
        <div className="bg-white dk-card rounded-3xl border border-gray-100 dk-border shadow-sm p-6 mb-6">
          <h2 className="text-base font-black text-[#1d1d1f] dk-text mb-1">选择分析时间范围</h2>
          <p className="text-xs text-gray-400 mb-4">时间范围会影响所有统计数据，选择范围越小加载越快</p>

          <div className="space-y-2">
            {OPTIONS.map((opt, i) => (
              <div key={i}>
                <button
                  onClick={() => setSelected(i)}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left ${
                    selected === i
                      ? 'border-[#07c160] bg-[#07c16008]'
                      : 'border-gray-100 dark:border-white/10 hover:border-gray-200 dark:hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {opt.custom && <Calendar size={14} className={selected === i ? 'text-[#07c160]' : 'text-gray-300'} />}
                    <div>
                      <div className={`text-sm font-bold ${selected === i ? 'text-[#07c160]' : 'text-[#1d1d1f] dk-text'}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{opt.sublabel}</div>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    selected === i ? 'border-[#07c160] bg-[#07c160]' : 'border-gray-200 dark:border-white/20'
                  }`}>
                    {selected === i && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                </button>

                {/* 自定义日期输入，选中后展开 */}
                {opt.custom && selected === i && (
                  <div className="mt-2 px-4 py-3 bg-[#f8f9fb] dk-subtle rounded-2xl border border-[#07c16030] space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">开始</label>
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        max={customTo || today}
                        className="flex-1 text-sm border border-gray-200 dk-border rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] bg-white dk-input"
                      />
                      <span className="text-xs text-gray-400">（留空则从最早）</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-bold text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">结束</label>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                        min={customFrom || undefined}
                        max={today}
                        className="flex-1 text-sm border border-gray-200 dk-border rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] bg-white dk-input"
                      />
                      <span className="text-xs text-gray-400">（留空则到今天）</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Start Button */}
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-60 text-white font-black text-base py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200"
        >
          {loading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              正在建立索引...
            </>
          ) : (
            <>
              开始分析
              <ChevronRight size={20} strokeWidth={2.5} />
            </>
          )}
        </button>

        <p className="text-center text-xs text-gray-300 mt-4 pb-6">
          进入后可随时点击「重新选择」更改时间范围
        </p>
      </div>
    </div>
  );
};
