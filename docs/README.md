# WeLink 技术文档

本目录存放 WeLink 项目的技术说明文档。


## 文档列表

| 文件 | 内容 |
|------|------|
| [api.md](./api.md) | 后端 REST API 接口文档，包含所有端点的参数、响应格式和字段说明 |
| [database.md](./database.md) | 数据库结构说明，包含 contact.db / message_N.db 表结构、消息类型、发送者识别机制 |
| [indexing.md](./indexing.md) | 索引与初始化流程，包含 SQLite 索引策略、并发模型、时间过滤机制 |
| [sentiment.md](./sentiment.md) | 情感分析算法说明，包含词典内容、评分流程、月度聚合逻辑 |
| [wordcloud.md](./wordcloud.md) | 词云生成说明，包含分词流程、停用词表、字号对数映射、WordCloud2 渲染参数 |
| [ai-analysis.md](./ai-analysis.md) | AI 分析功能说明，包含 LLM 配置、Embedding 配置、全量分析、混合检索（FTS5 + 向量 + 记忆提炼）、Gemini OAuth、API 端点 |
| [ollama-setup.md](./ollama-setup.md) | Ollama 本地 AI 配置指南，包含安装、模型拉取、WeLink 接入、Docker 网络配置、常见问题 |


## 快速参考

### 常用 API

```
POST /api/init          触发重新索引（传入时间范围）
GET  /api/status        查询索引进度
GET  /api/contacts/stats  获取全部联系人统计（缓存）
GET  /api/contacts/detail?username=xxx  联系人深度分析
GET  /api/contacts/messages?username=xxx&date=2024-03-15  某天聊天记录
GET  /api/contacts/wordcloud?username=xxx  词云数据（Top 120）
GET  /api/contacts/sentiment?username=xxx  情感分析（按月）
GET  /api/contacts/common-groups?username=xxx  与联系人的共同群聊
GET  /api/groups        群聊列表
```

### 消息表名计算

```python
import hashlib
table = "Msg_" + hashlib.md5(username.encode()).hexdigest()
```

### 发送者识别

私聊消息中，每个 message_N.db 的 `Name2Id` 表独立记录各自的 rowid 映射，**同一联系人在不同 DB 中的 rowid 不同**，必须在每个 DB 内单独查询：

```sql
SELECT rowid FROM Name2Id WHERE user_name = '<username>'
-- real_sender_id == 上述 rowid → 对方发的
-- real_sender_id != 上述 rowid → 我发的
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Go + Gin |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 数据库 | SQLite（modernc，纯 Go，无 CGO） |
| 全文检索 | SQLite FTS5 |
| 向量检索 | 余弦相似度（纯 Go，无外部依赖） |
| AI / LLM | OpenAI / Ollama / Gemini / 自定义（兼容 OpenAI 接口） |
| 中文分词 | go-ego/gse |
| 部署 | Docker Compose |
