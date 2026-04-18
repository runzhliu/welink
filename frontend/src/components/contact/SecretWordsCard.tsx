/**
 * 秘语雷达 —— 某联系人相对"活跃联系人池"的 TF-IDF Top 5。
 * 展示"只有和 TA 才特别爱说的词"：昵称 / 共同人物 / 内部梗 / 专业术语。
 * 调 GET /api/contacts/secret-words?username=...
 */

import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import axios from 'axios';

interface SecretWord { word: string; count: number; df: number; score: number }

interface Props {
  username: string;
  className?: string;
}

export const SecretWordsCard: React.FC<Props> = ({ username, className = '' }) => {
  const [words, setWords] = useState<SecretWord[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get<{ words: SecretWord[] }>('/api/contacts/secret-words', { params: { username } })
      .then(r => { if (!cancelled) { setWords(r.data.words || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setWords([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [username]);

  // 前 50 活跃联系人的池里从来没有此词 → 最私密
  // 池里一半以上联系人都有 → 其实是常见词（idf 本就被拉到接近 0，不会入 Top，这里只是展示用）
  const privacyLevel = (df: number, total: number = 50): string => {
    if (df === 0) return '只和 TA';
    if (df <= 2) return `和 ${df + 1} 人`;
    return `和 ${df + 1} 人 / ${total}`;
  };

  return (
    <div className={`dk-subtle dk-border bg-[#f8f9fb] border border-gray-100 p-5 rounded-[28px] ${className}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles size={12} className="text-[#8b5cf6]" />
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">秘语雷达 · TF-IDF</p>
      </div>
      <p className="text-[10px] text-gray-400 mb-3">跟 TA 聊得比和其他人都多的词（昵称 / 梗 / 专属话题）</p>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          <span>首次计算需扫描 Top 50 联系人词云，后续会命中缓存</span>
        </div>
      ) : !words || words.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">这段关系的词还没拉开显著差异</p>
      ) : (
        <div className="space-y-1.5">
          {words.map((w, i) => (
            <div key={w.word} className="flex items-center gap-2">
              <span className="text-xs font-black text-[#8b5cf6] w-5 tabular-nums">#{i + 1}</span>
              <span className="text-sm font-bold text-[#1d1d1f] dk-text flex-1 truncate">{w.word}</span>
              <span className="text-[10px] text-gray-400 tabular-nums">{w.count} 次</span>
              <span className="text-[10px] text-gray-300 tabular-nums">{privacyLevel(w.df)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
