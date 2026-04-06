# AI 分析功能文档

> 本文档描述 WeLink 的 AI 分析模块，涵盖 LLM 配置、Embedding 向量配置、全量分析、混合检索（RAG）、记忆提炼（mem0 风格）、分析历史持久化及所有相关 API 接口。

## 目录

- [AI 分析概览](#ai-分析概览)
- [LLM 配置](#llm-配置)
- [Embedding 配置](#embedding-配置)
- [Gemini OAuth 2.0 授权](#gemini-oauth-20-授权)
- [全量分析模式](#全量分析模式)
- [混合检索模式（RAG）](#混合检索模式rag)
  - [关键词索引（FTS5）](#关键词索引fts5)
  - [语义向量索引](#语义向量索引)
  - [记忆事实提炼（mem0 风格）](#记忆事实提炼mem0-风格)
  - [混合检索流程](#混合检索流程)
  - [完整 Prompt 结构（示例）](#完整-prompt-结构示例)
- [数据流与隐私边界](#数据流与隐私边界)
- [分析历史持久化](#分析历史持久化)
- [API 端点汇总](#api-端点汇总)
## AI 分析概览

WeLink 提供两种 AI 分析模式，适用于不同规模的聊天记录和不同的问题类型：

| 对比项 | 全量分析 | 混合检索（RAG） |
|--------|----------|-----------------|
| 工作方式 | 将指定时间范围内的全部消息直接发给 LLM | 语义向量 + 关键词双路检索，命中片段 + 提炼事实共同注入 LLM |
| 适用场景 | 消息量在模型上下文范围内；需要整体总结或趋势分析 | 消息量极大，或问题针对特定事件/人物特征；需要精准检索 |
| Token 消耗 | 与消息数量正相关，可能触发分段摘要 | 仅发送命中片段及上下文窗口，消耗稳定 |
| 索引要求 | 无需预先建索引 | 使用前需构建 FTS5 + 向量索引（一次性，可重建） |
| 超量处理 | 自动 Map-Reduce 分段摘要 | 不涉及超量（检索结果有上限） |
| 结果可溯源性 | 不显式标注来源 | 展示命中消息片段（含 `is_hit` 标记）和提炼事实 |

两种模式均通过 SSE（Server-Sent Events）流式返回 LLM 的增量响应，前端实时渲染。
## 自定义 Prompt 模板

WeLink 所有 AI 功能的系统提示词（System Prompt）完全透明，用户可以查看和自定义。

### 查看 Prompt

每个 AI 功能旁边都有 **「查看 Prompt」** 按钮，点击展示当前使用的完整 System Prompt，变量已替换为实际值。

### 编辑 Prompt

在 **设置 → Prompt 模板** 中，可以编辑以下功能的 Prompt：

| 模板 ID | 功能 | 说明 |
|---------|------|------|
| `insight_report` | 关系报告 | 分析关系发展阶段、沟通特点 |
| `insight_profile` | 风格画像 | 提炼性格标签、口头禅、聊天习惯 |
| `insight_diary` | AI 日记 | 根据当天记录写第一人称日记 |
| `cross_qa_intent` | 跨联系人问答 · 意图解析 | 解析用户问题为结构化 JSON |
| `cross_qa_answer` | 跨联系人问答 · 汇总回答 | 基于搜索结果生成回答 |
| `group_sim` | AI 群聊模拟 | 模拟群友风格继续聊天 |
| `clone_continue` | AI 对话续写 | 模拟双方继续聊天 |

### 变量

Prompt 中可以使用以下变量，运行时自动替换：

| 变量 | 说明 |
|------|------|
| `{{name}}` | 联系人显示名 |
| `{{today}}` | 当天日期（YYYY-MM-DD） |
| `{{rounds}}` | 对话续写/群聊模拟轮数 |
| `{{my_name}}` | 用户自己的称呼 |

### 恢复默认

编辑页面清空文本框并保存，即恢复为内置默认 Prompt。已自定义的模板会标记紫色「已自定义」标签。

自定义 Prompt 存储在 `preferences.json` 的 `prompt_templates` 字段中。
## LLM 配置

### 支持的 Provider

| Provider | 说明 | 默认模型 |
|----------|------|---------|
| `deepseek` | DeepSeek | `deepseek-chat` |
| `kimi` | Kimi（月之暗面） | `kimi-k2.5` |
| `gemini` | Google Gemini | `gemini-2.0-flash` |
| `glm` | 智谱 AI | `glm-4-flash` |
| `grok` | xAI Grok | `grok-3-mini` |
| `minimax` | MiniMax 国际版 | `MiniMax-Text-01` |
| `minimax-cn` | MiniMax 国内版 | `MiniMax-Text-01` |
| `openai` | OpenAI | `gpt-4o-mini` |
| `claude` | Anthropic Claude | `claude-haiku-4-5-20251001` |
| `ollama` | 本地 Ollama | `llama3` |
| `custom` | 自定义 | 用户指定 |

::: tip 说明
- Base URL 留空自动使用各 Provider 的默认地址，无需手动填写
- Claude 使用原生 API（`x-api-key` 鉴权），其他 Provider 均为 OpenAI 兼容格式
- Ollama 本地模式无需 API Key
:::

### 配置存储

所有 LLM 配置持久化在 `preferences.json` 中（路径见[分析历史持久化](#分析历史持久化)）：

```json
{
  "llm_provider": "deepseek",
  "llm_api_key": "sk-xxxx",
  "llm_base_url": "",
  "llm_model": "",
  "gemini_client_id": "",
  "gemini_client_secret": "",
  "ai_analysis_db_path": ""
}
```

`llm_base_url` 和 `llm_model` 留空时使用对应 provider 的默认值。

### 配置接口

**`PUT /api/preferences/llm`**

保存 LLM 相关配置。若 `ai_analysis_db_path` 发生变更，后端自动重新初始化 AI 数据库。

```json
{
  "llm_provider":         "deepseek",
  "llm_api_key":          "sk-xxxx",
  "llm_base_url":         "",
  "llm_model":            "",
  "gemini_client_id":     "",
  "gemini_client_secret": "",
  "ai_analysis_db_path":  "",
  "mem_llm_base_url":     "",
  "mem_llm_model":        ""
}
```

**响应**

```json
{ "ok": true }
```

| 字段 | 说明 |
|------|------|
| `llm_provider` | 选择的 provider（见上表） |
| `llm_api_key` | API Key（Ollama 可留空） |
| `llm_base_url` | 自定义 Base URL（留空使用默认值） |
| `llm_model` | 模型名称（留空使用默认值） |
| `gemini_client_id` | Gemini OAuth Client ID（可选） |
| `gemini_client_secret` | Gemini OAuth Client Secret（可选） |
| `ai_analysis_db_path` | AI 分析数据库自定义路径（留空与 preferences.json 同目录） |
| `mem_llm_base_url` | 记忆提炼专用本地模型地址（留空则复用主 LLM，见下文） |
| `mem_llm_model` | 记忆提炼专用模型名（留空则复用主 LLM） |

**`POST /api/ai/llm/test`** — 测试主 LLM 连接是否正常（会先使用当前保存的配置发送 "Hi"）

```json
{ "ok": true, "provider": "deepseek", "model": "deepseek-chat" }
```

**`POST /api/ai/mem/test`** — 测试记忆提炼模型连接是否正常

```json
{ "ok": true, "provider": "ollama", "model": "qwen2.5:7b" }
```
## Embedding 配置

语义向量索引和记忆提炼依赖 Embedding 模型将文本转换为向量。WeLink 支持本地和云端两种方案。

> **推荐方案**：使用本地 Ollama 运行 `nomic-embed-text`，免费、离线、隐私安全。
> 详细安装步骤见 [Ollama 配置指南](/ollama-setup)。

### 支持的 Embedding Provider

| Provider | 说明 | 默认模型 | 默认维度 |
|----------|------|---------|---------|
| `ollama` | 本地 Ollama（**推荐**，免费离线） | `nomic-embed-text` | 768 |
| `openai` | OpenAI 云端 API | `text-embedding-3-small` | 1536 |
| `jina` | Jina AI 云端 API | `jina-embeddings-v3` | 1024 |
| `custom` | 自定义 OpenAI 兼容接口 | 用户指定 | 用户指定 |

### 配置存储

Embedding 配置与 LLM 配置共同持久化在 `preferences.json` 中：

```json
{
  "embedding_provider": "ollama",
  "embedding_api_key":  "",
  "embedding_base_url": "",
  "embedding_model":    "",
  "embedding_dims":     0
}
```

`embedding_base_url`、`embedding_model`、`embedding_dims` 留空时使用对应 provider 的默认值。

### 配置接口

`PUT /api/preferences/llm` 同时负责保存 LLM 和 Embedding 配置，两个区块相互独立、互不覆盖：

```json
{
  "embedding_provider": "ollama",
  "embedding_api_key":  "",
  "embedding_base_url": "",
  "embedding_model":    "nomic-embed-text"
}
```

**`POST /api/ai/vec/test-embedding`** — 测试 Embedding 连接是否正常

```json
{ "ok": true, "provider": "ollama", "model": "nomic-embed-text" }
```

若连接失败，返回：
```json
{ "error": "Ollama embedding 错误 404：..." }
```

> 三个配置区块均有「测试连接」按钮，点击后先保存当前填写的配置，再发一次测试请求，成功时显示实际生效的 provider 和 model 名称。
## Gemini OAuth 2.0 授权

Gemini provider 支持两种鉴权方式，二选一：

1. **API Key**：在设置中直接填写 Gemini API Key。
2. **Google OAuth 2.0**：通过标准 OAuth 流程授权，无需手动管理 API Key，Token 到期自动刷新。

### 授权流程

```
前端                    后端                         Google
  │                      │                              │
  ├─ GET /api/auth/gemini/url ──────────────────────────►│
  │◄──────── {"url": "https://accounts.google.com/..."} │
  │                      │                              │
  ├── 打开浏览器 ──────────────────────────────────────►│
  │                      │          用户完成授权         │
  │                      │◄─── GET /api/auth/gemini/callback?code=xxx ──
  │                      │                              │
  │                      ├─ 用 code 换 access_token ──►│
  │                      │◄──── tokens ────────────────│
  │                      │                              │
  │                      ├─ 保存到 preferences.json     │
  │◄─ 前端轮询 GET /api/auth/gemini/status ─────────────│
```

### Token 自动刷新

当 `access_token` 距离过期不足 60 秒时，后端在每次调用 LLM 前自动使用 `refresh_token` 换取新 Token 并写回 `preferences.json`，无需用户干预。

### 授权相关接口

**`GET /api/auth/gemini/url`** — 获取 Google 授权链接

```json
{ "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```

**`GET /api/auth/gemini/callback`** — Google 回调（浏览器自动跳转）

授权成功后展示成功页面并自动关闭（3 秒后）；授权失败展示错误原因。

**`GET /api/auth/gemini/status`** — 查询授权状态

```json
{ "authorized": true }
```

**`DELETE /api/auth/gemini`** — 撤销授权

清除 `access_token`、`refresh_token` 和 `token_expiry`。

```json
{ "ok": true }
```
## 全量分析模式

### 工作流程

1. 前端选择目标联系人/群聊和时间范围，根据消息数量估算 Token 用量。
2. 前端对聊天内容进行隐私脱敏处理后，通过对话消息列表发送至 `POST /api/ai/analyze`。
3. 后端直接将消息转发给 LLM，以 SSE 流式返回增量结果。

### Token 估算

前端预估公式：

```
estimated_tokens = msgCount × 15 + 500
```

各 provider 上下文上限（按模型实际限制的 80% 保守估计）：

| Provider | 模型上限 | 80% 保守限制 |
|----------|---------|-------------|
| deepseek | 64,000 | 51,200 |
| kimi | 128,000 | 102,400 |
| gemini | 1,000,000 | 800,000 |
| glm | 128,000 | 102,400 |
| grok | 131,000 | 104,800 |
| openai | 128,000 | 102,400 |
| claude | 200,000 | 160,000 |
| ollama / custom | 8,000 | 6,400 |

估算超出上限时，前端展示"将自动分段摘要"提示，用户可提前缩短时间范围。

### 超量自动 Map-Reduce 分段摘要

当消息 Token 数超过 provider 上限时，前端自动切换为分段摘要策略：

```
CHUNK_SIZE = max(150, floor(limit × 0.4 / 15))
```

流程：

1. 将消息按 `CHUNK_SIZE` 切分为若干块。
2. 对每块调用 `POST /api/ai/complete`（非流式），获取该块的摘要。
3. 将所有块的摘要合并，连同用户问题一起调用 `POST /api/ai/analyze`（SSE 流式），得到最终答案。

前端通过 `chunkProgress: { current, total }` 状态展示分段进度。

### 隐私脱敏

在发送给 LLM 之前，前端对聊天文本进行以下替换（均在客户端完成，原文不离开浏览器）：

| 数据类型 | 匹配规则 | 替换为 |
|---------|---------|--------|
| 大陆手机号 | `1[3-9]XXXXXXXXX`（11 位） | `[手机号]` |
| 18 位居民身份证 | 标准格式，含末位 X | `[身份证]` |
| 15 位旧身份证 | 15 位纯数字 | `[身份证]` |
| 电子邮箱 | 标准邮箱格式 | `[邮箱]` |
| 银行卡/账号 | 16–19 位连续数字 | `[卡号]` |
| 联系人姓名 | 私聊中显示名（≥2 字）精确匹配 | `[联系人]` |

> 群聊中成员名过多，不做名称替换。

### 分析接口

**`POST /api/ai/analyze`** — 全量分析（SSE 流式）

```json
{
  "username": "wxid_abc123",
  "is_group": false,
  "from": 1672531200,
  "to":   1704067200,
  "messages": [
    { "role": "system",    "content": "系统提示（含聊天记录文本）" },
    { "role": "user",      "content": "请分析我们的聊天关系" }
  ]
}
```

**响应（SSE 流）**

```
data: {"delta":"根据"}

data: {"delta":"聊天记录"}

data: {"done":true}
```

每个 SSE 事件的 JSON 结构：

| 字段 | 说明 |
|------|------|
| `delta` | 本次增量文本 |
| `done` | `true` 表示流结束 |
| `error` | 错误信息（仅出错时出现） |

**`POST /api/ai/complete`** — 非流式单次补全（分段摘要用）

```json
{
  "messages": [
    { "role": "user", "content": "请用 200 字摘要以下聊天记录：\n..." }
  ]
}
```

**响应**

```json
{ "content": "摘要文本..." }
```
## 混合检索模式（RAG）

混合检索模式由三层索引构成，相互补充，显著提升对自然语言问题的理解和回答准确度：

```
用户问题
    │
    ├─ 查询改写（LLM）────► 关键词索引（FTS5）────┐
    │                                              ├─ 合并去重 → 注入 LLM
    └─────────────────────► 语义向量索引 ──────────┘
                                                   + 记忆事实（LLM 提炼）
```

所有索引存储在 `ai_analysis.db`（与对话历史共用同一 SQLite 文件）。

### Key 命名规则

```
私聊：contact:{username}
群聊：group:{username}
```

示例：`contact:wxid_abc123`、`group:12345678@chatroom`
### 关键词索引（FTS5）

基于 SQLite FTS5 的全文检索，适合精确关键词匹配。

**表结构**

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(
    content,                  -- 消息文本（索引列）
    sender      UNINDEXED,
    datetime    UNINDEXED,
    contact_key UNINDEXED,
    seq         UNINDEXED,    -- 消息序号（用于窗口扩展）
    tokenize = 'trigram'
);
```

**构建索引**

**`POST /api/ai/rag/build-index`** — 构建或重建 FTS5 索引（SSE 进度流）

```json
{ "key": "contact:wxid_abc123", "username": "wxid_abc123", "is_group": false }
```

**SSE 进度事件**

```
data: {"step":"loading"}
data: {"step":"indexing","current":500,"total":12500}
data: {"step":"done","total":12500,"done":true}
```

**`GET /api/ai/rag/index-status?key=contact:wxid_abc123`** — 查询状态

```json
{ "built": true, "msg_count": 12500, "built_at": 1748131200 }
```

**查询词处理（`prepareFTSQuery`）**

对自然语言问句提取检索词：按虚词切分后，≥ 3 字段进入 FTS5 MATCH，= 2 字段进入 LIKE 兜底，1 字忽略。

| 原始问句 | FTS5 查询 |
|---------|----------|
| `她的工作地点是哪里` | `"工作地点"` |
| `情感升温降温的转折点` | `"情感升温 OR 降温 OR 转折点"` |

命中后扩展 ±5 条上下文窗口，相邻区间自动合并。
### 语义向量索引

基于 Embedding 模型的余弦相似度检索，弥补关键词检索的语义盲区（如"爱好"↔"喜欢"、"工作"↔"职业"）。

> **依赖**：需要先完成 [Embedding 配置](#embedding-配置)。本地推荐使用 Ollama + `nomic-embed-text`，参见 [Ollama 配置指南](/ollama-setup)。

**表结构**

```sql
CREATE TABLE IF NOT EXISTS vec_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_key TEXT    NOT NULL,
    seq         INTEGER NOT NULL,
    datetime    TEXT    NOT NULL,
    sender      TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    embedding   BLOB    NOT NULL  -- little-endian float32 向量
);
```

**构建索引（后台运行）**

**`POST /api/ai/vec/build-index`** — 启动后台构建，立即返回

```json
{ "key": "contact:wxid_abc123", "username": "wxid_abc123", "is_group": false }
```

**`GET /api/ai/vec/build-progress?key=contact:wxid_abc123`** — 轮询进度

```json
{
  "running":    true,
  "step":       "embedding",
  "current":    2000,
  "total":      12500,
  "done":       false,
  "fact_count": 0
}
```

| `step` 值 | 含义 |
|-----------|------|
| `loading` | 正在加载消息 |
| `embedding` | 批量向量化中（`current`/`total` 表示进度） |
| `extracting` | 调用 LLM 提炼记忆事实中 |
| `done` | 完成（`fact_count` 为提炼的事实数） |
| `error` | 出错（`error` 字段含错误描述） |

**`GET /api/ai/vec/index-status?key=contact:wxid_abc123`** — 查询状态

```json
{ "built": true, "msg_count": 12500, "built_at": 1748131200, "model": "nomic-embed-text", "dims": 768 }
```

**技术细节**

- 每条消息向量化前截断至 400 个 Unicode 字符，避免超出 Embedding 模型上下文长度
- 大群聊分块加载（5000 条/批），峰值内存 ≤ 30 MB（1536 维）或 ≤ 15 MB（768 维）
- 检索时取 top-20，再扩展 ±3 条上下文窗口
### 记忆事实提炼（mem0 风格）

> **无需安装任何额外服务。** 这是 WeLink 内置的功能，参考 [mem0](https://github.com/mem0ai/mem0) 的思路自行实现，数据存在本地 SQLite 中。

#### 触发方式

有两种触发方式：

1. **自动触发**：点击「构建」语义向量索引后，后台自动依次执行 embedding → 提炼事实，无需额外操作。
2. **独立触发**：语义向量索引已建立后，可在 AI 分析面板的「记忆事实」卡片中单独点击「提炼」或「重新提炼」按钮，不需要重建整个向量索引。

**前提条件**：
- 已在设置中配置 **Embedding**（提供向量化能力）
- 已在设置中配置 **LLM**（提供事实提炼能力）

若未配置 LLM，embedding 步骤正常完成，仅跳过提炼，不影响语义检索。

构建完成后，AI 分析面板显示已提炼的事实数量，点击可展开查看全部事实；之后每次对话时自动检索相关事实注入上下文。

#### 隐私隔离设计

提炼事实时，后端通过 `memLLMPrefs()` 决定使用哪个模型：

```
是否配置了专用本地模型（mem_llm_base_url / mem_llm_model）？
    ├── 是 → 强制使用 provider=ollama，APIKey=""，走配置的本地地址和模型
    │         原始聊天内容仅发给本地模型，不经过主 LLM（云端）
    └── 否 → 直接复用主 LLM 配置
```

若希望保护原始聊天内容的隐私，可在设置中配置「记忆提炼模型（本地专用）」，填写 Ollama 的 Base URL 和模型名。
留空时，提炼任务与主 LLM 共用同一模型（适合主 LLM 本身也是本地 Ollama 的场景，或用户对隐私无顾虑时）。

#### 工作流程

```
消息（每 80 条一批）
    │
    ▼ 拼成纯文本 prompt，调用 LLM 提炼
["对方喜欢爬山", "对方在北京工作", "对方有一只猫叫花花"]
    │
    ▼ 每条事实单独 Embedding 向量化
    │
    ▼ 存入 mem_facts 表（fact + embedding）
    │
    ▼ 对话时：用问题向量检索 top-10 相关事实
    │         以「已知事实」section 注入 system prompt
```

LLM 提炼时使用的 prompt（每 80 条一批）：

```
从以下聊天记录中提取关键事实，以JSON数组格式输出。
规则：
1. 每条事实是一句完整的中文陈述
2. 只提取有价值的信息：喜好、经历、观点、习惯、工作、地点、人际关系等
3. 忽略寒暄、日常问候、无意义闲聊
4. 用【对方】指代聊天对象
5. 只输出JSON数组，不加任何解释
6. 如果没有有价值的事实，输出：[]
```

返回的 JSON 数组（如 `["对方喜欢爬山", "对方在北京工作"]`）中每条事实再做 embedding 存库，之后对话时语义检索召回。

#### 表结构

```sql
CREATE TABLE IF NOT EXISTS mem_facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_key TEXT    NOT NULL,
    fact        TEXT    NOT NULL,     -- 提炼出的事实陈述
    source_from INTEGER NOT NULL,     -- 来源消息序号范围（起）
    source_to   INTEGER NOT NULL,     -- 来源消息序号范围（止）
    embedding   BLOB    NOT NULL
);
```

#### 对 LLM 的要求

| 模型规格 | 中文提炼效果 |
|---------|------------|
| 云端模型（DeepSeek、Kimi 等） | 优秀，推荐 |
| Ollama `qwen2.5:7b` | 良好，首选本地方案 |
| Ollama `qwen2.5:3b` | 一般，偶有格式错误（自动跳过） |
| 1B 以下模型 | 不推荐，结构化输出能力不足 |

若未配置 LLM，提炼步骤自动跳过，不影响向量索引主流程。

#### 记忆事实相关接口

**`GET /api/ai/mem/status?key=contact:wxid_abc123`** — 查询已提炼事实数量

```json
{ "fact_count": 87 }
```

**`GET /api/ai/mem/facts?key=contact:wxid_abc123`** — 获取所有事实列表

```json
{
  "facts": [
    { "id": 1, "fact": "对方喜欢爬山，基本每月一次", "source_from": 0, "source_to": 79 },
    { "id": 2, "fact": "对方在北京工作", "source_from": 0, "source_to": 79 }
  ]
}
```

**`POST /api/ai/mem/build?key=contact:wxid_abc123`** — 独立触发记忆事实提炼（无需重建向量索引）

复用向量索引已有的消息数据，仅执行 LLM 提炼 + Embedding 存库步骤。
进度通过 `GET /api/ai/vec/build-progress` 轮询（step = `extracting` → `done`）。

```json
{ "started": true }
```

若向量索引为空（尚未构建），返回 `error: "语义向量索引为空，请先构建索引"`。

#### 注入效果示例

用户问"她的爱好是什么"时，LLM 收到的上下文（简化）：

```
【关于对方的已知事实（由 AI 从历史聊天中提炼）】
- 对方喜欢爬山，基本每月一次
- 对方养了一只猫叫花花
- 对方喜欢看推理小说

【检索到的相关聊天片段】
[2024-03-01] 对方：周末去爬香山了，累死了
...
```
### 混合检索流程

**`POST /api/ai/rag`** — 混合检索并流式回答（SSE）

```json
{
  "key":          "contact:wxid_abc123",
  "messages":     [{ "role": "user", "content": "她的爱好是什么？" }],
  "search_query": ""
}
```

内部流程：

1. **查询改写**：调用 LLM 将自然语言问题展开为检索关键词（如"爱好"→"喜欢 兴趣 hobby 爬山 运动"）
2. **向量检索**：用原始问题 embedding 做余弦相似度搜索（top-20）
3. **关键词检索**：用改写后的关键词做 FTS5 MATCH（top-20）
4. **记忆检索**：用原始问题从 `mem_facts` 检索相关事实（top-10）
5. **合并**：向量 + FTS5 结果按 seq 去重合并，任一来源命中均标记 `is_hit`
6. **注入 LLM**：检索片段 + 记忆事实共同注入 system prompt，流式返回回答

**SSE 响应**

第一个事件携带 RAG 元数据：

```
data: {"rag_meta":{"hits":8,"retrieved":52,"messages":[...]}}
```

后续为 LLM 增量文本：

```
data: {"delta":"根据检索到的聊天记录，她喜欢爬山，"}
data: {"delta":"基本每个月都会去一次。"}
data: {"done":true}
```

**`rag_meta.messages` 中每条消息结构**

```json
{
  "datetime": "2024-03-15 14:30:00",
  "sender":   "对方",
  "content":  "周末去爬香山了，累死了",
  "is_hit":   true
}
```

| 字段 | 说明 |
|------|------|
| `is_hit` | `true` = 直接命中；`false` = 上下文窗口扩展补入 |

> 若所有索引均无匹配内容，接口返回提示文本后结束流，建议切换全量分析模式。
### 完整 Prompt 结构（示例）

以用户问「我和他关系怎么样？」、已提炼 38 条事实、检索到 52 条相关片段为例，后端构建的完整 LLM 请求如下。

#### 第一次 LLM 调用：查询改写（非流式）

```
System: 你是一个检索关键词提取助手，输出结果只包含空格分隔的关键词，不含任何其他内容。

User:   将下面的问题转化为聊天记录检索关键词，输出5-10个空格分隔的词，
        只输出关键词，不要任何解释或标点：
        我和他关系怎么样？
```

LLM 返回示例：`关系 感情 交流 熟悉 互动 沟通`

> 这次调用只发送用户的问句（约 20–50 字），**不包含任何聊天记录**。
> 若调用失败，后端自动降级：直接用原始问句作为检索词，流程继续。

#### 第二次 LLM 调用：生成回答（流式）

```
System: 你是一个聊天记录分析助手。以下是从聊天记录中混合检索（语义向量 + 关键词）到
        的相关片段（命中 8 条，含上下文共 52 条）：

        [2024-03-01 10:23] 厄德高：最近怎么样
        [2024-03-01 10:25] 我：还行，你呢
        [2024-03-01 10:26] 厄德高：最近有点忙，北京这边项目压力大
        ……（约 50 条检索片段，非全量聊天记录）

        【关于对方的已知事实（由 AI 从历史聊天中提炼）】
        - 对方在北京工作
        - 对方喜欢爬山
        - 对方和弟弟关系好
        - 对方在广州有亲戚
        ……（从 38 条事实中语义匹配召回的 top-10 相关条目）

        请根据以上内容回答用户问题，分析时请客观有洞察力，用中文回答。

User:   我和他关系怎么样？
```

> **关键点：**
> - 发给 LLM 的聊天片段来自双路检索（向量 + 关键词），**不是全量聊天记录**，通常只有几十条。
> - 记忆事实部分最多注入 top-10 条（按语义相关性从已提炼事实中选取），**不是全部事实**。
> - 多轮对话时，历史问答也会追加在 User/Assistant 位置之后，模型具备上下文感知。
## 数据流与隐私边界

### 混合检索模式下的两次 LLM 调用

| 调用 | 目的 | 发给 LLM 的内容 | 含原始聊天？ |
|------|------|----------------|------------|
| 第 1 次（非流式） | 查询改写，提取检索关键词 | 用户问句（约 20–50 字） | ❌ 不含 |
| 第 2 次（流式） | 生成回答 | 检索到的相关片段（约几十条）+ 相关记忆事实（top-10） | ✅ 含（部分） |

### 全量分析模式

发给 LLM 的内容为**指定时间范围内的全部聊天记录**（经前端隐私脱敏处理后）加上用户问题。当消息量超出模型上下文上限时，自动进行 Map-Reduce 分段摘要——每一段同样包含该段的完整内容。

### 记忆提炼

提炼阶段，**全量原始聊天记录**会被分批（每 80 条一批）发给提炼模型。这是所有操作中外发聊天内容量最大的环节。

通过「记忆提炼模型」专项配置，可将提炼流量路由到本地 Ollama，与主 LLM 完全隔离：

```
mem_llm_base_url / mem_llm_model 均留空？
    ├── 是 → 复用主 LLM（云端大模型会收到全量聊天记录）
    └── 否 → 强制使用本地 Ollama（原始聊天内容不出本机）
```

**推荐组合**：提炼用本地 Ollama（如 `qwen2.5:7b`）+ 日常对话用云端大模型。
这样提炼时数据留本地，日常提问时 LLM 只收到检索片段，兼顾隐私与回答质量。

### 各阶段数据流向汇总

| 阶段 | 在哪里运行 | 涉及原始聊天量 | 是否外发 |
|------|-----------|--------------|---------|
| FTS5 关键词索引构建 | 本地 SQLite | 全量 | ❌ |
| 语义向量索引构建 | 本地 Ollama Embedding | 全量 | ❌ |
| 记忆提炼（未配置专用模型） | **主 LLM（可能云端）** | **全量** | ⚠️ 外发 |
| 记忆提炼（配置本地模型） | 本地 Ollama | 全量 | ❌ |
| 混合检索 · 查询改写 | **主 LLM（可能云端）** | 仅用户问句 | ⚠️ 外发（极少） |
| 混合检索 · 生成回答 | **主 LLM（可能云端）** | 相关片段（约几十条） | ⚠️ 外发（少量） |
| 全量分析 · 生成回答 | **主 LLM（可能云端）** | 时间范围内全量 | ⚠️ 外发（大量） |

> **结论**：若对隐私有顾虑，最关键的两个设置是：
> 1. 「记忆提炼模型」配置为本地 Ollama，防止全量聊天外发。
> 2. 日常 Q&A 优先使用「混合检索」而非「全量分析」，LLM 只看到片段。
## 分析历史持久化

### 存储机制

AI 对话历史存储在 SQLite 数据库 `ai_analysis.db` 中，与 FTS5 索引共用同一文件。

**默认路径**

| 运行模式 | 路径 |
|---------|------|
| macOS App | `~/Library/Application Support/WeLink/ai_analysis.db` |
| Docker / CLI | 与 `preferences.json` 同目录 |
| 自定义 | `preferences.json` 中 `ai_analysis_db_path` 字段指定 |

**表结构 `ai_conversations`**

```sql
CREATE TABLE IF NOT EXISTS ai_conversations (
    key        TEXT    NOT NULL PRIMARY KEY,  -- contact:{username} 或 group:{username}
    messages   TEXT    NOT NULL DEFAULT '[]', -- JSON 数组，元素为 {role, content}
    updated_at INTEGER NOT NULL               -- Unix 秒时间戳
);
```

### 前端持久化策略

- **加载**：组件挂载时调用 `GET /api/ai/conversations?key=`，每个 key 仅加载一次（由 `dbLoaded` 标记控制），避免重复请求。
- **保存**：每次消息更新后，防抖 800ms 触发 `PUT /api/ai/conversations`，仅保存 `streaming=false` 的已完成消息。
- **清除**：用户手动清空时调用 `DELETE /api/ai/conversations?key=`。

### 历史记录接口

**`GET /api/ai/conversations?key=contact:wxid_abc123`** — 加载历史

```json
{
  "messages": [
    { "role": "user",      "content": "请分析我们的聊天关系" },
    { "role": "assistant", "content": "根据聊天记录分析..." }
  ]
}
```

> 若无历史记录，`messages` 为空数组，不返回错误。

**`PUT /api/ai/conversations`** — 保存历史

```json
{
  "key": "contact:wxid_abc123",
  "messages": [
    { "role": "user",      "content": "请分析我们的聊天关系" },
    { "role": "assistant", "content": "根据聊天记录分析..." }
  ]
}
```

```json
{ "ok": true }
```

**`DELETE /api/ai/conversations?key=contact:wxid_abc123`** — 删除历史

```json
{ "ok": true }
```
## API 端点汇总

| 方法 | 路径 | 说明 | 响应类型 |
|------|------|------|---------|
| `PUT` | `/api/preferences/llm` | 保存 LLM + Embedding 配置 | JSON |
| `GET` | `/api/auth/gemini/url` | 获取 Google OAuth 授权链接 | JSON |
| `GET` | `/api/auth/gemini/callback` | Google OAuth 回调（浏览器跳转） | HTML |
| `GET` | `/api/auth/gemini/status` | 查询 Gemini 授权状态 | JSON |
| `DELETE` | `/api/auth/gemini` | 撤销 Gemini OAuth 授权 | JSON |
| `POST` | `/api/ai/analyze` | 全量分析（SSE 流式） | SSE |
| `POST` | `/api/ai/complete` | 非流式单次补全（分段摘要） | JSON |
| `POST` | `/api/ai/rag/build-index` | 构建/重建 FTS5 关键词索引（SSE 进度） | SSE |
| `GET` | `/api/ai/rag/index-status` | 查询 FTS5 索引状态 | JSON |
| `POST` | `/api/ai/vec/build-index` | 启动语义向量索引后台构建 | JSON |
| `GET` | `/api/ai/vec/build-progress` | 轮询向量索引构建进度 | JSON |
| `GET` | `/api/ai/vec/index-status` | 查询向量索引状态 | JSON |
| `POST` | `/api/ai/llm/test` | 测试主 LLM 连接 | JSON |
| `POST` | `/api/ai/vec/test-embedding` | 测试 Embedding 连接 | JSON |
| `POST` | `/api/ai/mem/test` | 测试记忆提炼模型连接 | JSON |
| `GET` | `/api/ai/mem/status` | 查询已提炼记忆事实数量 | JSON |
| `GET` | `/api/ai/mem/facts` | 获取全部记忆事实列表 | JSON |
| `POST` | `/api/ai/mem/build` | 独立触发记忆事实提炼（不重建向量索引） | JSON |
| `POST` | `/api/ai/rag` | 混合检索并流式回答（SSE） | SSE |
| `GET` | `/api/ai/conversations` | 加载对话历史 | JSON |
| `PUT` | `/api/ai/conversations` | 保存对话历史 | JSON |
| `DELETE` | `/api/ai/conversations` | 删除对话历史 | JSON |

### 通用错误响应

```json
{ "error": "请先在设置中配置 AI 接口" }
```

| HTTP 状态码 | 含义 |
|------------|------|
| `400` | 请求参数缺失或格式错误 |
| `500` | 后端处理失败（数据库错误、LLM 调用失败等） |

SSE 流中的错误通过独立事件推送，不中断连接：

```
data: {"error":"API 错误 401：Unauthorized"}

data: {"done":true}
```
