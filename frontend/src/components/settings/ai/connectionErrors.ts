// Error categories are hints, not definitive diagnoses. Never echo gateway
// responses here: they may contain credentials or private endpoint details.
export function connectionErrorHint(message: string): string {
  const text = message.toLowerCase();
  if (/401|unauthori[sz]ed|invalid.?api.?key|未配置 api key|授权/.test(text)) return '认证未通过：请检查 API Key、网关密钥或登录授权。';
  if (/403|forbidden|permission|权限/.test(text)) return '访问被拒绝：请检查账号权限、模型权限及服务商限制。';
  if (/429|quota|rate.?limit|额度|限流/.test(text)) return '请求受限：请检查服务商额度或限流状态，稍后重试。';
  if (/404|not found|model.*not|模型不存在/.test(text)) return '未找到接口或模型：请检查 Base URL 和模型名。';
  if (/base url|未配置模型|网关地址/.test(text)) return '配置不完整：请检查 Base URL 和模型名。';
  if (/timeout|timed out|deadline|超时/.test(text)) return '连接超时：请检查网络、代理以及模型服务是否正在运行。';
  if (/connect|refused|network|网络|请求失败|无法连接|eof|dns/.test(text)) return '连接失败：请检查服务地址、网络和代理；Docker 中的 localhost 指向容器本身。';
  return '连接测试失败：请检查模型、地址、认证信息及服务商状态。';
}
