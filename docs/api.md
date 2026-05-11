# API 接口文档

> 后端基于 Go + Gin，默认监听 `:8080`，所有接口前缀 `/api`。
> 在线文档：访问 `/swagger/` 可查看 Swagger UI。

## 目录

- [初始化与状态](#初始化与状态)
- [联系人分析](#联系人分析)
- [关系预测](#关系预测)
- [群聊分析](#群聊分析)
- [有趣发现](#有趣发现)
- [日历 / 时光机](#日历--时光机)
- [全局搜索](#全局搜索)
- [每日社交简报](#每日社交简报)
- [AI 分析](#ai-分析)
- [AI 分身](#ai-分身)
- [AI 群聊模拟](#ai-群聊模拟)
- [AI 虚拟群聊](#ai-虚拟群聊)
- [创意实验室（Labs）](#创意实验室labs)
- [断联预警 / 反向语义搜索](#断联预警--反向语义搜索)
- [群聊 Wrapped / 里程碑](#群聊-wrapped--里程碑)
- [Skills（技能包）](#skills技能包)
- [AI 文生图](#ai-文生图)
- [RAG 检索](#rag-检索)
- [向量检索](#向量检索)
- [记忆提炼](#记忆提炼)
- [记忆库（Memory CRUD）](#记忆库memory-crud)
- [AI 对话历史](#ai-对话历史)
- [AI 分身对话历史](#ai-分身对话历史)
- [用户偏好](#用户偏好)
- [Gemini OAuth](#gemini-oauth)
- [锁屏](#锁屏)
- [数据库浏览器](#数据库浏览器)
- [导出中心](#导出中心)
- [App 管理（桌面版）](#app-管理桌面版)
- [移动端配对](#移动端配对)
- [系统](#系统)
- [错误响应格式](#错误响应格式)


## 初始化与状态

### `POST /api/init`

触发后端重新建立索引，必须在使用其他分析接口前调用。索引在后台异步进行。

**请求体**

```json
{ "from": 1672531200, "to": 1704067200 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `from` | int64 | 开始时间（Unix 秒），`0` 表示不限 |
| `to`   | int64 | 结束时间（Unix 秒），`0` 表示不限 |

### `GET /api/status`

查询索引进度。索引中会返回 `progress` 字段，完成后省略。

**响应**

```json
{
  "is_indexing": true,
  "is_initialized": false,
  "total_cached": 0,
  "last_error": "",
  "progress": {
    "done": 42,
    "total": 312,
    "current_contact": "wxid_xxx",
    "elapsed_ms": 7823
  }
}
```

### `POST /api/cancel-index`

中止当前正在进行的索引（通过 context cancel）。非索引状态下是 no-op。

```json
{ "cancelled": true }
```

### `GET /api/diagnostics`

一键诊断：数据目录健康、索引状态、LLM 探活（OpenAI 兼容端点 `GET /models`，5s 超时）、磁盘占用。整体耗时上限约 6s。每段带 `status: "ok" / "warn" / "error" / "skipped"`。

### `GET /api/health`

健康检查。

```json
{ "status": "ok", "db_connected": 5 }
```


## 联系人分析

### `GET /api/contacts/stats`

获取所有联系人的统计信息（从内存缓存返回）。返回 `[]ContactStatsExtended`，含消息数、字数、峰值月、红包/转账数等。

### `GET /api/global`

获取全局聚合统计（所有联系人汇总），含 monthly_trend、hourly_heatmap、late_night_ranking 等。

### `GET /api/contacts/detail?username=wxid`

单个联系人的深度分析（24h 分布、周分布、日历热力、深夜消息、红包/转账次数及时间线、主动率、对话段落）。

### `GET /api/contacts/wordcloud?username=wxid&include_mine=true`

词云数据（中文分词 + 停用词过滤，top 120）。

### `GET /api/contacts/sentiment?username=wxid&include_mine=true`

按月情感分析（关键词评分，0~1 分）。

### `GET /api/contacts/common-groups?username=wxid`

与指定联系人的共同群聊列表。

### `GET /api/contacts/messages?username=wxid&date=2024-01-15`

指定联系人某天的完整聊天记录。

### `GET /api/contacts/messages/month?username=wxid&month=2024-01`

指定联系人某月的聊天记录。

### `GET /api/contacts/search?username=wxid&q=关键词`

搜索指定联系人的消息记录（最多 200 条）。

### `GET /api/contacts/export?username=wxid&from=0&to=0`

导出联系人聊天记录（最多 50,000 条），from/to 为 Unix 秒。

### `GET /api/contacts/cooling`

获取关系降温排行（近一月 vs 历史峰值下降最多的联系人）。

### `GET /api/stats/filter?from=&to=`

自定义时间范围统计（不更新缓存，即时计算返回）。

### `GET /api/contacts/self-portrait`

本人自画像：总发送量、平均消息长度、活跃时段、社交体检分、最常联系的人等。

### `GET /api/contacts/money-overview`

红包 / 转账全局概览：总数、月度趋势、按联系人排行（发红包 / 收红包 / 发转账 / 收转账）。

### `GET /api/contacts/urls`

聊天记录里分享过的所有 URL（按域名聚合 + 每条链接上下文）。

### `GET /api/contacts/social-breadth`

每日联系人数的年度曲线（每天和多少个不同的人说过话），附日均 / 最广日。

### `GET /api/contacts/similarity?top=20`

联系人两两相似度排行（18 维特征向量 + 余弦相似度），返回 Top N 对。

### `GET /api/contacts/common-circle?user1=x&user2=y`

两个联系人的共同社交圈：共同群聊列表 + 基于多群共现推测的共同好友。

### `GET /api/contacts/secret-words?username=wxid`

秘语雷达：某联系人的 TF-IDF 专属词云（Top 50 活跃联系人词池，计分 `log((N+1)/(1+df))`，缓存 1h）。

### `GET /api/contacts/ai-summary?username=wxid`

AI 关系摘要（低 token 统计预处理，给 `/ai/analyze` 打底）。


## 关系预测

### `GET /api/contacts/relationship-forecast?top=5&include_all=1`

基于最近 6 个月消息节奏，给每个联系人打 4 档：`rising` / `stable` / `cooling` / `endangered`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `top` | int | 默认 5；建议主动联系列表的条数 |
| `include_all` | `0/1` | `1` 时额外返回 `all[]`（全档）+ 每个 entry 的 12 月消息折线 `monthly_12` |

响应 entry 包含：`status` / `score` / `trend_pct` / `recent_3m` / `prior_3m` / `days_since_last` / `initiator_recent` / `initiator_prior` / `initiator_trend` / `their_latency_recent_sec` / `their_latency_prior_sec` / `mine_latency_*` / `reason` / `suggestion`。

### `POST /api/contacts/icebreaker`

给降温 / 濒危联系人用 LLM 起草 4 条不同调性（关心 / 回忆 / 调侃 / 约见）的破冰开场白。

**请求体**

```json
{ "username": "wxid_xxx", "profile_id": "" }
```

采样最近 40 条文本消息 + 相识年数 + 沉默天数，走严格 JSON 输出。

**响应**

```json
{
  "drafts": [{ "tone": "关心近况", "text": "..." }],
  "display_name": "小李",
  "days_since_last": 72
}
```


## 群聊分析

### `GET /api/groups`

所有有消息记录的群聊列表，含 member_count（发言人数）。

### `GET /api/groups/detail?username=xxx@chatroom`

群聊深度分析（懒加载 + 缓存）：24h/周分布、成员排行、高频词、消息类型分布。

### `GET /api/groups/messages?username=xxx@chatroom&date=2024-01-15`

群聊某天的完整消息记录。

### `GET /api/groups/search?username=xxx@chatroom&q=关键词`

搜索群聊消息（最多 200 条）。

### `GET /api/groups/export?username=xxx@chatroom&from=0&to=0`

导出群聊记录（最多 50,000 条）。

### `GET /api/groups/relationships?username=xxx@chatroom`

力导向人物关系图（Louvain 社区检测 + 模块度 Q 兜底）。节点按小圈子着色，`Q<0.3` 时返回提示而非强凑圈。

### `GET /api/groups/year-review?username=xxx@chatroom&year=2025&profile_id=`

AI 群聊年度回顾（Spotify Wrapped 风格）。扫该年所有消息算：Top 3 发言成员 / 最忙一天 / 高频词 Top 3 / 月度消息量；调 LLM 生成 3 条原文金句 + 60-100 字年度叙事。

群聊人物关系图（成员节点 + 交互边，含回复和提及权重）。


## 有趣发现

### `GET /api/fun/companion-time`

每个联系人的累计陪伴时长（按 session gap 切分估算）+ Top 排行。缓存 10 分钟。

### `GET /api/fun/ghost-months`

Ghost 月：单月消息骤降 ≥80% 的"失联月"。

### `GET /api/fun/like-me`

最像我的朋友 Top 5：18 维特征向量距我加权基线最近的联系人。

### `GET /api/fun/word-almanac`

词语年鉴：Top 30 活跃联系人里我发的文本按年分桶分词，每年取 #1 代表词 + 亚军 3 个。缓存 2h。

### `GET /api/fun/insomnia-top`

失眠陪聊榜：凌晨 2-4 点我发消息后，对方 30 分钟内回应率 + 中位响应时延 Top 5。缓存 30min。


## 日历 / 时光机

### `GET /api/calendar/heatmap`

全历史日历热力图数据，返回 `{ heatmap: { "YYYY-MM-DD": count } }`。

### `GET /api/calendar/trend`

指定时间范围的每日消息趋势。

### `GET /api/calendar/day?date=2024-01-15`

某天的活跃联系人和群聊列表，返回 `{ contacts: [], groups: [] }`。

### `GET /api/calendar/messages?date=2024-01-15&username=wxid&is_group=false`

某天某联系人/群聊的消息记录。


## 全局搜索

### `GET /api/search?q=关键词&type=all`

跨所有联系人和群聊搜索消息。`type` 可选 `all`/`contact`/`group`。每个联系人/群聊最多返回 5 条匹配。


## 每日社交简报

首页左侧 Tab「今日简报」对应的数据源。每天看昨天，懒生成 + 入库。

### `GET /api/daily-digest/today?date=YYYY-MM-DD`

返回某天的社交摘要（默认昨天）。如果 DB 里没有缓存就实时生成并写入。

```json
{
  "date": "2026-05-10",
  "total_messages": 312,
  "active_contacts": 18,
  "active_groups": 5,
  "highlights": [
    { "kind": "long_chat", "username": "wxid_x", "display_name": "TA", "summary": "和 TA 聊了 80 条" },
    { "kind": "new_topic", "summary": "群里第一次聊到 \"求职\"" }
  ],
  "suggest_reach_out": ["wxid_a", "wxid_b"]
}
```

### `GET /api/daily-digest/list?days=30`

近 N 天历史简报，按日期降序。`days` 默认 30。

### `POST /api/daily-digest/regen?date=YYYY-MM-DD`

强制重新生成某天简报（默认昨天）。调试或重新索引后用。


## AI 分析

### `POST /api/ai/analyze`

流式 AI 分析（SSE），前端发送预处理的消息 + LLM 历史。

**请求体**

```json
{
  "username": "wxid",
  "is_group": false,
  "from": 0,
  "to": 0,
  "messages": [{ "role": "user", "content": "分析一下我们的关系" }],
  "profile_id": "uuid"
}
```

**SSE 响应**：每条 `data:` 为 `StreamChunk`（含 `delta`/`thinking`/`done`/`error` 字段）。

### `POST /api/ai/complete`

非流式单次 LLM 补全。

### `POST /api/ai/llm/test`

测试 LLM 连接是否正常。


## AI 分身

### `GET /api/ai/clone/session/:username`

检查指定联系人是否有缓存的 AI 分身档案。

**响应**

```json
{ "exists": true, "session_id": "uuid", "private_count": 300, "group_count": 1000, "has_profile": true }
```

### `POST /api/ai/clone/learn`

学习联系人的聊天风格（SSE 多步进度推送）。

**请求体**

```json
{
  "username": "wxid",
  "count": 300,
  "groups": ["xxx@chatroom"],
  "bio": "湖南人，在上海工作",
  "extract_profile": true
}
```

**SSE 响应**：每步推送 `{ step: "loading" | "analyzing" | "profile" | "building" }`，最后 `{ done: true, session_id: "..." }`。

### `POST /api/ai/clone/chat`

与 AI 分身对话（SSE 流式）。

```json
{
  "session_id": "uuid",
  "messages": [{ "role": "user", "content": "你好" }],
  "profile_id": "uuid"
}
```

### `POST /api/ai/clone/continue`

AI 对话续写 — AI 模拟双方继续聊天（SSE 流式）。

```json
{
  "session_id": "uuid",
  "profile_id": "uuid",
  "rounds": 10,
  "topic": "可选，起始话题",
  "my_name": "我"
}
```


## AI 群聊模拟

### `POST /api/ai/group-sim`

模拟群聊对话（SSE 流式）。

**请求体**

```json
{
  "group_username": "xxx@chatroom",
  "message_count": 1000,
  "profile_id": "uuid",
  "user_message": "可选，用户的消息",
  "history": [{ "speaker": "Saka", "content": "之前的消息" }],
  "rounds": 10,
  "topic": "可选，话题设定",
  "mood": "casual | heated | latenight | funny | serious",
  "members": ["Saka", "Ødegaard"]
}
```

**SSE 响应**：每条 `data:` 为 `{ speaker, content }`，最后 `{ done: true }`。


## AI 虚拟群聊

把任意 2-8 个联系人拉进一个虚拟群（这些人现实里可能从没在同群聊过），AI 扮演每个人轮流发言。风格来源优先级：已训练的 clone_profiles.prompt → 私聊样例兜底。

### `POST /api/ai/virtual-group/chat`

生成一句或 N 句虚拟群聊（SSE 流式）。

**请求体**

```json
{
  "members": ["wxid_a", "wxid_b"],
  "history": [
    { "speaker": "wxid_a", "content": "之前说过的话" }
  ],
  "next_speaker": "",
  "topic": "可选话题",
  "profile_id": "uuid",
  "turns": 1,
  "sample_count": 30
}
```

| 字段 | 说明 |
|------|------|
| `members` | 2-8 个联系人 wxid |
| `next_speaker` | 空 / `auto` 自动轮转；`random` 随机；或指定某个 member 的 wxid |
| `turns` | 1 = 单句（老行为）；2-15 一次生成多句，由 LLM 自选顺序 |
| `sample_count` | 未训练分身时每人采样多少条消息（默认 30，上限 200） |

**SSE 响应**：每条 `data:` 为 `{ speaker, display_name, content }`，最后 `{ done: true }`。

### `GET /api/ai/virtual-group/sessions`

列出已保存的虚拟群会话（按 `updated_at` 倒序，最多 100 条）。

```json
{
  "sessions": [
    {
      "id": 12,
      "name": "深夜话题局",
      "topic": "聊一聊离职这事",
      "members": [{ "username": "wxid_a", "name": "TA", "avatar": "..." }],
      "history": [{ "speaker": "wxid_a", "display_name": "TA", "content": "..." }],
      "created_at": 1714000000,
      "updated_at": 1714867200
    }
  ]
}
```

### `GET /api/ai/virtual-group/sessions/:id`

读取单个会话详情（含成员 + 完整 history）。

### `POST /api/ai/virtual-group/sessions`

保存或更新虚拟群会话。body 带 `id` 则 UPDATE，否则 INSERT。

```json
{
  "id": 0,
  "name": "...",
  "topic": "...",
  "members": [{ "username": "wxid_a", "name": "TA" }],
  "history": [{ "speaker": "wxid_a", "display_name": "TA", "content": "..." }]
}
```

**响应**：`{ "id": 12 }`。

### `DELETE /api/ai/virtual-group/sessions/:id`

删除会话。返回 `{ "ok": true }`。


## 创意实验室（Labs）

侧边栏「实验室」Tab 下的 5 个分享类小工具。详见 [创意实验室](./labs)。

### `GET /api/me/dna`

聊天 DNA。Wrapped 风格的年度个人卡：消息总数、最常聊的人 Top 5、活跃时段、emoji 偏好、最长一句话、最早开始聊的人、回复时延中位数等。

**纯统计，无 LLM**。响应字段见 `backend/chat_dna.go` 中的 `DNAResponse`。

进程内缓存 10 分钟。`?refresh=1` 强制重算。`Reinitialize`（切换索引时间范围）后旧缓存自动失效。

> 同时支持 `POST /api/me/dna`，参数与行为完全一致——POST 仅作语义对称，无 body。

### `POST /api/contacts/highlights`

高光瞬间。先按规则（最长聊天日 / 深夜长谈 / 认识当天 / 最近）选出候选片段，再让 LLM 给每段起标题和摘要。

**请求体**

```json
{
  "username": "wxid_xxx",
  "profile_id": "uuid"
}
```

**响应**

```json
{
  "display_name": "TA",
  "total_messages": 12345,
  "days_known": 980,
  "first_date": "2022-04-01",
  "last_date": "2026-04-25",
  "highlights": [
    {
      "category": "最长聊天日",
      "title": "10 字标题",
      "summary": "一两句话总结，30-60 字",
      "date": "2024-03-15",
      "excerpt": [{ "speaker": "我|TA", "time": "23:14", "content": "..." }]
    }
  ]
}
```

### `POST /api/contacts/soul-quiz`

灵魂提问机。AI 基于你和该联系人的真实聊天，出 5 道默契测试选择题。

**请求体**

```json
{
  "username": "wxid_xxx",
  "profile_id": "uuid"
}
```

**响应**：`{ display_name, questions: [{ question, options: [a,b,c,d], answer_index, why?, category }, ...] }`。题数由后端控制（默认 5 题）。`category` ∈ "回忆" / "口头禅" / "时间" / "习惯" / "梗"。

### `POST /api/ai/parallel-chat`

平行宇宙对话。给定一个联系人 + "如果……" 场景，AI 用 TA 的画像引擎流式生成虚构对话。

**请求体**

```json
{
  "username": "wxid_xxx",
  "scenario": "如果我们五年前就认识",
  "turns": 8,
  "sample_count": 30,
  "profile_id": "uuid"
}
```

`turns` 1–20，默认 8；`sample_count` 1–200，默认 30。`username` 必须在当前索引的联系人中（不存在直接 404，避免前后端 displayName 对不上）。

**SSE 响应**：每条 `data:` 为：

- `{ meta: true, speaker, display_name }`：开始一句新话
- `{ delta: "..." }`：当前话的增量内容
- `{ turn_end: true }` / `{ done: true }`：结束当前话或整段

### `GET /api/me/chat-geography[?limit=30]`

聊天地图。词典子串匹配抽地名，按 tier 分类聚合。零 LLM、本地缓存 2h。

**Tier 取值**

- `china_metro` 一线 / 直辖市
- `china_city` 中国城市
- `china_scenic` 国内景点
- `region` 港 / 澳 / 台
- `abroad_city` 海外城市
- `abroad_country` 国家 / 大区

**响应**

```json
{
  "places": [
    {
      "name": "东京",
      "tier": "abroad_city",
      "mentions": 87,            // 总提及次数（同消息内同名只计 1）
      "contacts": 5,             // 多少个不同联系人聊起
      "top_with": [              // Top 3 同行者
        { "username": "wxid_x", "display_name": "TA", "avatar": "...", "count": 23 }
      ]
    }
  ],
  "total_mentions": 1234,
  "unique_places": 45,
  "contacts_scanned": 80,
  "messages_scanned": 65432,
  "generated_at": 1714867200
}
```

`limit` 默认 30、最大 100。`refresh=1` 强制重算。

### `GET /api/me/language-evolution`

我的语言进化史。按年聚合"我"发的所有文本消息，输出 4 条说话风格指标的演变 + 每年的"那年的我"卡片。零 LLM、本地缓存 2h、`?refresh=1` 强制重算。

**响应**

```json
{
  "years": [
    {
      "year": 2024,
      "my_messages": 12345,
      "my_chars": 234567,
      "avg_chars": 19.0,
      "emoji_count": 1100,
      "emoji_per_100": 8.9,
      "english_msgs": 1456,
      "english_pct": 0.118,
      "active_days": 320,
      "msgs_per_day": 38.6,
      "top_openers": [{ "text": "在吗", "count": 123 }],
      "longest_message": "...",
      "longest_len": 280
    }
  ],
  "total_my_messages": 65432,
  "total_my_chars": 1234567,
  "first_year": 2018,
  "last_year": 2026,
  "contacts_scanned": 80,
  "generated_at": 1714867200
}
```

少于 50 条文本的年份会被剔除（统计不稳）。

### `POST /api/contacts/promise-debts`

人情债 / 承诺与邀约挖掘。两段式：先用宽口径正则把"答应/改天/下次/等我/请你/寄你..."嫌疑句的上下文窗口捞出来，再让 LLM 精筛 + 结构化抽取真正的承诺。

**请求体**

```json
{
  "username": "wxid_xxx",
  "profile_id": "uuid"
}
```

**响应**

```json
{
  "display_name": "TA",
  "avatar": "...",
  "total_messages": 8421,
  "scanned_messages": 6500,    // 扫描的文本消息数
  "candidate_count": 35,       // 命中正则后合并的上下文窗口数
  "debts": [
    {
      "text": "TA 答应下次去东京带我去那家拉面店",
      "direction": "they_owe",            // i_owe / they_owe / mutual
      "category": "聚餐",                  // 聚餐/见面/寄送/借还/通话/旅行邀约/答复/其他
      "target_date_text": "下次去东京",
      "target_date": "",                  // 可推断为具体日期时填 YYYY-MM-DD
      "source_quote": "下次我们去东京我带你去尝那家拉面",
      "source_speaker": "TA",
      "source_date": "2024-08-12",
      "confidence": "high"                // high/medium/low
    }
  ],
  "generated_at": 1714867200
}
```

后端会按方向（`they_owe > mutual > i_owe`）+ 置信度（high>medium>low）排序后返回，前端按 tab 过滤展示。

### `GET /api/groups/golden-quotes?room=xxx@chatroom&limit=10`

群金句榜。扫该群所有 `local_type=49 + <refermsg>` 引用消息，按原文被引用次数排出 Top N "名场面"。

零 LLM。最多扫 60,000 条消息（按时间倒序裁剪），10 分钟缓存。`limit` 默认 10、最大 50。同一条原文被不同人引用合并计数（svrid 去重 + 文本 fallback）；只被引用过 1 次的不上榜；自己 quote 自己不计。

**响应**：

```json
{
  "group_name": "XXX 群",
  "room_id": "12345@chatroom",
  "total_scanned": 8000,    // 扫描的消息数
  "total_quotes": 312,      // 命中引用的次数
  "unique_quoted": 47,      // 不同的"被引用原文"数
  "truncated": false,       // 是否触发 60k 上限
  "quotes": [
    {
      "svrid": "1234567890",
      "speaker": "张三",
      "speaker_wxid": "wxid_xxx",
      "avatar": "...",
      "content": "金句原文",
      "quote_count": 8,                          // 被引用次数
      "ts": 1700000000, "date": "2024-03-15", "time": "23:14",
      "repliers": [                              // 翻牌人 Top 3
        { "speaker": "李四", "avatar": "...", "count": 3 }
      ]
    }
  ],
  "generated_at": 1714867200
}
```

### `GET /api/me/relation-graph`

关系星图。返回所有联系人按"共同群聊"聚拢的力导向图节点 + 连边。

**响应**：

```json
{
  "nodes": [
    { "id": "wxid_xxx", "display_name": "TA", "avatar": "...", "messages": 1234,
      "peak_hour": 22, "period": "night", "group_count": 3 }
  ],
  "edges": [{ "source": "wxid_a", "target": "wxid_b", "weight": 2 }],
  "total_contacts": 80
}
```

`weight` 表示两个联系人共同所在的群数。前端自跑迷你 force layout 渲染，无 d3-force 依赖。


## 断联预警 / 反向语义搜索

### `GET /api/me/drift?refresh=0`

断联预警 / Drift Alert。扫所有私聊（总消息数 ≥ 50）的 `LastMessageTs`，按静默天数 ≥ 30 排出 Top 30，并给出三档分级人数 + 三张"之最"高亮卡。零 LLM、10 分钟缓存，`?refresh=1` 强制重算。

**响应**

```json
{
  "today": "2026-05-10",
  "total_analyzed": 142,
  "total_adrift": 38,
  "summary": {
    "tier_30_plus": 18,
    "tier_90_plus": 12,
    "tier_180_plus": 8
  },
  "top": [
    {
      "username": "wxid_xxx",
      "display_name": "TA",
      "avatar": "...",
      "total_messages": 1234,
      "last_message_ts": 1700000000,
      "last_date": "2024-09-12",
      "days_silent": 215,
      "heartbreak_index": 18.7
    }
  ],
  "superlatives": {
    "longest_silent": { "username": "...", "...": "..." },
    "biggest_volume": { "username": "...", "...": "..." },
    "oldest_friend":  { "username": "...", "...": "..." }
  }
}
```

### `GET /api/me/echo?q=...&topK=20&days=365`

「这句话谁说过」反向语义搜索。embed 一次 query → 跨已建索引的 `vec_messages` 找最相似消息 → 按说话人聚合返回。

**Query 参数**

| 字段 | 默认 | 说明 |
|------|------|------|
| `q` | — | 必填，要搜的句子，≤ 200 字 |
| `topK` | 20 | 每个 contact 内最多保留候选数（≤ 100） |
| `min_msgs` | 50 | 只搜消息数 ≥ N 的 contact |
| `days` | 365 | 时间窗（天） |
| `include_groups` | `0` | `1` 时把群聊也纳入扫描 |
| `include_self` | `0` | `1` 时把"我"的消息也纳入 |

**响应**

```json
{
  "query": "再不学就晚了",
  "total_hits": 24,
  "keys_scanned": 78,
  "keys_skipped": 12,
  "elapsed_ms": 1830,
  "groups": [
    {
      "key": "wxid_x",
      "display_name": "TA",
      "avatar": "...",
      "is_group": false,
      "hit_count": 3,
      "top_sim": 0.81,
      "hits": [
        { "datetime": "2024-03-15 22:08", "sender": "TA", "content": "再不学就晚了……", "similarity": 0.81 }
      ]
    }
  ]
}
```

相似度 < 0.35 的命中视为噪声丢弃。最多扫 800 个 contact（防御性兜底）。


## 群聊 Wrapped / 里程碑

### `GET /api/groups/wrapped?room=xxx@chatroom&refresh=0`

群聊 Wrapped 卡。和 `/api/groups/year-review` 区别：那个是按年生成 + LLM 叙事，这个是"对整段筛选时间范围"的纯统计速览（Top 发言人、消息类型分布、最忙一天、被引用最多原文等），无 LLM。可作为群画像顶部 Hero 卡。10 分钟缓存。

### `POST /api/contacts/milestones`

聊天里程碑。某联系人的初识日期 + 第一条消息预览、消息量门槛（100/500/1K/5K…）、最火月份、认识天数等。纯统计、5 分钟缓存。

**请求体**

```json
{ "username": "wxid_xxx" }
```

仅支持私聊（带 `@chatroom` 直接 400）。


## Skills（技能包）

把聊天记录炼化为 Claude Code / Codex / Cursor 等 AI 工具的 Skill 文件包。

### `POST /api/ai/forge-skill`

异步炼化任务。请求体主要字段：`skill_type`（`contact` / `self` / `group` / `group-member`）、`username`、`member_speaker`（仅 group-member）、`profile_id`、`msg_limit`、`format`。返回 `skill_id`，用于后续查状态。

支持的 `format`：

| 值 | 产物 |
|----|------|
| `claude-skill` | Claude Code Skills 目录式 |
| `claude-agent` | Claude Code Subagent 单文件 |
| `codex` | OpenAI Codex CLI `AGENTS.md` |
| `opencode` | OpenCode Agent |
| `cursor` | Cursor Rules `.mdc`（含 glob） |
| `generic` | 通用 Markdown |
| `lora-jsonl` | **LoRA 训练集 zip**：Alpaca jsonl + 训练食谱。纯本地处理无 LLM，仅 `skill_type=self` 支持，用于本地微调（Unsloth / LLaMA-Factory） |

`lora-jsonl` 模式跳过 LLM 配置校验；其它格式要求已配置 provider + API Key（Ollama 例外）。

### `GET /api/skills`

已炼化的 Skill 列表（含状态 / 耗时 / 错误原因）。支持搜索、筛选、排序。

### `GET /api/skills/:id`

单个 Skill 详情（含元数据 + 生成的文件清单）。

### `GET /api/skills/:id/download`

下载 Skill 产物 zip 包。

### `DELETE /api/skills/:id`

删除单个 Skill（同时删除本地文件）。


## AI 文生图

生图能力，覆盖三个场景：群年报封面 / 高光瞬间插画 / 联系人 AI 头像。支持 4 个 provider：

| Provider | 端点 | 默认模型 |
|---|---|---|
| **doubao** | 火山方舟 OpenAI 兼容 `/images/generations` | `doubao-seedream-3-0-t2i-250415` |
| **openai** | 官方 `/v1/images/generations` | `gpt-image-1`（也支持 `dall-e-3`） |
| **siliconflow** | OpenAI 兼容 `/v1/images/generations` | `black-forest-labs/FLUX.1-schnell` |
| **gemini** | Generative Language API `:predict` | `imagen-3.0-generate-002` |

支持 **多 profile 配置**：在 `preferences.image_profiles` 数组里配置多组（每组带 `id / name / provider / api_key / base_url / model`），所有生图调用接受可选 `profile_id` 指定走哪条；不传走第一条（默认）。

**异步队列**：生图是 10-60 秒量级，单 HTTP 请求阻塞太久。后端有一个 2 并发的 goroutine pool 处理任务队列，状态全落 `ai_analysis.db.image_tasks`：

- 推荐前端用 **`POST /image/tasks` 提交 + 1.5s 轮询 `GET /image/tasks/:id`**，能拿到伪进度（0-100）并支持中途取消
- 老 `POST /image/generate` 同步接口仍然可用，**内部已包装成「提交任务 + 等到 done」**，与之前调用方式 100% 兼容
- 同 hash 缓存命中时直接返回 `done`，不会真入队

**缓存**：`sha256(provider|model|size|prompt)` → `~/.welink/ai_images/<hash>.png`。命中直接返回 hash，不重复调 API。前端必须用 `GET /api/image/cache/:hash` 同源拿图——火山方舟返回的临时 URL 24h 过期，且 `html-to-image` 导出分享卡要求图片同源。

Demo 模式会写一张 SVG 占位图，不调真 provider。

### `GET /api/image/providers`

返回内置 provider 元数据（前端用于渲染下拉框、默认 model、支持尺寸）。

```json
{
  "providers": [
    {
      "value": "doubao",
      "label": "豆包 / 即梦（火山方舟）",
      "default_base_url": "https://ark.cn-beijing.volces.com/api/v3",
      "default_model": "doubao-seedream-3-0-t2i-250415",
      "models": [{ "value": "...", "label": "..." }],
      "sizes": ["1024x1024", "1024x1792", "1792x1024"],
      "key_url": "https://console.volcengine.com/ark/...",
      "auth_hint": "...",
      "price_hint": "约 0.05-0.2 元/张"
    }
  ]
}
```

### `POST /api/image/generate`

生成一张图（同步阻塞）。

**请求体**

```json
{
  "prompt": "...",
  "size": "1024x1024",
  "scene": "highlight",
  "profile_id": "img-default"
}
```

| 字段 | 说明 |
|------|------|
| `prompt` | 必填，≤ 2000 字符 |
| `size` | `1024x1024` / `1024x1792` / `1792x1024`，默认 `1024x1024` |
| `scene` | 埋点用，可选 `year_review` / `highlight` / `avatar` |
| `profile_id` | 可选，指定走哪条 `image_profiles` 配置；空 = 第一条（默认） |

未启用生图（`prefs.image_enabled=false`）且非 Demo 模式 → `403`。

**响应**

```json
{
  "hash": "ab12...",
  "url": "/api/image/cache/ab12...",
  "cached": false
}
```

### `GET /api/image/cache/:hash`

按 hash 提供缓存图。`Cache-Control: public, max-age=31536000, immutable`，content-type 自动 sniff（SVG / PNG / JPEG）。

### `POST /api/image/tasks`

异步提交一个生图任务。立即返回 `task_id`，前端轮询 `GET /api/image/tasks/:id` 拿进度。

**请求体**：与 `/image/generate` 同字段，外加 `ref_user` / `ref_kind` 用作场景关联。

```json
{
  "prompt": "...",
  "size": "1024x1024",
  "scene": "highlight",
  "profile_id": "img-default",
  "ref_user": "wxid_xxx",
  "ref_kind": "avatar"
}
```

**响应**

```json
{
  "id": "1714867200000000abcdef0123456789",
  "task": {
    "id": "...",
    "status": "queued",
    "progress": 0,
    "prompt": "...",
    "provider": "doubao",
    "model": "doubao-seedream-3-0-t2i-250415",
    "size": "1024x1024",
    "created_at": 1714867200
  }
}
```

**短路**：如果该 (provider, model, size, prompt) 已有本地缓存图，**直接返回 `status: "done"` + `result_hash` 已填**，不会真的入队。

### `GET /api/image/tasks/:id`

查询单个任务的当前状态。前端 1.5s 轮询。

```json
{
  "id": "...",
  "status": "running",
  "progress": 42,
  "scene": "highlight",
  "prompt": "...",
  "provider": "doubao",
  "model": "doubao-seedream-3-0-t2i-250415",
  "size": "1024x1024",
  "result_hash": "",
  "error": "",
  "started_at": 1714867202,
  "finished_at": 0,
  "created_at": 1714867200
}
```

`status` 取值：`queued / running / done / failed / canceled`。`done` 时 `result_hash` 非空，前端可拼 `/api/image/cache/<result_hash>` 拿图。

**进度**：当前为「伪进度」—— worker 起跑置 5%，调 API 期间每秒 +2% 封顶 85%，完成后跳 100。

### `GET /api/image/tasks?status=&scene=&limit=50&offset=0`

任务列表。按 `created_at` 降序。

| Query | 说明 |
|-------|------|
| `status` | 限定状态 |
| `scene` | 限定场景 |
| `limit` | 默认 50，最大 200 |
| `offset` | 分页偏移 |

返回 `{ tasks: [...] }`。

### `DELETE /api/image/tasks/:id`

取消任务。
- `queued` → 直接置 `canceled`
- `running` → 软取消：标 `canceled`、若外部 API 还在跑则等其返回后丢弃结果（不计入 result）

终态任务（done / failed / canceled）调用是 no-op。

### `GET /api/images?q=&scene=&provider=&starred=&include_deleted=&limit=60&offset=0`

AI 画廊列表。每张成功生成的图自动入库（`images` 表 + `images_fts` 虚拟表）。

| Query | 说明 |
|-------|------|
| `q` | 全文检索 prompt + tags（FTS5） |
| `scene` | 限定场景：`avatar` / `highlight` / `group_year_review_cover` / ... |
| `provider` | 限定 provider |
| `starred` | `1` = 仅收藏 |
| `include_deleted` | `1` = 包含软删的图（默认排除） |
| `limit` | 默认 60，最大 200 |
| `offset` | 分页偏移 |

返回 `{ images: [...], total: N }`。`images[]` 按「收藏优先 + 时间倒序」排列。

```json
{
  "hash": "abc...",
  "prompt": "...",
  "scene": "highlight",
  "provider": "doubao",
  "model": "doubao-seedream-3-0-t2i-250415",
  "size": "1792x1024",
  "task_id": "...",
  "parent_hash": "",
  "starred": false,
  "tags": [],
  "used_in": [{ "kind": "avatar", "ref": "wxid_xxx", "at": 1714867200 }],
  "created_at": 1714867200,
  "url": "/api/image/cache/abc..."
}
```

### `GET /api/images/:hash`

单张图详情（含 used_in 引用清单）。软删的图也返回（`deleted_at != 0`）。

### `PATCH /api/images/:hash`

更新单张图的元数据。

```json
{ "starred": true, "tags": ["年报", "工作群"] }
```

字段可选；`tags` 改动会同步更新 FTS。

### `DELETE /api/images/:hash[?hard=true]`

- 默认软删（写 `deleted_at`，30 天后由后台 GC 物理清理）
- `?hard=true` 立即硬删：删 DB 行 + FTS 行 + 物理 png 文件

### `POST /api/images/:hash/regenerate`

基于现有图重生成。body 可选覆盖 `prompt / size / profile_id`，未传则沿用源图。

```json
{ "prompt": "...新文案...", "size": "1024x1024" }
```

行为等价于 `POST /api/image/tasks`，但自动带源图 scene + 在源图的 `used_in` 加一条 `regen_source` 标记（前端可看到一张图的全部派生作品）。返回与 `/image/tasks` 一致：

```json
{
  "id": "1714867200...",
  "task": { "id": "...", "status": "queued", ... },
  "parent_hash": "abc..."
}
```


### `POST /api/image/test`

用极短 prompt 验证生图配置是否可用。可选 body：

```json
{ "profile_id": "img-default" }
```

无 body 或不传 `profile_id` = 测试默认 profile。

```json
{ "ok": true, "hash": "...", "url": "/api/image/cache/...", "provider": "doubao", "model": "doubao-seedream-..." }
```

### `POST /api/contacts/ai-avatar`

联系人 AI 头像：扫该联系人最近 200 条 type=1 文本 → LLM 抽 3-5 个性格关键词 → 拼 prompt 调 `GenerateImage`，产物是抽象意象头像（无人脸、无五官、无文字）。

**请求体**

```json
{ "username": "wxid_xxx", "profile_id": "img-default" }
```

文字消息少于 10 条直接 400。

**响应**

```json
{
  "url": "/api/image/cache/...",
  "hash": "...",
  "tags": ["温柔细腻", "段子手", "碎碎念"]
}
```


## RAG 检索

### `GET /api/ai/rag/index-status?key=contact:wxid`

查询 FTS5 全文索引状态。

### `POST /api/ai/rag/build-index`

构建 FTS5 全文索引（SSE 进度推送）。

### `POST /api/ai/rag`

混合检索 + LLM 流式分析（FTS5 + 向量检索 → LLM）。

### `POST /api/ai/day-rag`

跨联系人的单日聚合分析（时光机 AI）。


## 向量检索

### `GET /api/ai/vec/index-status?key=contact:wxid`

查询向量索引状态。

### `POST /api/ai/vec/build-index`

构建向量嵌入索引（支持暂停/恢复）。

### `GET /api/ai/vec/build-progress?key=contact:wxid`

查询向量索引构建进度。

### `POST /api/ai/vec/test-embedding`

测试 Embedding 提供商连接。


## 记忆提炼

### `GET /api/ai/mem/status?key=contact:wxid`

查询已提炼的记忆事实数量。

### `GET /api/ai/mem/facts?key=contact:wxid`

获取已提炼的所有记忆事实。

### `POST /api/ai/mem/build?key=contact:wxid`

开始/继续记忆提炼（带检查点，可恢复）。

### `POST /api/ai/mem/pause?key=contact:wxid`

暂停记忆提炼。

### `POST /api/ai/mem/test`

测试记忆提炼模型配置。


## 记忆库（Memory CRUD）

侧边栏「记忆库」Tab，让用户看见、编辑、置顶 LLM 提炼出来的事实（`mem_facts` 表）。

### `GET /api/memory/list?contact=&q=&pinned=&limit=100&offset=0`

分页 + 筛选检索。

| Query | 说明 |
|-------|------|
| `contact` | 限定单个 contact_key，空 = 全量 |
| `q` | 关键词（fact LIKE） |
| `pinned` | `1` = 仅置顶 |
| `limit` | 默认 100，最大 500 |
| `offset` | 分页偏移 |

返回 `{ facts: [...], total: N }`，按 `pinned DESC, id DESC` 排序。

### `GET /api/memory/contacts`

按 `contact_key` 聚合：`{ contacts: [{ contact_key, count, pinned_count }] }`。

### `POST /api/memory`

手动添加一条记忆。

```json
{ "contact_key": "contact:wxid_x", "fact": "TA 喜欢阿森纳", "pinned": false }
```

### `PUT /api/memory/:id`

更新某条记忆的文本。body `{ "fact": "..." }`。

### `DELETE /api/memory/:id`

删除一条记忆。

### `PUT /api/memory/:id/pin`

切换置顶状态。body `{ "pinned": true }`。


## AI 对话历史

### `GET /api/ai/conversations?key=contact:wxid`

获取指定联系人/群聊的 AI 对话历史。

### `PUT /api/ai/conversations`

保存 AI 对话历史。

### `DELETE /api/ai/conversations?key=contact:wxid`

删除指定的 AI 对话历史。

### `GET /api/ai/usage-stats`

聚合所有 `ai_conversations` 里 `assistant` 消息的字符数和估算 tokens，按 `provider / model` 分组。token 估算 = `tokens_per_sec × elapsed_secs`，仅近似值。

```json
{
  "total_conversations": 42,
  "total_assistant_msgs": 178,
  "total_chars": 324510,
  "total_tokens": 162000,
  "total_elapsed_sec": 1230.5,
  "by_provider": [
    { "provider": "deepseek", "model": "deepseek-chat", "count": 120, "chars": 220000, "tokens": 110000, "elapsed_sec": 820.0 }
  ]
}
```

### `GET /api/ai/conversations/search?q=关键词&limit=30`

在所有 AI 对话里做子串搜索（LIKE），返回命中的对话及前后 ~40 字符上下文片段。`limit` 默认 30，最大 100。

```json
{
  "hits": [
    {
      "key": "contact:wxid_xxx",
      "updated_at": 1710000000,
      "msg_count": 14,
      "preview": "…",
      "snippets": ["…找到匹配词前后的上下文…"]
    }
  ]
}
```


## AI 分身对话历史

AI 分身 Tab 的多轮对话独立持久化（区别于 `/api/ai/conversations`），按联系人分组。

### `GET /api/ai/clone/history/:username`

拉回该联系人的全部分身对话，按时间升序（旧→新）。

### `POST /api/ai/clone/history/:username`

追加一条对话。

```json
{ "role": "user|assistant", "content": "..." }
```

### `DELETE /api/ai/clone/history/:username`

清空该联系人的全部分身对话。

### `DELETE /api/ai/clone/history/msg/:id`

撤回单条消息。


## 用户偏好

### `GET /api/preferences`

获取当前用户偏好设置（屏蔽列表、隐私模式、LLM 配置等）。

### `PUT /api/preferences`

更新屏蔽列表和隐私模式。

### `PUT /api/preferences/llm`

更新 LLM 配置（多 Profile 支持、Embedding 配置、记忆提炼配置）。

### `PUT /api/preferences/image`

更新文生图配置。**新前端走 `image_profiles` 数组**（多 provider 并行配置）：

```json
{
  "image_enabled": true,
  "image_profiles": [
    {
      "id": "img-default",
      "name": "默认",
      "provider": "doubao",
      "api_key": "...",
      "base_url": "https://ark.cn-beijing.volces.com/api/v3",
      "model": "doubao-seedream-3-0-t2i-250415"
    },
    {
      "id": "img-openai",
      "name": "OpenAI 备用",
      "provider": "openai",
      "api_key": "sk-...",
      "base_url": "",
      "model": "gpt-image-1"
    }
  ]
}
```

逐条按 `id` 比对：`api_key` 为空或 `__HAS_KEY__` 时保留原 key（与 `/preferences/llm` 同逻辑）。第一条会被同步到老的 `image_provider/image_api_key/image_base_url/image_model` 单字段以兼容旧前端读取。

**老前端兼容**：仍接受单字段 payload `{ image_enabled, image_provider, image_api_key, image_base_url, image_model }`，后端会自动同步到 `image_profiles[0]`。

### `PUT /api/preferences/anniversaries`

保存自定义纪念日。

### `PUT /api/preferences/forecast-ignored`

关系预测「不再推荐此人」名单保存。请求体 `{ "forecast_ignored": ["wxid1", "wxid2"] }`。

### `PUT /api/preferences/prompts`

保存自定义 Prompt 模板。请求体 `{ "prompt_templates": { "insight_report": "...", ... } }`。

### `PUT /api/preferences/config`

保存基本配置（端口 / 日志级别 / 时区 / worker 数等）。修改端口后需重启生效。

### `GET /api/preferences/download-dir`

获取导出图片 / AI 备份的保存目录。返回用户配置值（`configured`）和实际生效值（`effective`，含平台默认 fallback）。

### `PUT /api/preferences/download-dir`

设置导出目录。必须在 `UserHomeDir` 之下且可写；校验失败自动回滚到上一个有效值。空串 = 恢复平台默认（`~/Downloads`）。

### `POST /api/preferences/reset`

重置用户配置到默认值。

### `GET /api/preferences/export`

把当前配置导出为 JSON（API Key 等敏感字段会被脱敏为 `__HAS_KEY__`）。

### `POST /api/preferences/import`

上传 JSON 覆盖当前配置。遇到脱敏占位符保留原值。


## Gemini OAuth

### `GET /api/auth/gemini/url`

获取 Google Gemini OAuth 授权 URL。

### `GET /api/auth/gemini/callback`

OAuth 回调处理（交换 token）。

### `GET /api/auth/gemini/status`

检查 Gemini 授权状态。

### `DELETE /api/auth/gemini`

撤销 Gemini 授权。


## 锁屏

界面级 PIN 锁，防路过偷看。PIN 后端 bcrypt 哈希存 `preferences.json`，所有验证本地完成。

### `GET /api/lock/status`

查询锁屏配置与状态：是否启用、自动锁分钟数、启动锁定开关。

### `POST /api/lock/setup`

首次启用锁屏，设置 PIN。

**请求体**

```json
{ "pin": "1234" }
```

PIN 长度 4-32，任意可见字符。

### `POST /api/lock/verify`

解锁时验证 PIN。

**请求体**

```json
{ "pin": "1234" }
```

**响应**

```json
{ "ok": true }
```

### `POST /api/lock/change`

已启用的情况下修改 PIN，需提供旧 PIN + 新 PIN。

```json
{ "old_pin": "1234", "new_pin": "567890" }
```

### `POST /api/lock/disable`

关闭锁屏需要提供当前 PIN。

```json
{ "pin": "1234" }
```

### `PUT /api/lock/settings`

修改自动锁屏时长（分钟）和启动锁定开关。

```json
{ "auto_lock_minutes": 30, "lock_on_startup": true }
```

`auto_lock_minutes`：`0` = 关闭，支持 `30` / `60` / `120`。


## 数据库浏览器

### `GET /api/databases`

列出所有已加载的数据库文件。

### `GET /api/databases/:dbName/tables`

列出指定数据库的所有表及行数。

### `GET /api/databases/:dbName/tables/:tableName/schema`

查看表结构（列定义）。

### `GET /api/databases/:dbName/tables/:tableName/data?offset=0&limit=50`

分页获取表数据（limit 最大 200）。

### `POST /api/databases/:dbName/query`

执行只读 SQL（仅允许 SELECT / PRAGMA / EXPLAIN，最多 500 行）。

### `POST /api/databases/nl-query`

自然语言查数据。用中文问题（如 "我和老婆的第一条消息是什么时候"）→ LLM 生成 SQL 后端执行。

**请求体**

```json
{ "question": "...", "profile_id": "" }
```

**响应**

```json
{
  "db": "contact",
  "sql": "SELECT ...",
  "mode": "direct",
  "explain": "AI 一句话解释",
  "columns": ["..."],
  "rows": [["..."]]
}
```

`mode=contact_messages` 时后端自动跨库定位：先查 contact.db 找 username → md5 算 `Chat_<hash>` 表名 → 遍历 message_N.db 执行 SQL（`{{TABLE}}` 占位符替换）。严格限 SELECT / PRAGMA + LIMIT 50。


## 导出中心

把年度回顾、对话归档、AI 历史、记忆图谱四类内容导出到 Markdown / Notion / 飞书 + 5 个云盘。

### `POST /api/export/preview`

把请求里每项 item 渲染成 Markdown 返回预览，不写文件不发请求。

### `POST /api/export/markdown`

单文件 → 直接返回 `.md`；多文件 → 打成 `.zip` 下载。

### `POST /api/export/notion`

每个 doc 作为新 Page 推送到 Notion 指定 Parent 下。自实现 Markdown→Blocks（标题 / 列表 / 引用 / 代码 / 表格）。

### `POST /api/export/feishu`

走 `upload_all` → `import_tasks` 异步轮询，获得飞书 docx URL。

### `POST /api/export/webdav`

HTTP PUT + Basic Auth，递归 MKCOL 建前缀目录。兼容坚果云 / Nextcloud / ownCloud / 群晖等。

### `POST /api/export/s3`

基于 minio-go v7。覆盖 AWS S3 / Cloudflare R2 / 阿里云 OSS / 腾讯 COS / 七牛 / MinIO / Backblaze B2。支持 path-style / virtual-host 切换。

### `POST /api/export/dropbox`

`files/upload` API + App Console 长期 Access Token（PAT 模式，免 OAuth 回调）。

### `POST /api/export/gdrive`

Google Drive multipart upload。授权走 OAuth 2.0 流程（见下方 oauth endpoints），refresh token 自动刷新。

### `POST /api/export/onedrive`

OneDrive `/me/drive/root:/<path>:/content` PUT。Microsoft Identity Platform v2 OAuth，个人 / 工作账号都支持。

**所有 `/export/*` 共享请求体**

```json
{
  "items": [
    { "type": "year_review", "year": 2025 },
    { "type": "conversation", "username": "wxid_x", "is_group": false, "from": 0, "to": 0 },
    { "type": "ai_history", "ai_key": "contact:wxid_x" },
    { "type": "memory_graph", "username": "wxid_x" }
  ],
  "target": "markdown",
  "notion_parent_page": "xxx",
  "feishu_folder_token": "xxx"
}
```

### `GET /api/export/config`

返回脱敏后的导出中心配置（前端回填表单用）。Secret 字段变成 `__HAS_KEY__` 占位符。

### `PUT /api/export/config`

保存导出中心配置。遇到占位符时保留原值，与 LLM 配置同逻辑。

### `GET /api/export/oauth/gdrive/start`

浏览器跳转到 Google OAuth 授权页。成功后回调到 callback endpoint 存 token。

### `GET /api/export/oauth/gdrive/callback?code=...`

接收授权码换 access + refresh token，存入 preferences。

### `GET /api/export/oauth/onedrive/start`

同上，但用 Microsoft Identity Platform v2。

### `GET /api/export/oauth/onedrive/callback?code=...`

接收授权码换 token，存入 preferences。


## App 管理（桌面版）

以下接口仅在 macOS / Windows 桌面 App 模式下使用。

### `GET /api/app/info`

获取 App 状态（版本号、是否需要配置向导、运行模式）。

### `POST /api/app/setup`

保存 App 配置（数据目录、日志目录）并重新初始化服务。

### `GET /api/app/config`

读取当前 App 配置。

### `POST /api/app/restart`

重启 App 进程。

### `GET /api/app/browse`

弹出系统文件夹选择器（macOS/Windows 原生对话框）。

### `POST /api/app/save-file`

保存文件到用户配置的下载目录（默认 `~/Downloads`，可在 Settings 修改；WebView 模式下替代浏览器下载）。

### `POST /api/app/reveal`

在 macOS Finder / Windows 资源管理器中定位文件。`path` 必须在下载目录之下，防止任意读。

```json
{ "path": "/Users/xxx/Downloads/image.png" }
```

### `POST /api/app/ai-backup`

用 SQLite `VACUUM INTO` 生成 `ai_analysis.db` 的一致快照，写入下载目录。返回 `{ path, size }` 供前端展示 + reveal。

### `GET /api/ai-backup-download`

Docker / 浏览器模式下使用：同样 `VACUUM INTO` 临时文件后 stream（`Content-Disposition: attachment`）。

### `POST /api/app/ai-restore`

multipart 上传 `.db` 文件恢复 AI 数据。流程：写入临时文件 → sanity check（sqlite + 包含 `skills` / `mem_facts` / `chat_history` 任一表）→ 原文件 rename 为 `.bak` → 替换 → `InitAIDB` 重新打开。

### `GET /api/app/data-profiles`

列出所有已保存的数据目录 profile（多账号切换）。

```json
{
  "profiles": [{ "id": "p1710...", "name": "主号", "path": "/path/to/decrypted", "last_indexed_at": 0 }],
  "active_dir": "/path/to/decrypted"
}
```

### `PUT /api/app/data-profiles`

批量保存 profile 列表（覆盖式）。`id` 为空的新条目会自动分配 `p<unixNano>`。

### `POST /api/app/switch-profile`

热切换激活的数据目录。调用 `validateDataDir` 预检 → `reinitSvc` 替换服务层 → 保存 `prefs.data_dir`。**无需重启进程**，但前端需要清掉 `localStorage.welink_hasStarted` 后刷新页面。

```json
{ "id": "p1710000000000" }
```

### `POST /api/app/frontend-log`

接收前端日志（console.error/warn 等），写入 `frontend.log`。

### `POST /api/app/bundle-logs`

打包 `welink.log` + `frontend.log` 为 ZIP，API Key 自动脱敏为 `[REDACTED]`。

### `GET /api/app/check-update`

后台轮询 GitHub Releases 检查是否有新版本，返回 `{ current, latest, has_update, release_notes }`。前端在启动 5s 后调用，弹 Release Notes Modal。


## 移动端配对

把 PC 端 WeLink 通过 LAN 共享给手机端 App（Phase 1）。开启 / 关闭 / 重新生成 token 都要求本机回环请求（`isLoopbackRequest`），手机端只能用 `verify` 探活。

token 存储在 `preferences.json` 的 `mobile_pairing_token` 字段（导出配置时脱敏）。

### `GET /api/app/pairing/status`

查询配对开关。同源（本机）才能看到 token 和 LAN IP 列表。

```json
{ "enabled": true, "token": "abc123...", "lan_ips": ["192.168.1.7", "10.0.0.3"] }
```

外部带对的 token 访问时只看到 `{ "enabled": true }`。

### `POST /api/app/pairing/enable`

开启配对，生成新 token。**仅限本机调用**，否则 403。

### `POST /api/app/pairing/disable`

关闭并清空 token（之前配过的手机全失效）。**仅限本机调用**。

### `POST /api/app/pairing/regen`

换新 token（老手机会失效，需要重新扫码）。**仅限本机调用**。

### `POST /api/app/pairing/verify`

手机 App 拿到 token 后探活，验证 OK 再存本地。此端点不在鉴权白名单里 — 用 `subtle.ConstantTimeCompare` 比较。

```json
{ "token": "abc123..." }
```

**响应**

```json
{ "ok": true, "version": "0.2.x" }
```


## 系统

### `GET /api/avatar?url=xxx`

头像代理（缓存 + CORS 处理）。

### `GET /api/open-url?url=xxx`

用系统默认浏览器打开 URL（仅 App 模式，仅允许 https）。

### `GET /api/swagger.json`

Swagger/OpenAPI 规范文件。

### `GET /api/anniversaries`

获取纪念日数据（自动检测 + 好友里程碑 + 自定义纪念日）。


## 错误响应格式

```json
{ "error": "错误描述" }
```

HTTP 状态码：`400` Bad Request / `500` Internal Server Error / `503` Service Unavailable（服务未初始化）。
