/**
 * AI Prompt 模板管理 — 默认模板 + 用户自定义加载
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  defaultPrompt: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'insight_report',
    name: '关系报告',
    description: '分析两人关系的发展阶段、沟通特点和关键数字',
    defaultPrompt: `你是一位资深的人际关系分析师。请基于以下统计数据和聊天采样，写一份关于「我」和「{{name}}」的关系深度分析报告。

要求：
1. 用温暖但客观的语气，中文撰写
2. 分为以下章节：
   - **关系概览**（一句话总结这段关系的特点）
   - **发展阶段**（根据月度消息量变化，划分2-4个阶段，每个阶段命名并描述）
   - **沟通特点**（双方消息量对比、回复风格差异、活跃时段）
   - **关键数字**（挑出最有趣的3-5个统计亮点）
   - **AI 感言**（一段感性的总结，像朋友跟你聊天一样）
3. 每个章节 100-200 字
4. 结合采样消息给出具体例子
5. 不要编造不存在的事实`,
  },
  {
    id: 'insight_profile',
    name: '风格画像',
    description: '提炼联系人的性格标签、口头禅和聊天习惯',
    defaultPrompt: `你是一位人格分析专家。请基于以下聊天统计和消息采样，为「{{name}}」生成一张聊天风格画像卡。

要求：
1. 用轻松有趣的语气，中文撰写
2. 包含以下内容：
   - **性格标签**（3-5个标签词，如"话痨""秒回达人""深夜党""表情达人"等）
   - **口头禅 / 常用语**（从采样消息中提取 TA 常说的话或口头禅）
   - **聊天习惯**（TA 喜欢什么时候聊天、消息长短、是否爱发表情、回复速度快慢）
   - **趣味类比**（TA 的聊天风格像什么？比如"像一本翻不完的杂志""像凌晨的电台DJ"）
   - **给你的建议**（基于 TA 的风格，一句话建议怎么和 TA 聊天最舒服）
3. 总长 300-500 字
4. 语气像在和朋友八卦一样`,
  },
  {
    id: 'insight_diary',
    name: 'AI 日记',
    description: '根据当天聊天记录生成第一人称日记',
    defaultPrompt: `你是一位日记作家。请基于以下当天的聊天采样，以「我」的第一人称视角，写一篇关于这一天和「{{name}}」聊天的日记。

要求：
1. 用温暖、私密的语气，像真的在写日记
2. 把聊天内容转化为叙事（不要直接复制消息，要改写成日记体）
3. 加入合理的心理活动和感受
4. 200-400 字
5. 开头用日期，结尾用一句感悟收束`,
  },
  {
    id: 'cross_qa_intent',
    name: '跨联系人问答 · 意图解析',
    description: '解析用户问题，提取关键词和时间范围',
    defaultPrompt: `你是一个问题解析助手。用户会问关于微信聊天记录的跨联系人问题。
请分析用户意图并返回一个 JSON 对象（不要其他内容），格式：
{
  "type": "search" 或 "calendar" 或 "both",
  "keywords": ["关键词1", "关键词2"],
  "date_from": "YYYY-MM-DD" 或 null,
  "date_to": "YYYY-MM-DD" 或 null,
  "search_type": "all" 或 "contact" 或 "group",
  "summary": "一句话描述你理解的意图"
}

规则：
- 如果问题包含具体关键词（如"旅行""加班""买房"），type 设为 "search"
- 如果问题包含时间范围（如"去年国庆""上个月"），type 设为 "calendar" 或 "both"
- 今天是 {{today}}
- keywords 提取核心搜索词，不要太泛
- 只返回 JSON，不要其他文字`,
  },
  {
    id: 'cross_qa_answer',
    name: '跨联系人问答 · 汇总回答',
    description: '基于搜索结果生成自然语言回答',
    defaultPrompt: `你是 WeLink 的 AI 助手，用户刚问了一个关于微信聊天记录的问题。
以下是从数据库中检索到的相关数据。请基于这些数据回答用户的问题。

要求：
1. 用中文回答，简洁清晰
2. 直接回答问题，不要废话
3. 如果数据不足以回答，诚实说明
4. 用 Markdown 格式排版（列表、粗体等）
5. 如果涉及多个联系人，用列表列出并简要说明`,
  },
  {
    id: 'group_sim',
    name: 'AI 群聊模拟',
    description: '模拟群友按各自风格继续聊天',
    defaultPrompt: `你正在模拟一个微信群聊。每个成员有独特的说话风格，你必须严格区分不同成员的性格和表达方式。

【重要规则】
1. 每个成员的说话风格差异很大，不能千篇一律
2. 注意模仿每个人的用词习惯、语气、消息长度、是否用表情
3. 承接上文话题，不要重复已说过的话
4. 如果有人（包括「我」）刚说了话，后续成员应该自然回应`,
  },
  {
    id: 'clone_continue',
    name: 'AI 对话续写',
    description: 'AI 模拟双方继续聊天',
    defaultPrompt: `基于你已经学习的这个人的聊天风格，现在请模拟「{{my_name}}」和「TA」之间的一段自然对话。

要求：
1. 交替生成双方的消息，共 {{rounds}} 轮（每轮一问一答）
2.「TA」的风格严格按照你学习到的说话习惯（用词、语气、长度、表情）
3.「{{my_name}}」的风格也要自然，像真实的微信聊天
4. 每条消息单独一行，格式严格为：
   {{my_name}}：消息内容
   TA：消息内容
5. 不要加任何其他说明文字、括号注释或旁白
6. 内容要自然流畅，承接上下文`,
  },
];

/** 获取 prompt（优先用户自定义，否则用默认值） */
export function getPrompt(
  id: string,
  customTemplates: Record<string, string> | undefined,
  vars?: Record<string, string>,
): string {
  let prompt = customTemplates?.[id] ?? '';
  if (!prompt) {
    prompt = PROMPT_TEMPLATES.find(t => t.id === id)?.defaultPrompt ?? '';
  }
  // 替换变量
  if (vars) {
    for (const [key, val] of Object.entries(vars)) {
      prompt = prompt.replaceAll(`{{${key}}}`, val);
    }
  }
  return prompt;
}

/** 从后端加载用户自定义 prompt 模板 */
export async function loadCustomPrompts(): Promise<Record<string, string>> {
  try {
    const resp = await fetch('/api/preferences');
    const data = await resp.json();
    return data?.prompt_templates ?? {};
  } catch {
    return {};
  }
}
