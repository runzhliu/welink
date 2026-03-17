/**
 * 格式化工具函数
 */

/**
 * 格式化数字为千分位
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('zh-CN');
};

/**
 * 格式化大数字（K, M, B）
 */
export const formatCompactNumber = (num: number): string => {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1) + 'B';
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
};

/**
 * 格式化日期
 */
export const formatDate = (dateString: string): string => {
  if (!dateString || dateString === '-') return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateString;
  }
};

/**
 * 计算天数差
 */
export const daysSince = (dateString: string): number => {
  if (!dateString) return -1;
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  } catch {
    return -1;
  }
};

/**
 * 获取联系人显示名称
 */
export const getContactDisplayName = (contact: {
  remark?: string;
  nickname?: string;
  username?: string;
}): string => {
  return contact.remark || contact.nickname || contact.username || '未知';
};
