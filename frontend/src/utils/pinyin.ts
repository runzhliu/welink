/**
 * 拼音模糊匹配工具（基于 tiny-pinyin）。
 *
 * 为每条联系人 / 群聊产生三种可匹配字符串：
 *   - raw    原始名称（小写）
 *   - full   全拼（如 "zhangwei"）
 *   - initial 首字母（如 "zw"）
 *
 * 查询时按"全部小写 + startsWith / includes"判断。
 * tiny-pinyin 的查表只覆盖常用字，生僻字会原样留在 full 里，不影响 startsWith 语义。
 */
import TinyPinyin from 'tiny-pinyin';

export interface PinyinIndex {
  raw: string;
  full: string;
  initial: string;
}

// 缓存防止同一个名字被多次 parse（联系人列表列重复渲染时很常见）
const cache = new Map<string, PinyinIndex>();

export function buildPinyinIndex(text: string): PinyinIndex {
  const lower = (text || '').toLowerCase();
  const cached = cache.get(lower);
  if (cached) return cached;

  const tokens = TinyPinyin.parse(text || '');
  const fullParts: string[] = [];
  const initialParts: string[] = [];
  for (const t of tokens) {
    if (t.type === 2) { // 汉字 → 有 target
      const py = t.target.toLowerCase();
      fullParts.push(py);
      if (py.length > 0) initialParts.push(py[0]);
    } else if (t.type === 1) { // 非汉字
      fullParts.push(t.target);
      // 连续英文字母当作整体，不切成每个字母；但判断首字母时用首字符
      if (/[a-zA-Z]/.test(t.target)) {
        initialParts.push(t.target.toLowerCase());
      }
    }
  }
  const idx: PinyinIndex = {
    raw: lower,
    full: fullParts.join('').toLowerCase(),
    initial: initialParts.join('').toLowerCase(),
  };
  cache.set(lower, idx);
  return idx;
}

/** 模糊匹配：query（小写）命中 raw / full / initial 任一即算匹配。 */
export function matchPinyin(idx: PinyinIndex, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return idx.raw.includes(q) || idx.full.includes(q) || idx.initial.includes(q);
}
