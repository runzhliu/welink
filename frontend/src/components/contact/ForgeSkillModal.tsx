/**
 * Skill 炼化弹窗 — 把聊天记录导出为 Claude Code / Codex / OpenCode / Cursor 等工具的 Skill
 */

import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, Download, Sparkles, Info } from 'lucide-react';
import { forgeSkill, groupsApi } from '../../services/api';
import type { MemberStat } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  skillType: 'contact' | 'self' | 'group';
  username?: string;
  displayName: string;
}

interface LLMProfileItem {
  id: string;
  name: string;
  provider: string;
  model?: string;
}

type FormatKey = 'claude-skill' | 'claude-agent' | 'codex' | 'opencode' | 'cursor' | 'generic';
type GroupTargetKind = 'whole' | 'member';

const FORMATS: Array<{ key: FormatKey; name: string; description: string; icon: string }> = [
  { key: 'claude-skill', name: 'Claude Code Skill', description: '目录式，含 SKILL.md frontmatter，放到 ~/.claude/skills/', icon: '📁' },
  { key: 'claude-agent', name: 'Claude Code Subagent', description: '单文件 .md，放到 ~/.claude/agents/，可通过 @agent 调用', icon: '🤖' },
  { key: 'codex', name: 'OpenAI Codex AGENTS.md', description: '项目根 AGENTS.md，Codex CLI 自动读取', icon: '🧠' },
  { key: 'opencode', name: 'OpenCode Agent', description: '.opencode/agent/<name>.md，支持 subagent 模式', icon: '💡' },
  { key: 'cursor', name: 'Cursor Rule', description: '.cursor/rules/<name>.mdc，支持 glob 自动应用', icon: '✏️' },
  { key: 'generic', name: '通用 Markdown', description: '工具无关，可粘贴到任何 AI 对话或手动转换', icon: '📄' },
];

// 消息条数预设：默认 300 平衡质量和成本
const MSG_LIMIT_OPTIONS = [100, 300, 500, 1000, 2000];

export const ForgeSkillModal: React.FC<Props> = ({ open, onClose, skillType, username, displayName }) => {
  const [format, setFormat] = useState<FormatKey>('claude-skill');
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<LLMProfileItem[]>([]);
  const [msgLimit, setMsgLimit] = useState(300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // 群聊专用：选整个群还是某个成员
  const [groupTarget, setGroupTarget] = useState<GroupTargetKind>('whole');
  const [members, setMembers] = useState<MemberStat[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<MemberStat | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/preferences/llm').then(r => r.json()).then((d: { profiles?: LLMProfileItem[] }) => {
      if (d.profiles) setProfiles(d.profiles);
    }).catch(() => {});
  }, [open]);

  // 群聊模式下加载成员列表
  useEffect(() => {
    if (!open || skillType !== 'group' || !username) return;
    groupsApi.getDetail(username).then(d => {
      if (d && d.member_rank) {
        setMembers(d.member_rank.filter(m => m.count > 0));
      }
    }).catch(() => {});
  }, [open, skillType, username]);

  useEffect(() => {
    if (open) {
      setError(null);
      setSuccess(false);
      setGroupTarget('whole');
      setSelectedMember(null);
      setMemberSearch('');
    }
  }, [open]);

  const filteredMembers = useMemo(() => {
    if (!memberSearch) return members.slice(0, 50);
    const q = memberSearch.toLowerCase();
    return members.filter(m => m.speaker.toLowerCase().includes(q) || (m.username ?? '').toLowerCase().includes(q)).slice(0, 50);
  }, [members, memberSearch]);

  const handleForge = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      let effectiveType: 'contact' | 'self' | 'group' | 'group-member' = skillType;
      let memberSpeaker: string | undefined;
      if (skillType === 'group' && groupTarget === 'member') {
        if (!selectedMember) {
          throw new Error('请先选择一个群成员');
        }
        effectiveType = 'group-member';
        memberSpeaker = selectedMember.speaker;
      }
      const { blob, filename } = await forgeSkill({
        skill_type: effectiveType,
        username,
        member_speaker: memberSpeaker,
        format,
        profile_id: profileId || undefined,
        msg_limit: msgLimit,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message || '炼化失败');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const effectiveDisplayName =
    skillType === 'group' && groupTarget === 'member' && selectedMember
      ? `${selectedMember.speaker}（来自「${displayName}」群）`
      : displayName;

  const skillLabel =
    skillType === 'contact'
      ? '联系人风格'
      : skillType === 'self'
      ? '我的写作风格'
      : groupTarget === 'member'
      ? '群成员风格'
      : '群聊智囊';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl w-[92vw] max-w-2xl max-h-[88vh] overflow-y-auto p-6 sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-[#1d1d1f] dk-text flex items-center gap-2">
            <Sparkles size={20} className="text-[#07c160]" />
            炼化为 Skill
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="mb-5 p-4 bg-[#07c160]/5 rounded-2xl">
          <div className="flex items-start gap-3">
            <Info size={16} className="text-[#07c160] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-500 dk-text leading-relaxed">
              把 <b className="text-[#07c160]">{effectiveDisplayName}</b> 的聊天记录炼化为一个<b>{skillLabel}</b> Skill，
              让 Claude Code、Codex、Cursor 等 AI 编程工具可以直接用 TA 的语气回应。
              结果下载为 zip 文件包。
            </div>
          </div>
        </div>

        {/* 群聊：选整个群 or 某个成员 */}
        {skillType === 'group' && (
          <div className="mb-5">
            <div className="text-xs font-bold text-gray-500 dk-text mb-2">炼化目标</div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setGroupTarget('whole')}
                disabled={loading}
                className={`flex-1 p-3 rounded-2xl border-2 text-left transition-all ${
                  groupTarget === 'whole'
                    ? 'border-[#07c160] bg-[#07c160]/5'
                    : 'border-gray-100 dark:border-white/10 hover:border-gray-200'
                }`}
              >
                <div className="text-sm font-bold text-[#1d1d1f] dk-text mb-1">🌐 整个群聊</div>
                <div className="text-[10px] text-gray-400">群的集体知识、氛围和讨论主题</div>
              </button>
              <button
                onClick={() => setGroupTarget('member')}
                disabled={loading}
                className={`flex-1 p-3 rounded-2xl border-2 text-left transition-all ${
                  groupTarget === 'member'
                    ? 'border-[#07c160] bg-[#07c160]/5'
                    : 'border-gray-100 dark:border-white/10 hover:border-gray-200'
                }`}
              >
                <div className="text-sm font-bold text-[#1d1d1f] dk-text mb-1">👤 某个群友</div>
                <div className="text-[10px] text-gray-400">只炼化指定群友的说话风格</div>
              </button>
            </div>

            {groupTarget === 'member' && (
              <div>
                {selectedMember ? (
                  <div className="flex items-center gap-3 p-3 bg-[#07c160]/5 rounded-xl border border-[#07c160]/30">
                    <div className="w-8 h-8 rounded-full bg-[#07c160] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {selectedMember.speaker.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[#1d1d1f] dk-text truncate">{selectedMember.speaker}</div>
                      <div className="text-[10px] text-gray-400">{selectedMember.count.toLocaleString()} 条发言{selectedMember.username ? ` · ${selectedMember.username}` : ''}</div>
                    </div>
                    <button onClick={() => setSelectedMember(null)} className="p-1 text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      placeholder={`搜索 ${members.length} 位活跃成员…`}
                      className="w-full px-3 py-2 bg-white dk-input border border-gray-200 dk-border rounded-xl text-sm focus:outline-none focus:border-[#07c160] mb-2"
                      disabled={loading}
                    />
                    <div className="max-h-56 overflow-y-auto border border-gray-100 dk-border rounded-xl">
                      {filteredMembers.length === 0 ? (
                        <div className="text-center text-gray-300 text-xs py-6">
                          {members.length === 0 ? '正在加载成员列表…' : '未找到匹配的成员'}
                        </div>
                      ) : filteredMembers.map(m => (
                        <button
                          key={m.speaker + (m.username ?? '')}
                          onClick={() => setSelectedMember(m)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors border-b border-gray-50 dark:border-white/5 last:border-0"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#576b95] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                            {m.speaker.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="text-sm font-semibold text-[#1d1d1f] dk-text truncate">{m.speaker}</div>
                            <div className="text-[10px] text-gray-400">{m.count.toLocaleString()} 条{m.username ? ` · ${m.username}` : ''}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 消息条数选择 */}
        <div className="mb-5">
          <div className="text-xs font-bold text-gray-500 dk-text mb-2">分析的消息数</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {MSG_LIMIT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setMsgLimit(n)}
                disabled={loading}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  msgLimit === n
                    ? 'bg-[#07c160] text-white'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-500 hover:bg-gray-200 dark:hover:bg-white/20'
                }`}
              >
                最近 {n} 条
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">
            {msgLimit <= 300 && '轻量：10 秒内完成，约 5k token'}
            {msgLimit > 300 && msgLimit <= 500 && '均衡：约 15 秒，约 8k token'}
            {msgLimit > 500 && msgLimit <= 1000 && '深度：约 25 秒，约 12k token（超 1.2 万字会自动降采样）'}
            {msgLimit > 1000 && '全面：约 30 秒，超过预算的部分会均匀降采样到 1.2 万字内送入 LLM'}
          </p>
        </div>

        {/* 格式选择 */}
        <div className="mb-5">
          <div className="text-xs font-bold text-gray-500 dk-text mb-2">输出格式</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FORMATS.map(f => (
              <button
                key={f.key}
                onClick={() => setFormat(f.key)}
                disabled={loading}
                className={`text-left p-3 rounded-2xl border-2 transition-all ${
                  format === f.key
                    ? 'border-[#07c160] bg-[#07c160]/5'
                    : 'border-gray-100 dark:border-white/10 hover:border-gray-200'
                } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{f.icon}</span>
                  <span className="text-sm font-bold text-[#1d1d1f] dk-text">{f.name}</span>
                </div>
                <div className="text-[10px] text-gray-400 leading-snug">{f.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* LLM profile 选择 */}
        {profiles.length > 0 && (
          <div className="mb-5">
            <div className="text-xs font-bold text-gray-500 dk-text mb-2">使用的 AI 模型</div>
            <select
              value={profileId}
              onChange={e => setProfileId(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 bg-white dk-input border border-gray-200 dk-border rounded-xl text-sm focus:outline-none focus:border-[#07c160]"
            >
              <option value="">默认 ({profiles[0]?.provider} · {profiles[0]?.model || '—'})</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.provider} · {p.model || '—'})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* 成功提示 */}
        {success && (
          <div className="mb-4 p-3 bg-[#07c160]/5 border border-[#07c160]/30 rounded-xl text-xs text-[#07c160]">
            ✓ 炼化成功，zip 文件已开始下载。解压后按 README 说明安装到对应工具。
          </div>
        )}

        {/* 按钮 */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleForge}
            disabled={loading || (skillType === 'group' && groupTarget === 'member' && !selectedMember)}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-[#07c160] text-white hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                炼化中…
              </>
            ) : (
              <>
                <Download size={14} />
                开始炼化并下载
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
