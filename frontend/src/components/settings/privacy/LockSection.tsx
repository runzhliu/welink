import React, { useState } from 'react';
import { Lock, Unlock, CheckCircle2, Loader2 } from 'lucide-react';
import { useLock, type AutoLockMinutes } from '../../../contexts/LockContext';

export const LockSection: React.FC = () => {
  const lockCtx = useLock();
  const [lockSetupOpen, setLockSetupOpen] = useState(false);
  const [lockChangeOpen, setLockChangeOpen] = useState(false);
  const [lockDisableOpen, setLockDisableOpen] = useState(false);
  const [lockModalBusy, setLockModalBusy] = useState(false);
  const [lockModalErr, setLockModalErr] = useState<string | null>(null);
  const [pinA, setPinA] = useState('');
  const [pinB, setPinB] = useState('');
  const [pinOld, setPinOld] = useState('');

  const resetLockModals = () => {
    setLockSetupOpen(false);
    setLockChangeOpen(false);
    setLockDisableOpen(false);
    setLockModalBusy(false);
    setLockModalErr(null);
    setPinA(''); setPinB(''); setPinOld('');
  };

  const handleLockSetup = async () => {
    if (pinA.length < 4 || pinA.length > 32) { setLockModalErr('PIN 必须为 4-32 位'); return; }
    if (pinA !== pinB) { setLockModalErr('两次输入不一致'); return; }
    setLockModalBusy(true); setLockModalErr(null);
    const r = await lockCtx.setupPin(pinA);
    setLockModalBusy(false);
    if (r.ok) resetLockModals();
    else setLockModalErr(r.error || '设置失败');
  };

  const handleLockChange = async () => {
    if (pinA.length < 4 || pinA.length > 32) { setLockModalErr('新 PIN 必须为 4-32 位'); return; }
    if (pinA !== pinB) { setLockModalErr('两次输入不一致'); return; }
    setLockModalBusy(true); setLockModalErr(null);
    const r = await lockCtx.changePin(pinOld, pinA);
    setLockModalBusy(false);
    if (r.ok) resetLockModals();
    else setLockModalErr(r.error || '修改失败');
  };

  const handleLockDisable = async () => {
    setLockModalBusy(true); setLockModalErr(null);
    const ok = await lockCtx.disable(pinOld);
    setLockModalBusy(false);
    if (ok) resetLockModals();
    else setLockModalErr('PIN 错误');
  };

  return (
    <>
      <section className="mb-8" data-section-id="lock" data-settings-tags="屏幕锁 锁屏 lock pin 密码 自动锁">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={18} className="text-[#07c160]" />
          <h3 className="text-base font-bold text-[#1d1d1f] dk-text">屏幕锁定</h3>
          <span className="ml-auto text-[11px] text-gray-400">快捷键 ⌘L / Ctrl+L</span>
        </div>
        <p className="text-sm text-gray-400 mb-4">临时离开时一键遮住内容 — 纯前端覆盖层，仅防肉眼偷看</p>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border space-y-5">
          {!lockCtx.enabled ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-gray-500">还未设置 PIN。设置后可用 ⌘L / Ctrl+L 快速锁屏。</p>
              <button
                onClick={() => { resetLockModals(); setLockSetupOpen(true); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold hover:bg-[#06ad56] transition-colors"
              >
                <Lock size={14} />
                设置 PIN
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-gray-700 dk-text flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[#07c160]" />
                  已启用 — 按 ⌘L / Ctrl+L 立即锁屏
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { resetLockModals(); setLockChangeOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-white/15 transition-colors"
                  >
                    修改 PIN
                  </button>
                  <button
                    onClick={() => { resetLockModals(); setLockDisableOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <Unlock size={14} />
                    关闭
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 dk-border space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="text-sm text-gray-700 dk-text">闲置多久后自动锁屏</label>
                  <select
                    value={lockCtx.autoLockMinutes}
                    onChange={async (e) => {
                      const v = Number(e.target.value) as AutoLockMinutes;
                      await lockCtx.updateSettings(v, lockCtx.lockOnStartup);
                    }}
                    className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]"
                  >
                    <option value={0}>从不自动锁</option>
                    <option value={30}>30 分钟</option>
                    <option value={60}>1 小时（默认）</option>
                    <option value={120}>2 小时</option>
                  </select>
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-700 dk-text cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={lockCtx.lockOnStartup}
                    onChange={async (e) => {
                      await lockCtx.updateSettings(lockCtx.autoLockMinutes, e.target.checked);
                    }}
                    className="mt-0.5 accent-[#07c160]"
                  />
                  <span>App 重开时默认锁定</span>
                </label>
              </div>
            </>
          )}
        </div>
      </section>

      {/* PIN 设置 modal */}
      {lockSetupOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40" onClick={resetLockModals}>
          <div className="w-full max-w-sm mx-4 rounded-3xl bg-white dark:bg-[#1d1d1f] shadow-2xl border border-gray-100 dark:border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-[#1d1d1f] dark:text-white mb-3">设置 PIN</h3>
            <p className="text-xs text-gray-400 mb-4">4-32 位，支持数字 / 字母 / 符号。忘记后需重置所有设置。</p>
            <input type="password" autoFocus value={pinA} onChange={(e) => setPinA(e.target.value)} placeholder="新 PIN" className="w-full px-4 py-3 mb-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            <input type="password" value={pinB} onChange={(e) => setPinB(e.target.value)} placeholder="再次输入" className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            {lockModalErr && <p className="mt-2 text-xs text-red-500">{lockModalErr}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={resetLockModals} className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm">取消</button>
              <button onClick={handleLockSetup} disabled={lockModalBusy} className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
                {lockModalBusy && <Loader2 size={14} className="animate-spin" />}
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改 PIN modal */}
      {lockChangeOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40" onClick={resetLockModals}>
          <div className="w-full max-w-sm mx-4 rounded-3xl bg-white dark:bg-[#1d1d1f] shadow-2xl border border-gray-100 dark:border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-[#1d1d1f] dark:text-white mb-3">修改 PIN</h3>
            <input type="password" autoFocus value={pinOld} onChange={(e) => setPinOld(e.target.value)} placeholder="当前 PIN" className="w-full px-4 py-3 mb-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            <input type="password" value={pinA} onChange={(e) => setPinA(e.target.value)} placeholder="新 PIN" className="w-full px-4 py-3 mb-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            <input type="password" value={pinB} onChange={(e) => setPinB(e.target.value)} placeholder="再次输入新 PIN" className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            {lockModalErr && <p className="mt-2 text-xs text-red-500">{lockModalErr}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={resetLockModals} className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm">取消</button>
              <button onClick={handleLockChange} disabled={lockModalBusy} className="px-4 py-2 rounded-xl bg-[#07c160] text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
                {lockModalBusy && <Loader2 size={14} className="animate-spin" />}
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 关闭 PIN modal */}
      {lockDisableOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40" onClick={resetLockModals}>
          <div className="w-full max-w-sm mx-4 rounded-3xl bg-white dark:bg-[#1d1d1f] shadow-2xl border border-gray-100 dark:border-white/10 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-[#1d1d1f] dark:text-white mb-3">关闭屏幕锁定</h3>
            <p className="text-xs text-gray-400 mb-4">输入当前 PIN 确认关闭。</p>
            <input type="password" autoFocus value={pinOld} onChange={(e) => setPinOld(e.target.value)} placeholder="当前 PIN" className="w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-white outline-none focus:border-[#07c160]" />
            {lockModalErr && <p className="mt-2 text-xs text-red-500">{lockModalErr}</p>}
            <div className="mt-5 flex gap-2 justify-end">
              <button onClick={resetLockModals} className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-sm">取消</button>
              <button onClick={handleLockDisable} disabled={lockModalBusy} className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5">
                {lockModalBusy && <Loader2 size={14} className="animate-spin" />}
                关闭锁屏
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
