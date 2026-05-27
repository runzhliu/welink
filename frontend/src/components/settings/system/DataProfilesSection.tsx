import React, { useState, useEffect, useCallback } from 'react';
import { Users } from 'lucide-react';
import { appApi } from '../../../services/appApi';
import { RelativeTime } from '../../common/RelativeTime';

type Profile = { id: string; name: string; path: string; last_indexed_at?: number };

export const DataProfilesSection: React.FC<{
  isAppMode: boolean;
}> = ({ isAppMode }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeDir, setActiveDir] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshProfiles = useCallback(async () => {
    try {
      const r = await appApi.listProfiles();
      setProfiles(r.profiles || []);
      setActiveDir(r.active_dir || '');
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { refreshProfiles(); }, [refreshProfiles]);

  // Docker / 浏览器模式：name + path 两个字段都让用户填
  const addProfileManual = async () => {
    const name = prompt('给数据目录起个名字（如 "主号"、"老婆账号"）');
    if (!name?.trim()) return;
    const path = prompt('decrypted/ 目录的绝对路径', activeDir);
    if (!path?.trim()) return;
    const next = [...profiles, { name: name.trim(), path: path.trim() }];
    try {
      const r = await appApi.saveProfiles(next);
      setProfiles(r.profiles);
      setProfileMsg({ ok: true, text: '已添加' });
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } } };
      setProfileMsg({ ok: false, text: anyE?.response?.data?.error || '添加失败' });
    }
  };

  const removeProfile = async (id: string) => {
    if (!confirm('确定移除这个数据目录？只是从列表里删除，磁盘文件不会动。')) return;
    const next = profiles.filter(p => p.id !== id);
    try {
      const r = await appApi.saveProfiles(next);
      setProfiles(r.profiles);
    } catch { /* ignore */ }
  };

  const switchToProfile = async (id: string) => {
    setSwitchingId(id);
    setProfileMsg(null);
    try {
      const r = await appApi.switchProfile(id);
      if (r.error) {
        setProfileMsg({ ok: false, text: r.error });
      } else {
        setActiveDir(r.active_dir || '');
        setProfileMsg({ ok: true, text: '切换成功，正在重新索引…' });
        // 切换后清空 hasStarted，让用户看到 InitializingScreen 的进度
        localStorage.removeItem('welink_hasStarted');
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (e: unknown) {
      const anyE = e as { response?: { data?: { error?: string } } };
      setProfileMsg({ ok: false, text: anyE?.response?.data?.error || '切换失败' });
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <section className="mb-8" data-section-id="profiles" data-settings-tags="数据目录 多账号 profile 切换 decrypted path 目录">
      <div className="flex items-center gap-2 mb-3">
        <Users size={18} className="text-[#07c160]" />
        <h3 className="text-base font-bold text-[#1d1d1f] dk-text">数据目录 · 多账号切换</h3>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        {isAppMode
          ? '把多个 decrypted/ 目录加入列表，就能在不同账号之间切换（无需重启）'
          : '把多个挂载在容器内的 decrypted 目录加入列表（要求 Docker 同时挂载它们）'}
      </p>
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 dk-card dk-border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-[#1d1d1f] dk-text">已保存的数据目录</span>
          <button
            onClick={addProfileManual}
            className="text-xs text-[#07c160] hover:underline"
          >
            + 添加目录
          </button>
        </div>
        {profiles.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">尚无 profile，点击右上角添加</p>
        ) : (
          <div className="space-y-1.5">
            {profiles.map(p => {
              const active = p.path === activeDir;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
                    active
                      ? 'border-[#07c160]/40 bg-[#07c160]/5'
                      : 'border-gray-100 bg-[#f8f9fb] dk-bg-soft'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#1d1d1f] dk-text truncate">{p.name}</span>
                      {active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#07c160] text-white font-bold">使用中</span>}
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">{p.path}</div>
                    {p.last_indexed_at ? (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        最近索引：<RelativeTime ts={p.last_indexed_at} />
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => switchToProfile(p.id)}
                    disabled={active || switchingId !== null}
                    className="text-xs text-[#07c160] hover:underline disabled:opacity-30 disabled:no-underline whitespace-nowrap"
                  >
                    {switchingId === p.id ? '切换中…' : active ? '当前' : '切换到'}
                  </button>
                  <button
                    onClick={() => removeProfile(p.id)}
                    disabled={active}
                    className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-30 whitespace-nowrap"
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {profileMsg && (
          <p className={`mt-2 text-xs ${profileMsg.ok ? 'text-[#07c160]' : 'text-red-500'}`}>{profileMsg.text}</p>
        )}
      </div>
    </section>
  );
};
