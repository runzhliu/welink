---
title: 全部功能
description: WeLink 的完整功能清单 —— AI 能力 / 数据分析 / 关系预测 / 数据能力 / 平台能力 / 使用技巧
---

# 全部功能

> 首页只挑了最具代表性的九宫格。这里是完整清单，按领域分组。

<style>
.feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
@media (max-width: 768px) { .feat-grid { grid-template-columns: 1fr; } }
.feat-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 20px;
  background: var(--vp-c-bg-soft);
}
.feat-card h4 { margin: 8px 0 4px; font-size: 15px; }
.feat-card p { font-size: 13px; color: var(--vp-c-text-2); line-height: 1.6; margin: 0; }
.feat-card .icon { font-size: 24px; }
.feat-section-title {
  font-size: 18px;
  font-weight: 800;
  margin: 32px 0 8px;
  padding-top: 12px;
  color: var(--vp-c-brand-1);
  border-top: 2px solid var(--vp-c-divider);
}
.feat-section-title:first-of-type { border-top: 0; padding-top: 0; }
</style>

<div class="feat-section-title">🤖 AI 功能</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">🪞</div><h4>AI 分身</h4><p>让 AI 学习任何联系人的聊天风格，模拟和 TA 对话。追忆远方的亲人、重逢失联的老友 —— TA 会用 TA 的方式回应你。</p></div>
<div class="feat-card"><div class="icon">👥</div><h4>AI 群聊模拟</h4><p>AI 按群友发言比例和风格模拟群聊，你也可以随时加入。支持自定义话题、氛围和参与成员。</p></div>
<div class="feat-card"><div class="icon">🌐</div><h4>跨联系人 AI 问答</h4><p>问「谁聊过旅行」「去年国庆和谁聊天了」，AI 自动搜索所有记录并汇总回答。Agent 模式。</p></div>
<div class="feat-card"><div class="icon">📝</div><h4>AI 洞察</h4><p>一键生成关系报告、性格画像卡、AI 日记。基于统计摘要+采样，每次约 5k token。</p></div>
<div class="feat-card"><div class="icon">🤖</div><h4>AI 对话分析</h4><p>针对任意联系人或群聊直接提问，AI 读完聊天记录再回答，不是搜索框。</p></div>
<div class="feat-card"><div class="icon">🔀</div><h4>混合检索（RAG）</h4><p>FTS5 全文检索 + 语义向量检索双引擎并行，精准召回相关消息片段作为上下文。</p></div>
<div class="feat-card"><div class="icon">🧠</div><h4>记忆提炼</h4><p>LLM 批量提炼关键事实（人名、事件、情感节点）持久化存储，让 AI 拥有长期记忆。</p></div>
<div class="feat-card"><div class="icon">🔮</div><h4>Skill 炼化</h4><p>把聊天记录炼化为 Claude Code / Codex / Cursor 等 AI 工具的 Skill 文件包。3 种类型 × 6 种格式。</p></div>
<div class="feat-card"><div class="icon">🎙️</div><h4>AI 播客</h4><p>挑一位联系人，AI 把关系历程写成双人对话播客脚本，A/B 两位主持人 + TTS 一键合成 MP3，可下载分享。</p></div>
<div class="feat-card"><div class="icon">✏️</div><h4>自定义 Prompt</h4><p>所有 AI 功能（分析 / 分身 / 洞察 / 播客 / 破冰）的 System Prompt 完全透明可编辑，支持变量替换。</p></div>
<div class="feat-card"><div class="icon">💓</div><h4>情感曲线</h4><p>LLM 无关的情感词典打分，把任意联系人的对话情感倾向沿时间画出曲线，识别关系情绪波动。</p></div>
</div>

<div class="feat-section-title">📊 数据分析</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">💬</div><h4>群聊分析 + 小团体检测</h4><p>成员排行、趋势图、词云、力导向关系图自动识别小圈子。潜水成员检测 + 按发言人搜索导出。</p></div>
<div class="feat-card"><div class="icon">⏱️</div><h4>回复节奏分析</h4><p>双向对比回复速度、分时段柱状图、消息间隔分布、聊天密度曲线判断关系升温或降温。</p></div>
<div class="feat-card"><div class="icon">🪞</div><h4>谁最像谁</h4><p>18 维特征向量 + 余弦相似度，找到说话最像的两个人，展示共同高频词。</p></div>
<div class="feat-card"><div class="icon">🧧</div><h4>红包 / 转账总览</h4><p>全局 KPI + 月度趋势 + 联系人排行，细分发红包/收红包/发转账/收转账四方向。</p></div>
<div class="feat-card"><div class="icon">👤</div><h4>个人自画像</h4><p>汇总「我」的发言指纹：活跃时段、常联系的人、24h 分布、社交广度曲线。</p></div>
<div class="feat-card"><div class="icon">🌐</div><h4>共同社交圈</h4><p>选两个联系人，基于共同群聊推测共同朋友圈，多群共现意味着关系更紧密。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>群聊活跃度对比</h4><p>同时选中多个群对比消息量、成员数、日均消息、人均消息。</p></div>
<div class="feat-card"><div class="icon">💕</div><h4>群内「我的 CP」</h4><p>扫引用消息（refermsg）列出跟我双向引用互动最多的成员 Top 3。比 @ 或消息数更能识别隐形聊友。</p></div>
<div class="feat-card"><div class="icon">📈</div><h4>群聊列表四维</h4><p>每行带上我的排名 / 占比 / 近 30 天消息 / 活跃趋势箭头，以及我自己的最后发言时间，区分「群还活着但我潜水了」vs「整个群都沉了」。</p></div>
<div class="feat-card"><div class="icon">🎬</div><h4>群聊回放播放器</h4><p>按最近 N 条 / 日期范围加载群消息，6 档倍速按真实时间间隔回放，同发言人合并头像 + 日期分割线。</p></div>
<div class="feat-card"><div class="icon">⚡</div><h4>群号称卡</h4><p>规则派生 2-4 条群 MBTI 标签：深夜话唠 / 工作日正午群 / 表情包战场 / 链接集散地 / 红包雨 / 潜水员联盟 等。零 LLM。</p></div>
<div class="feat-card"><div class="icon">🕐</div><h4>时钟指纹</h4><p>7×24 热图徽章，log 压缩着色。一眼识别工作群作息 / 深夜局 / 周末亲友群三种完全不同的"群人格"。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>群影响力指数</h4><p>我发言后 30 分钟内有人回应的比例 vs 群基线，0-100 分。看你在哪个群更"中心"。</p></div>
<div class="feat-card"><div class="icon">📖</div><h4>AI 群年报</h4><p>Wrapped 风格分页：年度概览 / 话痨榜 / AI 精选 3 条金句（原文） / 月度柱状图 / 60-100 字年度叙事。</p></div>
</div>

<div class="feat-section-title">🎲 趣味统计</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">⏰</div><h4>陪伴时长</h4><p>按 session 粒度（消息间隔 &lt; 阈值算同一会话）累计和每个联系人的真实对话时长，找出"你在谁身上花的时间最多"。</p></div>
<div class="feat-card"><div class="icon">👻</div><h4>鬼月检测</h4><p>自动识别熟络后突然"蒸发"的联系人：单月消息骤降 ≥ 80% 且之后无恢复，标注出具体月份。</p></div>
<div class="feat-card"><div class="icon">📖</div><h4>词年鉴</h4><p>按年展示"我"最常用的词：冠军词 + 亚军 + 首次出现时间，像年度词云 summary。</p></div>
<div class="feat-card"><div class="icon">🌙</div><h4>深夜 TOP 5</h4><p>凌晨 2-4 点我发消息后最常秒回的联系人 Top 5，识别"真正的夜猫子队友"。</p></div>
<div class="feat-card"><div class="icon">🪞</div><h4>最像我的人</h4><p>基于我的平均对话基线，找出聊天风格最接近我的联系人 Top 5，佐证"物以类聚"。</p></div>
<div class="feat-card"><div class="icon">🎉</div><h4>0 天里程碑</h4><p>累计消息数逼近 10000 / 20000 / 50000 等整数里程碑时，首页 banner 提醒庆祝。</p></div>
</div>

<div class="feat-section-title">💕 关系动态预测</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">🌡️</div><h4>4 档状态判定</h4><p>最近 3 月 vs 前 3 月消息节奏对比，自动打档：升温 / 稳定 / 降温 / 濒危。</p></div>
<div class="feat-card"><div class="icon">📌</div><h4>建议主动联系</h4><p>AI 首页 Top 5 降温 / 濒危联系人卡片，点卡直接打开详情。「今日不再提醒」按日期关闭。</p></div>
<div class="feat-card"><div class="icon">🪄</div><h4>AI 开场白草稿</h4><p>降温联系人一键生成 4 条不同调性破冰开场白（关心 / 回忆 / 调侃 / 约见），复制粘到微信。</p></div>
<div class="feat-card"><div class="icon">📉</div><h4>多维信号</h4><p>不只看消息数：主动占比趋势 + 响应时延变慢 + 连续冷却周数，识别"到底谁在疏远谁"。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>12 月折线大图</h4><p>点 sparkline 弹 modal：柱状图 + 峰值标注 + 主动占比双进度条 + 响应时延对比。</p></div>
<div class="feat-card"><div class="icon">📬</div><h4>每周变化摘要</h4><p>首页 banner 对比上次快照：「近 7 天变化：3 位关系降温 · 1 位回暖」。按 ISO 周关闭。</p></div>
</div>

<div class="feat-section-title">🛠️ 数据能力</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">📦</div><h4>导出中心 · 8 种目标</h4><p>笔记平台（Markdown / Notion / 飞书）+ 云盘对象存储（WebDAV / S3 兼容 / Dropbox / Google Drive / OneDrive）。OAuth 类目标支持一键授权 + token 自动刷新。</p></div>
<div class="feat-card"><div class="icon">💬</div><h4>自然语言查数据</h4><p>「我和老婆的第一条消息是什么时候」等中文问题，LLM 自动写 SQL（严格限 SELECT/PRAGMA + LIMIT 50）并执行。支持跨库联系人查询模式。</p></div>
<div class="feat-card"><div class="icon">📐</div><h4>SQL 四件套</h4><p>10 个预置模板 + 结果一键画图（柱状/折线自动识别）+ 磁盘占用环形饼图 + 执行历史 / 收藏。</p></div>
<div class="feat-card"><div class="icon">🎂</div><h4>今天的纪念日 banner</h4><p>AI 首页顶部聚合 4 类命中：认识 N 周年 / 检测生日 / 0 天里程碑 / 自定义。</p></div>
</div>

<div class="feat-section-title">🤝 MCP Server × AI 生态</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">🛠️</div><h4>20 个 MCP 工具</h4><p>原生 MCP 协议 Server：get_contact_stats / detail / wordcloud / sentiment / messages / get_groups / ... 覆盖全部只读查询接口。<a href="/mcp-server">查看完整列表 →</a></p></div>
<div class="feat-card"><div class="icon">💻</div><h4>Claude Code 集成</h4><p>一行 <code>claude mcp add welink ...</code> 把聊天数据接进 Claude Code，让 AI 助手能直接查你的微信统计。<a href="/mcp-clients">接入指南 →</a></p></div>
<div class="feat-card"><div class="icon">🧑‍💻</div><h4>Codex / Cursor / OpenCode</h4><p>同一份 MCP Server 还能直连 Codex CLI、Cursor、OpenCode 等支持 MCP 协议的 AI 工具，配置一次全家通。</p></div>
<div class="feat-card"><div class="icon">🤖</div><h4>ChatGPT Custom GPT</h4><p>把 WeLink 数据通过 OpenAPI 桥接暴露给 ChatGPT，做一个能读你微信数据的 Custom GPT。<a href="/chatgpt-gpt">配置教程 →</a></p></div>
<div class="feat-card"><div class="icon">📝</div><h4>Obsidian Frontmatter 导出</h4><p>导出中心的 Markdown 格式自动加 Obsidian 友好的 frontmatter（date / contact / tags），粘进 Vault 立刻变成图谱节点。</p></div>
<div class="feat-card"><div class="icon">🔮</div><h4>Skill 炼化 × 6 格式</h4><p>同一联系人聊天风格一键导出为 Claude Code Skill / Claude Agent / Codex AGENTS.md / OpenCode Agent / Cursor Rules / 通用 Skill 六种格式。</p></div>
</div>

<div class="feat-section-title">🎮 Demo 模式</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">⚡</div><h4>零数据即刻体验</h4><p><code>docker compose -f docker-compose.demo.yml up</code> 一条命令起一个预置阿森纳 2025/26 球员聊天数据的 demo 环境，任何人都能立即点开试玩。</p></div>
<div class="feat-card"><div class="icon">🔒</div><h4>Demo 默认锁 AI 配置</h4><p>demo 环境下 AI 配置不允许修改（防公有云部署被滥用填 API Key），所有 AI 功能走预置 mock 数据：记忆事实、RAG 索引、分身人设、播客脚本、破冰话术全部开箱即用。</p></div>
<div class="feat-card"><div class="icon">🌍</div><h4>公开 Demo 站点</h4><p>不想装 Docker 也能试 —— <a href="https://demo.welink.click">demo.welink.click</a> 托管了一份在线 Demo，连测试数据都不用自己生成。</p></div>
</div>

<div class="feat-section-title">🔧 平台能力</div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">🔗</div><h4>链接收藏夹</h4><p>自动扫描所有聊天中的链接，按域名聚合，支持搜索和 CSV 导出。</p></div>
<div class="feat-card"><div class="icon">🔍</div><h4>全局搜索</h4><p>跨联系人与群聊搜索，关键词高亮，热门推荐，点击消息弹出当天完整对话。</p></div>
<div class="feat-card"><div class="icon">🎬</div><h4>聊天回放</h4><p>选择联系人和时间范围，按真实时间间隔回放聊天记录，6 档倍速控制。</p></div>
<div class="feat-card"><div class="icon">📅</div><h4>年度社交回顾</h4><p>Spotify Wrapped 风格，分页卡片展示年度 Top5、活跃月、深夜时光、新朋友。</p></div>
<div class="feat-card"><div class="icon">✏️</div><h4>自定义 Prompt</h4><p>所有 AI 功能的 System Prompt 完全透明可编辑，支持变量替换。</p></div>
<div class="feat-card"><div class="icon">🖥️</div><h4>多平台支持</h4><p>Docker + macOS App + Windows App + MCP Server（Claude Code 集成）。</p></div>
</div>

<div class="feat-section-title">⚡ 使用技巧 <a href="/ux" style="font-size:12px;font-weight:500;color:var(--vp-c-brand-1);text-decoration:underline;margin-left:8px;">完整说明 →</a></div>

<div class="feat-grid">
<div class="feat-card"><div class="icon">⌨️</div><h4>命令面板（⌘K）</h4><p>任意页面按 ⌘K 搜索联系人、群聊、AI 对话历史，触发备份 / 诊断 / 刷新索引等动作。空查询展示最近打开。</p></div>
<div class="feat-card"><div class="icon">🔢</div><h4>⌘1..⌘9 Tab 快捷键</h4><p>一键跳转到任意主 Tab：⌘1 首页 · ⌘2 统计 · ⌘3 联系人 · ⌘4 群聊 · ⌘5 搜索 · ⌘6 时间线 · ⌘7 日历 · ⌘8 Skills · ⌘9 设置。</p></div>
<div class="feat-card"><div class="icon">🩺</div><h4>一键诊断</h4><p>设置页 → 诊断：数据目录健康 / 索引状态 / LLM 探活 / 磁盘占用。右上角可复制为 Markdown 直接贴 issue。</p></div>
<div class="feat-card"><div class="icon">💾</div><h4>AI 数据备份 / 恢复</h4><p>Skills、聊天历史、记忆一键导出为 .db 快照（VACUUM INTO，自洽无损）。换机 / 重装前先备份，不会丢 AI 工作。</p></div>
<div class="feat-card"><div class="icon">👥</div><h4>多账号快速切换</h4><p>把多个 decrypted/ 目录作为 profile 保存，下拉切换即热替换，无需重启。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>真实索引进度</h4><p>初始化屏幕显示真实进度条 + ETA + 当前处理联系人；支持中途取消。</p></div>
</div>
