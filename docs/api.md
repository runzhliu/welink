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
- [AI 分析](#ai-分析)
- [AI 分身](#ai-分身)
- [AI 群聊模拟](#ai-群聊模拟)
- [Skills（技能包）](#skills技能包)
- [RAG 检索](#rag-检索)
- [向量检索](#向量检索)
- [记忆提炼](#记忆提炼)
- [AI 对话历史](#ai-对话历史)
- [用户偏好](#用户偏好)
- [Gemini OAuth](#gemini-oauth)
- [锁屏](#锁屏)
- [数据库浏览器](#数据库浏览器)
- [导出中心](#导出中心)
- [App 管理（桌面版）](#app-管理桌面版)
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


## Skills（技能包）

把聊天记录炼化为 Claude Code / Codex / Cursor 等 AI 工具的 Skill 文件包。

### `POST /api/ai/forge-skill`

异步炼化任务。请求体主要字段：`skill_type`（`contact` / `self` / `group`）、`username`、`profile_id`、`msg_limit`、`output_format`（`claude-skill` / `claude-agent` / `codex` / `opencode` / `cursor` / `generic`）。返回 `skill_id`，用于后续查状态。

### `GET /api/skills`

已炼化的 Skill 列表（含状态 / 耗时 / 错误原因）。支持搜索、筛选、排序。

### `GET /api/skills/:id`

单个 Skill 详情（含元数据 + 生成的文件清单）。

### `GET /api/skills/:id/download`

下载 Skill 产物 zip 包。

### `DELETE /api/skills/:id`

删除单个 Skill（同时删除本地文件）。


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


## 用户偏好

### `GET /api/preferences`

获取当前用户偏好设置（屏蔽列表、隐私模式、LLM 配置等）。

### `PUT /api/preferences`

更新屏蔽列表和隐私模式。

### `PUT /api/preferences/llm`

更新 LLM 配置（多 Profile 支持、Embedding 配置、记忆提炼配置）。

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
