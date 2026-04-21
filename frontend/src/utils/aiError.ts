/**
 * 检测 AI 报错是不是「未配置 AI」。匹配后端 main.go 里的几条错误文案：
 *   - "请先在设置中配置 AI 接口"
 *   - "请先在设置中配置 API Key 或完成 Google 授权"
 *   - "请先在设置中配置日志目录"（非 AI，但同属"去设置"类）
 * 前端展示时若匹配到，可在错误旁渲染「去设置」按钮，省一次手动跳转。
 */
export function isAIConfigError(text: string): boolean {
  if (!text) return false;
  return text.includes('请先在设置中') || text.includes('请先配置 AI') || text.includes('未配置 AI');
}
