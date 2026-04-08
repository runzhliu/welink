# 开发与构建指南

> 本文档面向希望参与 WeLink 开发或从源码构建的开发者。

## 前置要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Go | 1.23+ | 后端编译 |
| Node.js | 18+ | 前端构建 |
| Docker | 20+ | 容器化部署 |
| Git | 2.0+ | 版本管理 |

macOS App 额外需要：
- Xcode Command Line Tools（`xcode-select --install`）
- Python 3（用于 DMG 打包工具 `dmgbuild`）

Windows App 额外需要：
- [goversioninfo](https://github.com/josephspurrier/goversioninfo)（可选，用于嵌入图标和版本信息）

## 项目结构

```
welink/
├── backend/          # Go 后端（Gin + SQLite）
│   ├── main.go       # 入口 + 路由定义
│   ├── llm.go        # LLM 多 Provider 流式调用
│   ├── rag.go        # FTS5 全文检索
│   ├── vec.go        # 向量检索
│   ├── mem.go        # 记忆提炼
│   ├── service/      # 业务逻辑（分析、统计）
│   ├── pkg/db/       # 数据库管理
│   ├── config/       # 配置加载
│   └── Dockerfile    # Docker 构建
├── frontend/         # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx           # 主路由
│   │   ├── components/       # UI 组件
│   │   ├── hooks/            # 数据 Hook
│   │   ├── services/api.ts   # API 调用
│   │   ├── utils/            # 工具函数
│   │   └── types/            # TypeScript 类型
│   └── Dockerfile    # Docker 构建
├── mcp-server/       # MCP Server（Claude Code 集成）
├── docs/             # VitePress 官网
├── Makefile          # 构建自动化
└── docker-compose.yml
```

## 本地开发

### 后端

```bash
# 启动后端（默认端口 8080）
make dev-backend
# 或
cd backend && go run .
```

后端会读取 `../decrypted/` 目录下的微信解密数据库。如果没有数据，可以用 Demo 模式：

```bash
DEMO_MODE=true go run .
```

### 前端

```bash
# 启动 Vite 开发服务器（端口 3000，自动代理 /api 到 8080）
make dev-frontend
# 或
cd frontend && npm install && npm run dev
```

### 前后端联调

1. 终端 1：`make dev-backend`
2. 终端 2：`make dev-frontend`
3. 浏览器访问 `http://localhost:3000`

前端 `vite.config.ts` 已配置 `/api` 代理到 `localhost:8080`。

## 测试与检查

```bash
make test          # 后端单元测试（详细输出）
make test-short    # 后端单元测试（静默）
make lint          # go vet 代码检查（backend + mcp-server）
```

## 构建

### Docker 模式（推荐）

```bash
# 构建并启动（前端 + 后端）
make up-build

# 使用 Demo 数据
make demo-up-build

# 停止
make down
```

### 后端二进制

```bash
make build-backend
# 产物：backend/welink-backend
```

编译参数：
- `CGO_ENABLED=0`：纯 Go，无需 C 编译器
- `-ldflags` 自动注入版本号和 commit hash

### 前端静态资源

```bash
make build-frontend
# 产物：frontend/dist/
```

### MCP Server

```bash
make build-mcp
# 产物：mcp-server/welink-mcp
```

## 桌面 App 打包

### macOS DMG

```bash
make dmg
# 产物：dist/WeLink.dmg
```

构建过程：
1. 构建前端 → 复制到 `backend/static/`
2. 编译 arm64 + amd64 两个架构（CGO 开启，用于 WebView）
3. `lipo` 合并为 Universal Binary
4. 生成 `.app` Bundle（Info.plist + 图标）
5. Ad-hoc 签名 + 打包 DMG

::: tip 系统要求
- macOS 12+ SDK（`xcrun --sdk macosx --show-sdk-path`）
- Go 1.23+（支持 `go build -tags app`）
- `dmgbuild`（自动安装：`pip3 install dmgbuild`）
:::

### Windows EXE

```bash
make exe
# 产物：dist/WeLink-windows-amd64.zip
```

构建过程：
1. 构建前端 → 复制到 `backend/static/`
2. 生成 Windows 资源文件（图标 + 版本信息，需 `goversioninfo`）
3. 交叉编译 Windows amd64（CGO_ENABLED=0，纯 Go WebView2）
4. 打包为 ZIP

::: tip 交叉编译
可以在 macOS/Linux 上交叉编译 Windows 版本，不需要 Windows 机器：
```bash
GOOS=windows GOARCH=amd64 make exe
```
:::

## 版本号管理

版本号通过 `-ldflags` 在编译时注入，逻辑如下：

| 条件 | 版本号 | 示例 |
|------|--------|------|
| 有精确 tag（`git describe --tags --exact-match`） | tag（去掉 v 前缀） | `0.0.8` |
| 无 tag | `dev-<commit hash>` | `dev-abc1234` |

影响范围：
- 后端启动日志：`WeLink 0.0.8 (commit abc1234) starting...`
- 设置页"关于 WeLink"版本显示
- Swagger API 文档版本号
- macOS App Info.plist 版本
- Windows EXE 资源版本

## 服务器部署（多架构镜像推送）

```bash
# 首次：创建 buildx builder
docker buildx create --name welink --driver docker-container --use

# 构建并推送三个镜像到 Docker Hub
make server-push
```

`server-push` 会构建：

| 镜像 | 构建上下文 | 平台 |
|------|-----------|------|
| `runzhliu/welink-website` | `docs/` | linux/amd64 + linux/arm64 |
| `runzhliu/welink-frontend` | `frontend/` | linux/amd64 + linux/arm64 |
| `runzhliu/welink-backend` | `backend/` | linux/amd64 + linux/arm64 |

::: warning 镜像加速
国内网络拉取 Docker Hub base image 可能超时。创建 builder 时配置镜像加速：
```bash
cat > /tmp/buildkitd.toml << 'EOF'
[registry."docker.io"]
  mirrors = ["docker.1ms.run"]
EOF
docker buildx create --name welink --driver docker-container --config /tmp/buildkitd.toml --use
```
:::

服务器上拉取并启动：

```bash
make server-up      # 首次：docker compose pull + up
make server-pull    # 更新：git pull + docker pull + restart
```

## 官网构建

```bash
make docs-build       # 本地构建镜像
make docs-up          # 启动官网容器
make docs-build-push  # 跨平台构建并推送到 GHCR
```

官网使用 VitePress，构建时会注入版本号到 `install.md`（通过 Dockerfile `ARG VERSION`）。

## Build Tags

后端代码使用 Go build tags 区分运行模式：

| Tag | 说明 | 使用场景 |
|-----|------|---------|
| `app && darwin` | macOS 桌面版（WebView + 原生菜单） | `make dmg` |
| `app && windows` | Windows 桌面版（WebView2） | `make exe` |
| `!app` | 服务器模式（无 GUI） | `make build-backend` / Docker |

关键文件：
- `app_mode_darwin.go` / `app_mode_windows.go` / `app_mode_stub.go`
- `app_config_darwin.go` / `app_config_windows.go` / `app_config_stub.go`
- `static_embed.go`（App 模式嵌入前端）/ `static_embed_stub.go`

## 常用 Make 命令一览

```bash
make help              # 查看所有可用命令

# 开发
make dev-backend       # 启动后端
make dev-frontend      # 启动前端
make test              # 运行测试
make lint              # 代码检查

# Docker
make up                # 启动（已有镜像）
make up-build          # 构建并启动
make down              # 停止
make logs              # 查看日志

# Demo
make demo-up           # 启动 Demo
make demo-up-build     # 构建并启动 Demo

# 打包
make build             # 构建后端 + 前端
make dmg               # macOS DMG
make exe               # Windows EXE
make build-mcp         # MCP Server

# 部署
make server-push       # 构建多架构镜像并推送
make server-up         # 服务器拉取并启动
make server-pull       # 服务器一键更新

# 官网
make docs-build        # 构建官网镜像
make docs-up           # 启动官网

# 清理
make clean             # 删除所有构建产物
```
