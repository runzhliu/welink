/**
 * 设置页 — 隐私屏蔽（两种模式通用）+ App 配置（仅 App 模式）
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  X, Plus, ShieldOff, User, Users,
  FolderOpen, Loader2, Database, FileText, AlertCircle, RotateCcw, CheckCircle2, EyeOff, BarChart2,
} from 'lucide-react';

export const MEMBER_RANK_LIMIT_KEY = 'welink_member_rank_limit';
export const MEMBER_NAME_WIDTH_KEY = 'welink_member_name_width';
export const DEFAULT_RANK_LIMIT = 10;
export const DEFAULT_NAME_WIDTH = 144; // px, roughly w-36
import { appApi } from '../../services/appApi';
import type { ContactStats, GroupInfo } from '../../types';

// ─── 隐私屏蔽子组件 ───────────────────────────────────────────────────────────

const TagList: React.FC<{
  items: string[];
  onRemove: (v: string) => void;
  emptyText: string;
  labelFor?: (id: string) => string;
  privacyMode?: boolean;
}> = ({ items, onRemove, emptyText, labelFor, privacyMode }) => (
  <div className="min-h-[56px] flex flex-wrap gap-2">
    {items.length === 0 ? (
      <span className="text-sm text-gray-400 self-center">{emptyText}</span>
    ) : (
      items.map((item) => {
        const label = labelFor ? labelFor(item) : item;
        const showId = label !== item;
        return (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700"
          >
            <span className={privacyMode ? 'privacy-blur' : ''}>{label}</span>
            {showId && <span className={`text-xs text-gray-400${privacyMode ? ' privacy-blur' : ''}`}>{item}</span>}
            <button
              onClick={() => onRemove(item)}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <X size={13} />
            </button>
          </span>
        );
      })
    )}
  </div>
);

const AddInput: React.FC<{
  placeholder: string;
  onAdd: (v: string) => void;
}> = ({ placeholder, onAdd }) => {
  const [value, setValue] = useState('');

  const submit = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 mt-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={placeholder}
        className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#07c160]/20 focus:border-[#07c160] transition-all"
      />
      <button
        onClick={submit}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#07c160] text-white text-sm font-semibold rounded-xl hover:bg-[#06ad56] transition-colors"
      >
        <Plus size={15} />
        添加
      </button>
    </div>
  );
};

// ─── 主设置页 ─────────────────────────────────────────────────────────────────

interface SettingsPageProps {
  isAppMode: boolean;
  blockedUsers: string[];
  blockedGroups: string[];
  onAddBlockedUser: (v: string) => void;
  onRemoveBlockedUser: (v: string) => void;
  onAddBlockedGroup: (v: string) => void;
  onRemoveBlockedGroup: (v: string) => void;
  allContacts?: ContactStats[];
  allGroups?: GroupInfo[];
  privacyMode?: boolean;
  onTogglePrivacyMode?: (v: boolean) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  isAppMode,
  blockedUsers,
  blockedGroups,
  onAddBlockedUser,
  onRemoveBlockedUser,
  onAddBlockedGroup,
  onRemoveBlockedGroup,
  allContacts = [],
  allGroups = [],
  privacyMode = false,
  onTogglePrivacyMode,
}) => {
  // 显示设置
  const [rankLimit, setRankLimit] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_RANK_LIMIT_KEY)) || DEFAULT_RANK_LIMIT
  );
  const [nameWidth, setNameWidth] = useState<number>(() =>
    Number(localStorage.getItem(MEMBER_NAME_WIDTH_KEY)) || DEFAULT_NAME_WIDTH
  );

  // App 配置状态
  const [dataDir, setDataDir] = useState('');
  const [logDir, setLogDir] = useState('');
  const [loadingCfg, setLoadingCfg] = useState(isAppMode);
  const [browsing, setBrowsing] = useState<'data' | 'log' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!isAppMode) return;
    appApi.getConfig().then((cfg) => {
      setDataDir(cfg.data_dir || '');
      setLogDir(cfg.log_dir || '');
    }).catch(() => {}).finally(() => setLoadingCfg(false));
  }, [isAppMode]);

  const browse = useCallback(async (type: 'data' | 'log') => {
    setBrowsing(type);
    try {
      const prompt = type === 'data' ? '选择解密后的微信数据库目录（decrypted/）' : '选择日志文件存放目录';
      const path = await appApi.browse(prompt);
      if (type === 'data') setDataDir(path);
      else setLogDir(path);
    } catch {
      // 用户取消，忽略
    } finally {
      setBrowsing(null);
    }
  }, []);

  const handleRestart = async () => {
    setError('');
    setSubmitting(true);
    try {
      await appApi.restart(dataDir.trim(), logDir.trim());
      setRestarting(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('保存失败：' + msg);
      setSubmitting(false);
    }
  };

  // label 解析
  const userLabelFor = (id: string): string => {
    const c = allContacts.find((c) => c.username === id || c.nickname === id || c.remark === id);
    return c ? (c.remark || c.nickname || id) : id;
  };
  const groupLabelFor = (id: string): string => {
    const g = allGroups.find((g) => g.username === id || g.name === id);
    return g ? g.name : id;
  };

  if (restarting) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-500">
        <CheckCircle2 size={40} className="text-[#07c160]" />
        <p className="font-semibold text-[#1d1d1f]">配置已保存，应用正在重启…</p>
        <p className="text-sm text-gray-400">稍后新窗口会自动打开</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-black text-[#1d1d1f] mb-8">设置</h2>

      {/* ── 录屏模式 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <EyeOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">录屏模式</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">开启后，所有联系人姓名、群名及词云内容将模糊显示，适合录制演示视频时保护隐私。</p>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f]">模糊姓名与词云</p>
            <p className="text-xs text-gray-400 mt-0.5">页面刷新后仍保持此设置</p>
          </div>
          <button
            onClick={() => onTogglePrivacyMode?.(!privacyMode)}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${privacyMode ? 'bg-[#07c160]' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${privacyMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </section>

      {/* ── 显示设置 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">显示设置</h3>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">群聊发言排行显示人数</p>
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
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160]"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">发言排行名字列宽度</p>
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
              className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-1.5 text-center focus:outline-none focus:border-[#07c160]"
            />
          </div>
        </div>
      </section>

      {/* ── 隐私屏蔽 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <ShieldOff size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f]">隐私屏蔽</h3>
        </div>
        <p className="text-sm text-gray-400 mb-4">被屏蔽的联系人和群聊将从所有列表中隐藏，数据仍保留在数据库中。</p>

        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f]">屏蔽联系人</h4>
            {blockedUsers.length > 0 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                {blockedUsers.length} 条
              </span>
            )}
          </div>
          <TagList items={blockedUsers} onRemove={onRemoveBlockedUser} emptyText="暂无屏蔽联系人" labelFor={userLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入微信ID、昵称或备注名，按回车添加" onAdd={onAddBlockedUser} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-[#07c160]" />
            <h4 className="font-bold text-[#1d1d1f]">屏蔽群聊</h4>
            {blockedGroups.length > 0 && (
              <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                {blockedGroups.length} 条
              </span>
            )}
          </div>
          <TagList items={blockedGroups} onRemove={onRemoveBlockedGroup} emptyText="暂无屏蔽群聊" labelFor={groupLabelFor} privacyMode={privacyMode} />
          <AddInput placeholder="输入群名称或群ID（以 @chatroom 结尾），按回车添加" onAdd={onAddBlockedGroup} />
        </div>
      </section>

      {/* ── App 配置（仅 App 模式） ── */}
      {isAppMode && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Database size={18} className="text-[#07c160]" />
            <h3 className="text-base font-bold text-[#1d1d1f]">应用配置</h3>
          </div>
          <p className="text-sm text-gray-400 mb-4">修改配置后需要重启应用生效</p>

          {loadingCfg ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <>
              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-4">
                {/* 数据库目录 */}
                <div className="mb-5">
                  <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
                    <Database size={14} className="text-[#07c160]" />
                    解密数据库目录
                    <span className="text-xs text-gray-400 font-normal">（留空则使用演示数据）</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={dataDir}
                      onChange={(e) => setDataDir(e.target.value)}
                      placeholder="留空则使用演示数据"
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
                    />
                    <button
                      onClick={() => browse('data')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#e7f8f0] text-[#07c160] text-sm font-semibold hover:bg-[#d0f0e0] disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'data' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>

                {/* 日志目录 */}
                <div>
                  <label className="block text-sm font-bold text-[#1d1d1f] mb-2 flex items-center gap-1.5">
                    <FileText size={14} className="text-gray-400" />
                    日志目录
                    <span className="text-xs text-gray-400 font-normal">（可选）</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={logDir}
                      onChange={(e) => setLogDir(e.target.value)}
                      placeholder="留空则不记录日志文件"
                      className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#07c160] bg-[#f8f9fb] font-mono"
                    />
                    <button
                      onClick={() => browse('log')}
                      disabled={browsing !== null}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors flex-shrink-0"
                    >
                      {browsing === 'log' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                      浏览
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
                  <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={handleRestart}
                disabled={submitting}
                className="w-full bg-[#07c160] hover:bg-[#06ad56] disabled:opacity-50 text-white font-black text-base py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-200"
              >
                {submitting ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    正在保存并重启…
                  </>
                ) : (
                  <>
                    <RotateCcw size={20} strokeWidth={2.5} />
                    保存并重启
                  </>
                )}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
};
