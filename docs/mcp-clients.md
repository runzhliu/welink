# MCP 客户端接入

WeLink 内置的 [MCP Server](./mcp-server) 提供 19 个工具，**任何支持 MCP 协议**的客户端都能接入。下面给主流客户端的配置片段，按流行度排。

::: tip 共同前提
所有客户端都通过启动 `welink-mcp` 可执行文件并通过 stdio 通信。你需要先：

1. 从 [Releases](https://github.com/runzhliu/welink/releases) 下载 `welink-mcp` 二进制（或 `cd mcp-server && go build -o welink-mcp .`）
2. 保证 WeLink 后端正在运行（默认 `http://localhost:8080`）
3. 如果后端端口 / 地址有变，设 `WELINK_URL=http://127.0.0.1:9090` 环境变量
:::

---

## Claude Code CLI

见 [mcp-server/README.md](https://github.com/runzhliu/welink/tree/main/mcp-server)（已有专门文档）。

## Claude Desktop

Claude Desktop 的 MCP 配置在不同系统下路径不同：

- **macOS**：`~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**：`%APPDATA%\Claude\claude_desktop_config.json`

在文件里加：

```json
{
  "mcpServers": {
    "welink": {
      "command": "/绝对路径/welink-mcp",
      "env": {
        "WELINK_URL": "http://localhost:8080"
      }
    }
  }
}
```

重启 Claude Desktop，在对话框右下角能看到"🔌 MCP"图标点开确认 `welink` 已连接。

## Cline（VS Code 扩展）

Cline 设置里 → **MCP Servers** → 点 "+" 添加：

```json
{
  "welink": {
    "command": "/绝对路径/welink-mcp",
    "env": {
      "WELINK_URL": "http://localhost:8080"
    },
    "disabled": false,
    "autoApprove": [
      "get_contact_stats",
      "get_groups",
      "get_global_stats"
    ]
  }
}
```

`autoApprove` 里列的工具不用每次弹确认。建议只 autoApprove 只读型工具（`get_*`），避免误操作。

## Continue.dev

`~/.continue/config.json`：

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "/绝对路径/welink-mcp",
          "args": [],
          "env": {
            "WELINK_URL": "http://localhost:8080"
          }
        }
      }
    ]
  }
}
```

## Windsurf（Codeium IDE）

Windsurf 的 MCP 配置在 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "welink": {
      "command": "/绝对路径/welink-mcp",
      "env": { "WELINK_URL": "http://localhost:8080" }
    }
  }
}
```

重启 Windsurf，在 Cascade 面板能看到 WeLink 的工具可调用。

## Zed

Zed 的 `settings.json`（`~/.config/zed/settings.json` 或 IDE 设置）：

```json
{
  "context_servers": {
    "welink": {
      "command": {
        "path": "/绝对路径/welink-mcp",
        "args": [],
        "env": { "WELINK_URL": "http://localhost:8080" }
      }
    }
  }
}
```

## GitHub Copilot Chat（VS Code）

Copilot Chat 2024 起支持 MCP。`.vscode/settings.json` 或全局 settings：

```json
{
  "github.copilot.chat.mcp.servers": {
    "welink": {
      "command": "/绝对路径/welink-mcp",
      "env": { "WELINK_URL": "http://localhost:8080" }
    }
  }
}
```

在 Copilot Chat 里输入 `@welink 我和谁聊天最多`。

## LibreChat

`librechat.yaml` 里：

```yaml
mcpServers:
  welink:
    type: stdio
    command: /绝对路径/welink-mcp
    env:
      WELINK_URL: http://host.docker.internal:8080  # Docker 部署时用这个
```

::: tip Docker 里访问宿主 WeLink
LibreChat 如果在 Docker 里跑，`localhost` 指的是容器内部。用 `host.docker.internal:8080`（Mac/Windows 通用），Linux 下在 compose 里加 `extra_hosts: - "host.docker.internal:host-gateway"`。
:::

## Jan

Jan 的 Extensions 管理有 MCP 支持，在 extension 设置里添加：

```json
{
  "name": "welink",
  "command": "/绝对路径/welink-mcp",
  "env": { "WELINK_URL": "http://localhost:8080" }
}
```

## LM Studio

LM Studio 0.3.5+ 支持 MCP。应用内设置 → Developer → MCP Servers，粘贴：

```json
{
  "welink": {
    "command": "/绝对路径/welink-mcp",
    "env": { "WELINK_URL": "http://localhost:8080" }
  }
}
```

## Warp AI / Fig

Warp 2024 底支持 MCP。Warp AI 设置 → MCP Tools → 添加：

```json
{
  "welink": {
    "command": "/绝对路径/welink-mcp",
    "env": { "WELINK_URL": "http://localhost:8080" }
  }
}
```

---

## 验证连接

每个客户端都有"列出可用工具"的入口。连接成功应该能看到这 19 个工具：

```
get_contact_stats        get_contact_detail      get_contact_wordcloud
get_contact_sentiment    get_contact_messages    get_global_stats
get_groups               get_group_detail        get_stats_by_timerange
get_self_portrait        get_money_overview      get_urls
get_cooling_contacts     get_companion_time      get_common_circle
get_contact_similarity   search_messages         get_ai_usage_stats
get_relationship_forecast
```

完整工具说明见 [MCP Server](./mcp-server)。

## 常见问题

### 连接失败 / 工具列表为空

1. 确认 `welink-mcp` 可执行且绝对路径正确（`chmod +x`）
2. 确认 WeLink 后端在跑：`curl http://localhost:8080/api/status` 应返 JSON
3. 检查客户端日志（Claude Desktop 在 `~/Library/Logs/Claude/mcp*.log`）

### 想暴露给容器里的客户端

WeLink 后端默认仅 `127.0.0.1`，容器访问不到宿主 `localhost`。两条路径：

- **用 Docker 模式跑 WeLink**：让 WeLink 和客户端在同一个 Docker network，用服务名互访
- **让后端监听所有网卡**：设环境变量 `WELINK_LISTEN_LAN=1`。注意**后端没内置 auth**，暴露到 LAN 前请加 HTTP Basic Auth 反代

### 多 WeLink 账号（profile）怎么选

WeLink 后端同时只服务一个 profile（设置页「多账号切换」）。MCP 自动跟随当前 profile。如果需要同时接多个账号，可以：

- 多跑几个 WeLink 后端进程，监听不同端口（`PORT=9091` / `PORT=9092`）
- 每个端口对应一个 MCP 配置（`welink-work` / `welink-family`）

---

## 相关链接

- [Model Context Protocol 官方规范](https://modelcontextprotocol.io/)
- [WeLink MCP Server 代码](https://github.com/runzhliu/welink/tree/main/mcp-server)
- [19 个工具完整说明](./mcp-server)
