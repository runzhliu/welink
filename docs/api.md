# API 接口文档

> 后端基于 Go + Gin，默认监听 `:8080`，所有接口前缀 `/api`。
> 在线文档：访问 `/swagger/` 可查看 Swagger UI。

## 目录

- [初始化与状态](#初始化与状态)
- [联系人分析](#联系人分析)
- [群聊分析](#群聊分析)
- [日历 / 时光机](#日历--时光机)
- [全局搜索](#全局搜索)
- [AI 分析](#ai-分析)
- [AI 分身](#ai-分身)
- [AI 群聊模拟](#ai-群聊模拟)
- [RAG 检索](#rag-检索)
- [向量检索](#向量检索)
- [记忆提炼](#记忆提炼)
- [AI 对话历史](#ai-对话历史)
- [用户偏好](#用户偏好)
- [Gemini OAuth](#gemini-oauth)
- [数据库浏览器](#数据库浏览器)
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

查询索引进度。

**响应**

```json
{ "is_indexing": false, "is_initialized": true, "total_cached": 312 }
```

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

群聊人物关系图（成员节点 + 交互边，含回复和提及权重）。


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
  "history": [{ "speaker": "张三", "content": "之前的消息" }],
  "rounds": 10,
  "topic": "可选，话题设定",
  "mood": "casual | heated | latenight | funny | serious",
  "members": ["张三", "李四"]
}
```

**SSE 响应**：每条 `data:` 为 `{ speaker, content }`，最后 `{ done: true }`。


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


## 用户偏好

### `GET /api/preferences`

获取当前用户偏好设置（屏蔽列表、隐私模式、LLM 配置等）。

### `PUT /api/preferences`

更新屏蔽列表和隐私模式。

### `PUT /api/preferences/llm`

更新 LLM 配置（多 Profile 支持、Embedding 配置、记忆提炼配置）。

### `PUT /api/preferences/anniversaries`

保存自定义纪念日。


## Gemini OAuth

### `GET /api/auth/gemini/url`

获取 Google Gemini OAuth 授权 URL。

### `GET /api/auth/gemini/callback`

OAuth 回调处理（交换 token）。

### `GET /api/auth/gemini/status`

检查 Gemini 授权状态。

### `DELETE /api/auth/gemini`

撤销 Gemini 授权。


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

保存文件到 `~/Downloads`（WebView 模式下替代浏览器下载）。

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
