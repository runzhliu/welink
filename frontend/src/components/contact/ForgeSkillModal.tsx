/**
 * Skill 炼化弹窗 — 把聊天记录导出为 Claude Code / Codex / OpenCode / Cursor 等工具的 Skill
 */

import React, { useState, useEffect } from 'react';
import { X, Loader2, Download, Sparkles, Info } from 'lucide-react';
import { forgeSkill } from '../../services/api';

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

const FORMATS: Array<{ key: FormatKey; name: string; description: string; icon: string }> = [
  { key: 'claude-skill', name: 'Claude Code Skill', description: '目录式，含 SKILL.md frontmatter，放到 ~/.claude/skills/', icon: '📁' },
  { key: 'claude-agent', name: 'Claude Code Subagent', description: '单文件 .md，放到 ~/.claude/agents/，可通过 @agent 调用', icon: '🤖' },
  { key: 'codex', name: 'OpenAI Codex AGENTS.md', description: '项目根 AGENTS.md，Codex CLI 自动读取', icon: '🧠' },
  { key: 'opencode', name: 'OpenCode Agent', description: '.opencode/agent/<name>.md，支持 subagent 模式', icon: '💡' },
  { key: 'cursor', name: 'Cursor Rule', description: '.cursor/rules/<name>.mdc，支持 glob 自动应用', icon: '✏️' },
  { key: 'generic', name: '通用 Markdown', description: '工具无关，可粘贴到任何 AI 对话或手动转换', icon: '📄' },
];

export const ForgeSkillModal: React.FC<Props> = ({ open, onClose, skillType, username, displayName }) => {
  const [format, setFormat] = useState<FormatKey>('claude-skill');
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<LLMProfileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 加载 LLM profiles（允许用户选择用哪个模型炼化）
    fetch('/api/preferences/llm').then(r => r.json()).then((d: { profiles?: LLMProfileItem[] }) => {
      if (d.profiles) setProfiles(d.profiles);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open) { setError(null); setSuccess(false); }
  }, [open]);

  const handleForge = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const { blob, filename } = await forgeSkill({
        skill_type: skillType,
        username,
        format,
        profile_id: profileId || undefined,
      });
      // 触发下载
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

  const skillLabel = skillType === 'contact' ? '联系人风格' : skillType === 'self' ? '我的写作风格' : '群聊智囊';
  const costHint = skillType === 'group' ? '约 8-15k token' : '约 5-10k token';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1d1d1f] rounded-3xl shadow-2xl w-[92vw] max-w-2xl max-h-[88vh] overflow-y-auto p-6 sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-[#1d1d1f] dk-text flex items-center gap-2">
            <Sparkles size={20} className="text-[#8b5cf6]" />
            炼化为 Skill
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="mb-5 p-4 bg-[#8b5cf6]/5 rounded-2xl">
          <div className="flex items-start gap-3">
            <Info size={16} className="text-[#8b5cf6] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-500 dk-text leading-relaxed">
              把 <b className="text-[#8b5cf6]">{displayName}</b> 的聊天记录炼化为一个<b>{skillLabel}</b> Skill，
              让 Claude Code、Codex、Cursor 等 AI 编程工具可以直接用 TA 的语气回应。
              整个过程会调用一次 LLM（{costHint}），结果下载为 zip 文件包。
            </div>
          </div>
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
                    ? 'border-[#8b5cf6] bg-[#8b5cf6]/5'
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
              className="w-full px-3 py-2 bg-white dk-input border border-gray-200 dk-border rounded-xl text-sm focus:outline-none focus:border-[#8b5cf6]"
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
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-xs text-[#07c160]">
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
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-[#8b5cf6] text-white hover:bg-[#7c3aed] disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                炼化中… 可能需要 10-30 秒
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
