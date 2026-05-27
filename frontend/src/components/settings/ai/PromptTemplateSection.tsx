import React, { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';
import { PROMPT_TEMPLATES } from '../../../utils/promptTemplates';

export const PromptTemplateSection: React.FC = () => {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/preferences').then(r => r.json()).then(d => {
      setTemplates(d?.prompt_templates ?? {});
    }).catch(() => {});
  }, []);

  const handleSave = async (id: string, value: string) => {
    setSaving(true);
    const next = { ...templates };
    if (value.trim()) {
      next[id] = value.trim();
    } else {
      delete next[id]; // 清空则恢复默认
    }
    try {
      await fetch('/api/preferences/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_templates: next }),
      });
      setTemplates(next);
      setEditingId(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    finally { setSaving(false); }
  };

  return (
    <section className="mb-8 bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 dk-card dk-border" data-section-id="prompt" data-settings-tags="prompt 模板 提示词 AI 自定义">
      <h2 className="text-lg font-black text-[#1d1d1f] dk-text mb-1 flex items-center gap-2">
        <Bot size={18} className="text-gray-400" />
        Prompt 模板
      </h2>
      <p className="text-xs text-gray-400 mb-4">自定义各 AI 功能的系统提示词。留空则使用默认值。</p>

      <div className="space-y-3">
        {PROMPT_TEMPLATES.map(t => {
          const isEditing = editingId === t.id;
          const hasCustom = !!templates[t.id];
          return (
            <div key={t.id} className="border border-gray-100 dark:border-white/10 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold dk-text">{t.name}</span>
                  {hasCustom && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-500 font-bold">已自定义</span>}
                </div>
                <button
                  onClick={() => {
                    if (isEditing) { setEditingId(null); }
                    else { setEditingId(t.id); setEditValue(templates[t.id] ?? t.defaultPrompt); }
                  }}
                  className="text-[10px] text-gray-400 hover:text-[#07c160] transition-colors"
                >
                  {isEditing ? '收起' : hasCustom ? '编辑' : '自定义'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400">{t.description}</p>
              {isEditing && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    rows={8}
                    className="w-full text-xs font-mono bg-gray-50 dark:bg-white/5 rounded-lg p-3 outline-none focus:ring-2 focus:ring-[#07c160]/30 dk-text resize-y leading-relaxed"
                    placeholder="留空则恢复默认 Prompt"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSave(t.id, editValue)}
                      disabled={saving}
                      className="px-3 py-1 bg-[#07c160] text-white text-xs font-bold rounded-lg hover:bg-[#06ad56] disabled:opacity-50 transition-colors"
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                    {hasCustom && (
                      <button
                        onClick={() => { setEditValue(t.defaultPrompt); handleSave(t.id, ''); }}
                        className="px-3 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
                      >
                        恢复默认
                      </button>
                    )}
                    <span className="text-[10px] text-gray-300">支持变量：{'{{name}}'} {'{{today}}'} {'{{rounds}}'} 等</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {saved && <p className="text-xs text-[#07c160] mt-2">✓ 已保存</p>}
    </section>
  );
};
