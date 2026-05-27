import React, { useState, useEffect } from 'react';
import { Settings, Cpu, Clock, Loader2, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import axios from 'axios';

export const BasicConfigSection: React.FC = () => {
  // 基本配置 + 分析参数
  const [cfgPort, setCfgPort] = useState('8080');
  const [cfgGinMode, setCfgGinMode] = useState('debug');
  const [cfgLogLevel, setCfgLogLevel] = useState('info');
  const [cfgTimezone, setCfgTimezone] = useState('Asia/Shanghai');
  const [cfgLateStart, setCfgLateStart] = useState(0);
  const [cfgLateEnd, setCfgLateEnd] = useState(5);
  const [cfgSessionGap, setCfgSessionGap] = useState(21600);
  const [cfgWorkerCount, setCfgWorkerCount] = useState(4);
  const [cfgLateMinMsg, setCfgLateMinMsg] = useState(100);
  const [cfgLateTopN, setCfgLateTopN] = useState(20);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    axios.get('/api/preferences').then(({ data }) => {
      if (data.port) setCfgPort(data.port);
      if (data.gin_mode) setCfgGinMode(data.gin_mode);
      if (data.log_level) setCfgLogLevel(data.log_level);
      if (data.timezone) setCfgTimezone(data.timezone);
      if (data.late_night_start_hour !== undefined) setCfgLateStart(data.late_night_start_hour);
      if (data.late_night_end_hour) setCfgLateEnd(data.late_night_end_hour);
      if (data.session_gap_seconds) setCfgSessionGap(data.session_gap_seconds);
      if (data.worker_count) setCfgWorkerCount(data.worker_count);
      if (data.late_night_min_messages) setCfgLateMinMsg(data.late_night_min_messages);
      if (data.late_night_top_n) setCfgLateTopN(data.late_night_top_n);
    }).catch(() => {}).finally(() => setCfgLoading(false));
  }, []);

  const saveConfig = async () => {
    setCfgSaving(true);
    setCfgMsg(null);
    try {
      const { data } = await axios.put('/api/preferences/config', {
        port: cfgPort,
        gin_mode: cfgGinMode,
        log_level: cfgLogLevel,
        timezone: cfgTimezone,
        late_night_start_hour: cfgLateStart,
        late_night_end_hour: cfgLateEnd,
        session_gap_seconds: cfgSessionGap,
        worker_count: cfgWorkerCount,
        late_night_min_messages: cfgLateMinMsg,
        late_night_top_n: cfgLateTopN,
      });
      const needRestart = data?.need_restart === true;
      setCfgMsg({
        ok: true,
        text: needRestart
          ? '已保存。端口/运行模式变更需重启才能生效，分析参数已热加载。'
          : '已保存，分析参数已生效。',
      });
    } catch {
      setCfgMsg({ ok: false, text: '保存失败，请重试' });
    } finally {
      setCfgSaving(false);
    }
  };

  return (
    <section className="mb-8" data-section-id="basic" data-settings-tags="基本 配置 端口 port 时区 深夜 worker 工作协程 gin 日志级别 port">
      <div className="flex items-center gap-2 mb-3">
        <Settings size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">服务配置</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">基本运行参数与分析参数。分析参数保存后立即热加载，端口和运行模式变更需重启。</p>

      {cfgLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <>
          {/* 基本配置 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mb-4 dk-card dk-border">
            <h4 className="text-sm font-bold text-[#1d1d1f] dk-text flex items-center gap-1.5">
              <Cpu size={14} className="text-[#07c160]" />
              基本配置
              <span className="text-xs text-amber-500 font-medium ml-1">修改后需重启</span>
            </h4>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">端口</p>
                <p className="text-xs text-gray-400 mt-0.5">服务监听端口，默认 8080</p>
              </div>
              <input
                type="text"
                value={cfgPort}
                onChange={(e) => setCfgPort(e.target.value.replace(/\D/g, ''))}
                className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">运行模式</p>
                <p className="text-xs text-gray-400 mt-0.5">release 模式隐藏 Gin 调试日志</p>
              </div>
              <select
                value={cfgGinMode}
                onChange={(e) => setCfgGinMode(e.target.value)}
                className="w-28 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-transparent"
              >
                <option value="debug">debug</option>
                <option value="release">release</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">日志等级</p>
                <p className="text-xs text-gray-400 mt-0.5">控制日志输出详细程度</p>
              </div>
              <select
                value={cfgLogLevel}
                onChange={(e) => setCfgLogLevel(e.target.value)}
                className="w-28 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-transparent"
              >
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </div>
          </div>

          {/* 分析参数 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 mb-4 dk-card dk-border">
            <h4 className="text-sm font-bold text-[#1d1d1f] dk-text flex items-center gap-1.5">
              <Clock size={14} className="text-[#07c160]" />
              分析参数
              <span className="text-xs text-green-600 font-medium ml-1">保存后立即生效</span>
            </h4>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">时区</p>
                <p className="text-xs text-gray-400 mt-0.5">用于消息时间的时区转换</p>
              </div>
              <select
                value={cfgTimezone}
                onChange={(e) => setCfgTimezone(e.target.value)}
                className="w-48 text-sm border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-[#07c160] dk-input bg-white dark:bg-gray-800"
              >
                {[
                  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo',
                  'Asia/Seoul', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai',
                  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
                  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
                  'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
                ].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜时段</p>
                <p className="text-xs text-gray-400 mt-0.5">起止小时（0–23），用于深夜聊天统计</p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={cfgLateStart}
                  onChange={(e) => setCfgLateStart(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-16 text-sm border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
                <span className="text-gray-400 text-sm">–</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={cfgLateEnd}
                  onChange={(e) => setCfgLateEnd(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                  className="w-16 text-sm border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
                />
                <span className="text-xs text-gray-400">时</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">会话间隔</p>
                <p className="text-xs text-gray-400 mt-0.5">超过此秒数视为新会话（默认 21600 = 6 小时）</p>
              </div>
              <input
                type="number"
                min={60}
                max={86400}
                value={cfgSessionGap}
                onChange={(e) => setCfgSessionGap(Number(e.target.value) || 21600)}
                className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">并发 Worker 数</p>
                <p className="text-xs text-gray-400 mt-0.5">联系人分析并行线程数</p>
              </div>
              <input
                type="number"
                min={1}
                max={32}
                value={cfgWorkerCount}
                onChange={(e) => setCfgWorkerCount(Math.min(32, Math.max(1, Number(e.target.value) || 4)))}
                className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜最少消息数</p>
                <p className="text-xs text-gray-400 mt-0.5">消息少于此数的联系人不参与深夜统计</p>
              </div>
              <input
                type="number"
                min={1}
                max={10000}
                value={cfgLateMinMsg}
                onChange={(e) => setCfgLateMinMsg(Number(e.target.value) || 100)}
                className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#1d1d1f] dk-text">深夜排行 Top N</p>
                <p className="text-xs text-gray-400 mt-0.5">深夜聊天排行榜显示人数</p>
              </div>
              <input
                type="number"
                min={1}
                max={100}
                value={cfgLateTopN}
                onChange={(e) => setCfgLateTopN(Math.min(100, Math.max(1, Number(e.target.value) || 20)))}
                className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160] dk-input"
              />
            </div>
          </div>

          {/* 保存按钮 + 状态提示 */}
          {cfgMsg && (
            <div className={`mb-3 flex items-start gap-2 rounded-2xl px-4 py-3 border ${cfgMsg.ok ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'}`}>
              {cfgMsg.ok ? <CheckCircle2 size={16} className="text-green-500 flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />}
              <p className={`text-sm ${cfgMsg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{cfgMsg.text}</p>
            </div>
          )}
          <button
            onClick={saveConfig}
            disabled={cfgSaving}
            className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-bold text-sm py-3 rounded-2xl flex items-center justify-center gap-2 transition-colors mb-4"
          >
            {cfgSaving ? (
              <><Loader2 size={16} className="animate-spin" /> 保存中…</>
            ) : (
              <><Save size={16} /> 保存配置</>
            )}
          </button>
        </>
      )}
    </section>
  );
};
