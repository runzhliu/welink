type DiagnosticStatus = 'ok' | 'warn' | 'error' | 'skipped';

export interface DiagnosticReportData {
  generated_at: string;
  data_dir: { status: string; warnings?: string[] };
  index: { status: string; is_initialized: boolean; is_indexing: boolean; total_cached: number; last_error?: string };
  llm_profiles: { status: string }[];
  disk: { status: string };
}

const label = (value: string) => {
  switch (value as DiagnosticStatus) {
    case 'ok': return '正常';
    case 'warn': return '需留意';
    case 'error': return '异常';
    case 'skipped': return '未检查';
    default: return '未知';
  }
};

// Allowlist only fixed labels and numeric/boolean state. Error messages,
// profile names, paths and URLs can contain user data or credentials.
export function diagnosticReportMarkdown(d: DiagnosticReportData): string {
  const profiles = Array.isArray(d.llm_profiles) ? d.llm_profiles : [];
  const counts = (['ok', 'warn', 'error', 'skipped'] as const)
    .map(status => `${label(status)} ${profiles.filter(p => p.status === status).length}`)
    .join('、');
  const total = Number.isFinite(d.index.total_cached) ? Math.max(0, Math.floor(d.index.total_cached)) : 0;
  const warnings = Array.isArray(d.data_dir.warnings) ? d.data_dir.warnings.length : 0;
  return [
    '# WeLink 诊断报告',
    '',
    '本报告不包含目录路径、错误原文、模型名称、服务地址或聊天内容。',
    '',
    `- 数据目录：${label(d.data_dir.status)}（${warnings} 条提示）`,
    `- 索引：${label(d.index.status)}；已初始化 ${d.index.is_initialized ? '是' : '否'}；正在索引 ${d.index.is_indexing ? '是' : '否'}；已缓存 ${total}`,
    `- 索引错误：${d.index.last_error ? '存在，详情已省略' : '无'}`,
    `- 模型配置：${profiles.length} 个（${counts}）`,
    `- 磁盘：${label(d.disk.status)}`,
  ].join('\n');
}
