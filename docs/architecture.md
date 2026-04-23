# 整体架构

一张图看懂 WeLink 的组成和数据流向。

## 总览

```
                       ┌──────────────────────────────────────────┐
                       │             终端用户 (浏览器 / App)        │
                       └────────────────┬─────────────────────────┘
                                        │ HTTP / SSE
                                        ▼
          ┌───────────────────────────────────────────────────────┐
          │                      前端 (React)                     │
          │   Dashboard · AI 对话 · 设置 · 数据库 · 记忆库 · 播客   │
          └────────────────┬──────────────────────────────────────┘
                           │ REST + SSE
                           ▼
          ┌───────────────────────────────────────────────────────┐
          │              后端 (Go + Gin, 单 binary)               │
          │                                                       │
          │  ┌─────────┐  ┌────────┐  ┌──────┐  ┌──────┐  ┌────┐ │
          │  │ 统计分析 │  │ AI/LLM │  │ RAG  │  │ 记忆 │  │ TTS│ │
          │  │  服务   │  │ 多 provider│ FTS+向量│  提炼 │  代理│ │
          │  └─────────┘  └────┬───┘  └──┬───┘  └──────┘  └────┘ │
          │                    │         │                        │
          │              ┌─────▼─────────▼────┐                   │
          │              │   DB 管理器 (纯 Go) │                   │
          │              └─────┬─────────┬────┘                   │
          └────────────────────┼─────────┼────────────────────────┘
                               │         │
                      ┌────────▼───┐   ┌─▼──────────────┐
                      │ 解密后的    │   │ ai_analysis.db │
                      │ 微信 DB     │   │ AI 对话/记忆/  │
                      │ (contact/   │   │ 向量索引/播客   │
                      │  message)   │   │ 历史           │
                      └─────────────┘   └────────────────┘
                               ▲
                               │ 本地解密（不出机器）
                               │
                      ┌────────┴─────────────┐
                      │ wechat-decrypt       │
                      │ (从微信进程内存取 key) │
                      └──────────────────────┘

  外部可选集成（全部用户自备凭证）
  ─────────────────────────────────────────────────────────────────
  LLM:   OpenAI / Anthropic / Gemini / DeepSeek / Kimi / Ollama / Vertex / Bedrock
  导出:  Markdown / Notion / 飞书 / WebDAV / S3 / Dropbox / Google Drive / OneDrive
  MCP:   Claude Code / Claude Desktop / Cline / Continue / Windsurf / Zed / ... (独立 Go binary)
  TTS:   OpenAI / Azure / Edge-TTS (播客功能)
```

## 分层职责

### 前端 (`frontend/`)

React 18 + TypeScript + Tailwind。全局状态在 `App.tsx`；组件按功能分目录（`dashboard` / `contact` / `groups` / `memory` / `search` / `calendar` / `anniversary` / `timeline` / `skills`）。URL hash 路由支持浏览器前进后退。

### 后端 (`backend/`)

一个 Go module，单 binary 编译。文件扁平排列但逻辑分层明确：

| 层 | 关键文件 | 职责 |
|----|---------|------|
| HTTP 路由 | `main.go` | 所有 `/api/*` 端点注册；分 `api`（公开）和 `prot`（需服务就绪）两组 |
| 服务层 | `service/contact_service.go` | 启动时扫一次微信 DB，计算 `ContactStats` / `GlobalStats` 缓存到内存；按需查询走单联系人深度分析 |
| 仓储层 | `repository/message_repository.go` | 对 `DBManager` 的薄封装，提供消息查询原语 |
| DB 管理 | `pkg/db/manager.go` | `DBManager` 持有 `ContactDB` + N 个 `MessageDBs` + `ExtraDBs`（如 `ai_analysis.db`） |
| AI 存储 | `ai_store.go` / `mem.go` / `memory_api.go` | 独立管理 `ai_analysis.db`（对话历史、记忆事实、用量统计） |
| LLM 适配 | `llm.go` / `bedrock.go` / `vertex.go` / `auth_gemini.go` | 统一 `StreamLLM` 接口，provider 配置在 `LLMProfiles` |
| 检索 | `rag.go` / `vec.go` / `embedding.go` | FTS5 全文检索 + 向量检索，增量索引走 SSE 流式进度 |
| 导出 | `export_*.go` | 8 种目标（Markdown/Notion/飞书/WebDAV/S3/Dropbox/Drive/OneDrive）统一 collector 抽象 |
| 播客 | `podcast.go` / `podcast_store.go` | LLM 生成双主持人脚本 + TTS 代理合成 |
| 锁屏 | `lock.go` | bcrypt PIN + 自动锁定 |

### 平台相关

- `app_mode_darwin.go` / `app_mode_windows.go` / `_stub.go` —— WebView 启动、托盘菜单
- `app_config_darwin.go` / `_windows.go` —— 配置路径：`~/Library/Application Support/WeLink`、`%APPDATA%\WeLink`、或环境变量 `PREFERENCES_PATH`

### MCP Server (`mcp-server/`)

独立 Go module（零外部依赖，纯 stdlib），stdio JSON-RPC 2.0 协议，通过 HTTP 反向调用后端 `/api/*`。19 个工具让 Claude Code 等 MCP 客户端能用自然语言直接查询聊天数据。

## 两种部署形态

```
┌──────────────── App 模式（macOS/Windows）────────────────┐
│                                                          │
│   WeLink.app (build tag: app)                            │
│   ├─ HTTP Server (Go backend, localhost:8080)           │
│   └─ WebView (WKWebView / WebView2) 加载 localhost       │
│                                                          │
│   配置: ~/Library/Application Support/WeLink/ or        │
│         %APPDATA%\WeLink\                                │
└──────────────────────────────────────────────────────────┘

┌──────────────── Docker 模式 ─────────────────────────────┐
│                                                          │
│   ┌─────────────┐                                        │
│   │  frontend   │  nginx serving React dist             │
│   │  0.0.0.0:80 │  (映射 3418 到宿主)                    │
│   └──────┬──────┘                                        │
│          │ /api → proxy_pass                             │
│   ┌──────▼──────┐                                        │
│   │   backend   │  welink-backend binary                 │
│   │   :8080     │  (绑 127.0.0.1，仅从 frontend 访问)   │
│   └──────┬──────┘                                        │
│          │                                               │
│   ┌──────▼──────┐   ┌───────────────┐                    │
│   │ ./decrypted │   │ welink-prefs  │ (named volume)    │
│   │ (只读挂载)  │   │ preferences   │                    │
│   └─────────────┘   └───────────────┘                    │
└──────────────────────────────────────────────────────────┘
```

## AI 对话的数据流

```
 用户提问
    │
    ▼
 前端（AI 首页 / 联系人 AI 分身 / 跨联系人 QA）
    │
    ▼
 POST /api/ai/* (SSE)
    │
    ▼
 ┌── RAG 检索 ──────────────────────────────┐
 │  1. FTS5 关键词召回（message_content）    │
 │  2. 向量检索 top-K（余弦相似度）          │
 │  3. 记忆库 pinned facts 注入到 system    │
 │  4. Token budget 预算裁剪                 │
 └───────────────────────────────────────────┘
    │
    ▼
 LLM Provider (OpenAI / Claude / Gemini / Ollama / ...)
    │
    ▼
 SSE stream 回前端逐字显示
    │
    ▼
 落盘到 ai_analysis.db.ai_conversations
```

## 关键设计

- **本地优先**：微信数据库全程在本地机器解密、索引、检索；只有你明确触发 AI 对话时才会把相关片段发到你配置的 LLM 提供商
- **单 binary 部署**：后端 Go 源码编译成一个可执行文件，内嵌前端静态资源，Docker 镜像 < 50MB，也可打包成 macOS / Windows 桌面 App
- **零 CGO**：SQLite 用 modernc 纯 Go 实现，向量检索/FTS 全部走 Go，跨平台编译不依赖 C 工具链
- **MCP 集成**：独立的 `mcp-server` binary 通过本地 HTTP 反向代理后端 API，让 Claude Code 等 MCP 客户端能直接用自然语言查询你的聊天数据

## 相关文档

- [API 接口文档](/api)
- [数据库结构](/database)
- [索引与初始化](/indexing)
- [Docker 部署](/docker)
- [MCP Server](/mcp-server)
- [开发与构建](/development)
