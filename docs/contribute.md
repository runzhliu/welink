# 贡献指南

欢迎参与 WeLink！无论是报 bug、提建议、写代码、翻译、或者给文档修个错字，都会让项目更好。

## 我能做什么？

### 🐛 报告问题 / 建议新功能

- **Bug**：[GitHub Issues](https://github.com/runzhliu/welink/issues/new?template=bug_report.md)
- **新功能**：[Issues](https://github.com/runzhliu/welink/issues/new?template=feature_request.md) 用 `feature` label
- **讨论 / 问题**：[Discussions](https://github.com/runzhliu/welink/discussions)
- **一键反馈（带诊断）**：应用里设置页 → 诊断 → 反馈问题，自动附带诊断报告 + 环境信息

### 📝 写文档

最低门槛的贡献方式。看到文档不准确、过时、或者想补充场景：

1. Fork → 改 `docs/*.md` → PR
2. 或者点任一文档页右上角「Edit this page」直接在 GitHub 上编辑

### 🔨 写代码

见下方「本地开发」章节。

### 🌐 翻译

目前界面和文档都是中文。想做英文版？[开个 Issue 聊聊](https://github.com/runzhliu/welink/issues/new) 我们一起规划。

### ⭐ 推广 / Star

- 觉得好用给个 Star，帮助更多人发现
- 在博客 / Twitter / V2EX 分享，欢迎 @ 我们

## 本地开发

### 环境要求

- Go 1.22+
- Node.js 18+
- 微信已解密数据（`decrypted/` 目录）或 Demo 模式

### 启动

```bash
git clone https://github.com/runzhliu/welink
cd welink

# 后端
cd backend
go run . &

# 前端
cd ../frontend
npm install
npm run dev
```

访问 http://localhost:3418 即可，前端改动热刷新。

更详细见 [开发与构建](./development)。

### Demo 模式（不需要真实数据）

```bash
cd backend
DEMO_MODE=true go run .
```

后端会自动生成阿森纳球员示例数据。

### 文档站本地预览

```bash
cd docs
npm install
npm run docs:dev
```

访问 http://localhost:5173（VitePress 默认端口）。

## PR 流程

1. Fork 仓库 → 创建 feature 分支（如 `feat/add-telegram-export`）
2. 提交改动，commit message 用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：
   - `feat: 新功能描述`
   - `fix: 修复描述`
   - `refactor: 重构描述`
   - `docs: 文档修改`
   - `chore: 杂项（依赖升级、配置等）`
3. Push 到你的 fork
4. 在 GitHub 上发起 PR 到 `dev` 分支（不是 `main`）
5. CI 会跑 build / test / typecheck，都绿了进入 review
6. 被 review 批准后合并

### Commit Message 风格

看 [既有 commit](https://github.com/runzhliu/welink/commits/dev) 找感觉。典型格式：

```
feat: 群聊 4 件套 — 群号称 / 时钟指纹 / 影响力 / AI 年报

问题：[要解决的问题]

解决方案：
- [改动 1]
- [改动 2]
- [改动 3]

影响：[性能 / 向后兼容 / UI 变化]
```

### 代码风格

- **Go**：`gofmt` + `go vet`，PR 前跑一下
- **TypeScript**：`tsc --noEmit` 必须通过
- **React**：优先函数组件 + hooks，尽量减少依赖
- **CSS**：用 Tailwind，避免写 inline style 除非必要
- **Commit**：中文 / 英文都可以，保持一致即可

### 贡献 checklist

- [ ] 代码能 build（`go build` + `npm run build`）
- [ ] 类型检查通过（`tsc --noEmit`）
- [ ] 功能手动测过（简单的 UI 截图贴到 PR 描述）
- [ ] 如果加了新 API，更新 `docs/api.md` + `backend/swagger.go`
- [ ] 如果加了新功能，在 `docs/ux.md` 或相关页面加说明
- [ ] Commit message 规范

## 代码组织速览

```
welink/
├── backend/              # Go 后端
│   ├── main.go          # 路由注册
│   ├── service/         # 业务逻辑
│   ├── pkg/db/          # SQLite / WCDB 工具
│   └── model/           # 数据模型
├── frontend/            # React 前端
│   └── src/components/
│       ├── common/      # 通用组件（Header, Toast, Section 等）
│       ├── dashboard/   # AI 首页 / 洞察 / 数据库 / 导出
│       ├── contact/     # 联系人详情
│       ├── groups/      # 群聊详情
│       └── calendar/    # 时光机
├── mcp-server/          # MCP Server（Go）
└── docs/                # VitePress 文档站
```

## 获取帮助

卡住了？

- [GitHub Discussions](https://github.com/runzhliu/welink/discussions) 提问，大家都能看到
- 或者开 Draft PR，在描述里 @ 维护者说说你遇到的问题

## 许可证

本项目基于 [AGPL-3.0](https://github.com/runzhliu/welink/blob/main/LICENSE) 开源。提交 PR 即表示同意你的贡献也以 AGPL-3.0 发布。

---

感谢每一位贡献者！在 [Contributors 列表](https://github.com/runzhliu/welink/graphs/contributors) 可以看到所有参与过的人。
