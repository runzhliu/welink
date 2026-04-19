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
2. 提交改动，**每个 commit 都用 `git commit -s`**（DCO 要求，见下方）
3. commit message 用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：
   - `feat: 新功能描述`
   - `fix: 修复描述`
   - `refactor: 重构描述`
   - `docs: 文档修改`
   - `chore: 杂项（依赖升级、配置等）`
4. Push 到你的 fork
5. 在 GitHub 上发起 PR 到 `dev` 分支（不是 `main`）
6. CI 会跑 build / test / typecheck / DCO check / PR 标题格式校验，都绿了进入 review
7. 被 review 批准后合并

### Signed-off-by (DCO)

WeLink 用 **DCO**（Developer Certificate of Origin）而不是 CLA。**每个 commit 都要加 `Signed-off-by:` 行**，声明"我有权把这段代码以本项目的许可证发布"。

规则很简单，git 有内置支持：

```bash
git commit -s -m "feat: 新功能"
# 或修改现有 commit：
git commit --amend --signoff
# 或 rebase 整个分支：
git rebase --signoff main
```

`-s` 会自动把下面这行附到 commit message 末尾：

```
Signed-off-by: Your Name <your.email@example.com>
```

这个名字 / 邮箱来自你本地 git 配置：

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

::: tip DCO 全文
DCO 原文 ~10 行，中文摘译：你声明这段贡献是你自己写的（或你有权贡献上游代码），并同意按本项目 AGPL-3.0 许可证发布。
全文见 https://developercertificate.org/
:::

PR 提交后 CI 会自动检查每个 commit 的 `Signed-off-by`。漏了就按提示 `git rebase --signoff` 补签再 push。

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
