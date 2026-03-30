# WeLink MCP Server

让 Claude Code（CLI）用自然语言直接查询你的微信聊天数据。


## 前提条件

WeLink 后端必须处于运行状态：

```bash
cd welink
docker compose up
```


## 构建

```bash
cd mcp-server
go build -o welink-mcp .
```

> 仓库中已预置编译好的 `welink-mcp` 二进制（macOS arm64），可直接使用。如需重新编译请执行上方命令。


## 配置 Claude Code

### 第一步：注册 MCP Server

编辑 `~/.claude.json`，在 `mcpServers` 字段中添加（注意替换为**绝对路径**）：

```json
{
  "mcpServers": {
    "welink": {
      "command": "/你的路径/welink/mcp-server/welink-mcp",
      "env": {
        "WELINK_URL": "http://localhost:8080"
      }
    }
  }
}
```

也可以用 Claude Code 命令行直接添加：

```bash
claude mcp add welink /你的路径/welink/mcp-server/welink-mcp -e WELINK_URL=http://localhost:8080
```

### 第二步：确认加载成功

启动 Claude Code 后执行：

```
/mcp
```

输出中应出现 `welink` 及其 9 个工具，状态为 connected。

### 第三步：配置 Skills（让 Claude 自动触发）

在 `~/.claude/CLAUDE.md` 中添加以下内容，Claude Code 遇到相关问题时会自动调用 WeLink 工具，无需手动指定：

```markdown
## WeLink MCP

当用户询问微信聊天数据、社交关系、消息统计、聊天记录，或任何与微信历史数据相关的问题时，
主动使用 WeLink MCP 工具（welink）来回答，不要让用户手动指定工具名。

可用工具：get_contact_stats、get_contact_detail、get_contact_wordcloud、
get_contact_sentiment、get_contact_messages、get_global_stats、
get_groups、get_group_detail、get_stats_by_timerange
```


## 示例问法

配置完成后直接用中文提问，Claude Code 会自动调用对应工具：

**好友关系**
- 「我和谁联系最多？列出前 10 名」
- 「帮我分析我和 alice 的关系深度」
- 「我有多少个好友完全没聊过天？」
- 「谁是我凌晨经常聊天的人？」
- 「我主动找 bob 聊天的比例是多少？」

**话题与情感**
- 「我和 alice 经常聊什么话题？」
- 「帮我看看我和 alice 最近一年的情感变化趋势」

**聊天记录**
- 「我和 alice 在 2024-03-15 聊了什么？」

**全局统计**
- 「我今年总共发了多少条消息？」
- 「我最忙的一天是哪天？」
- 「帮我看看我 24 小时内的聊天活跃规律」

**群聊**
- 「我哪个群最活跃？」
- 「工作群里谁发言最多？」

**时间范围**
- 「我在 2023 年的社交数据怎么样？」


## 可用工具表

| 工具名 | 说明 | 必填参数 |
|--------|------|----------|
| `get_contact_stats` | 所有联系人消息统计排名 | 无 |
| `get_contact_detail` | 某联系人深度画像（时段分布、深夜消息、红包等） | `username` |
| `get_contact_wordcloud` | 与某人聊天的高频词汇 | `username` |
| `get_contact_sentiment` | 与某人聊天的情感趋势（按月） | `username` |
| `get_contact_messages` | 与某人某天的完整聊天记录 | `username`, `date` |
| `get_global_stats` | 全局统计：总好友数、消息量、月趋势、深夜排行 | 无 |
| `get_groups` | 所有群聊列表及消息统计 | 无 |
| `get_group_detail` | 某群聊深度分析（成员排行、词云等） | `username` |
| `get_stats_by_timerange` | 按 Unix 时间戳范围过滤统计 | `from`, `to` |


## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WELINK_URL` | `http://localhost:8080` | WeLink 后端地址 |


## 排查问题

**`/mcp` 中 welink 未出现**
- 确认 `welink-mcp` 有执行权限：`chmod +x welink-mcp`
- 配置路径必须是绝对路径，不能用 `~`
- 重新启动 Claude Code

**调用时报「WeLink 后端未启动或无法访问」**
- 确认后端已启动：`curl http://localhost:8080/api/health`
- 如果端口不同，修改 `WELINK_URL`

**返回数据为空**
- 后端可能还在索引中，访问 `http://localhost:3000` 等待「分析完成」提示后再试
