# 更新日志

主要变更和新功能按版本列出，技术细节见 [GitHub Releases](https://github.com/runzhliu/welink/releases)。

::: tip 提示
只有 feat / fix / refactor 等关键提交在此记录，格式化 / docs / chore 等改动请见 git log。
:::

## 📦 v0.1.2+（未发布 · dev 分支累积 40+ 提交）

### ✨ 新增主力功能

- **关系动态预测** — 4 档趋势（升温/稳定/降温/濒危）+ 建议主动联系 Top 5 卡片
  - 主动占比趋势信号（揭示"到底谁在疏远谁"）
  - 响应时延信号（"TA 回复从 10 分钟变成 8 小时"）
  - 连续冷却 N 周徽章
  - 每周变化摘要横幅
  - 不再推荐此人（含设置页管理）
  - 折线点击看 12 月大图 modal
  - AI 开场白草稿（一键生成 4 条不同调性破冰）
- **群聊 4 件套** — 群号称卡 / 时钟指纹（7×24 热图）/ 群影响力指数 / AI 群年报
- **群内「我的 CP」** — 基于引用消息的双向互动 Top 3
- **导出中心** — 年度回顾 / 对话归档 / AI 历史 / 记忆图谱 × 8 种目标
  - Markdown / Notion / 飞书
  - WebDAV / S3 / Dropbox / Google Drive / OneDrive（含 OAuth 回调）
- **数据库 4 件套** — SQL 模板 / 结果画图 / 磁盘饼图 / 历史收藏
- **自然语言查数据** — 中文问 AI 自动写 SQL 并执行（支持跨库联系人查询）
- **首页「今天的纪念日」banner** — 认识 N 周年 / 检测生日 / 里程碑 / 自定义 4 类聚合
- **群聊回放播放器** — 6 档倍速按真实时间间隔回放
- **MCP 工具扩展** — 新增 `get_relationship_forecast`，共 19 个工具
- **显示"我"的真实头像** — 自动推断 self wxid，所有「我」的消息显示真头像

### 🎨 界面优化

- **洞察页**：21 张卡片统一 react-grid-layout 拖拽 + 视图预设（完整/仅核心/精简/仅趣味/自定义）+ 分组折叠 + 批量组开关
- **群画像**：4 长 section 可折叠（高频词 / 消息类型 / 时间分布 / 日历）
- **导出中心**：改为 3 步向导式单列流程
- **AI 首页**：聚合提醒/纪念日/摘要为右侧 tab 面板；快捷提问可收起
- **设置页**：左栏 sticky 导航 + 活跃项高亮（大屏）+ 横向快速跳转（小屏）
- **数据库页**：视图预设（完整 / 自然语言 / SQL 模式 / 浏览表）
- **群聊列表**：加我的参与度 / 近期活跃 / 趋势四维
- **官网**：全套微动画（滚动淡入 / Hero 光晕 / 卡片交互 / 跑马灯 / 吉祥物）

### 🤝 社区治理

- **Issue / PR 模板**：结构化 bug 报告 + feature 请求表单，PR checklist；引导新手提前看 FAQ / 走 Discussions
- **CODEOWNERS**：自动按目录请 reviewer
- **行为准则 + 安全策略**：`CODE_OF_CONDUCT.md`（Contributor Covenant 2.1）+ `SECURITY.md`（私密漏洞披露流程）
- **FUNDING.yml**：仓库右侧 Sponsor 按钮
- **DCO check**：PR 要求每个 commit `Signed-off-by`，避免未来许可证纠纷。`git commit -s` 即可
- **Conventional Commits 校验**：PR 标题必须 `feat:` / `fix:` 等标准前缀
- **自动 PR label**：按改动文件自动打 `area:backend` / `area:frontend` / `area:export` / `area:forecast` 等；附带 size 标签（xs/s/m/l/xl）
- **First-interaction welcome bot**：第一次提 issue/PR 的贡献者自动收到欢迎 + 指引
- **Stale bot**：45+14 天无响应 issue / 30+14 天无响应 PR 自动 close

### 🔧 基础设施

- CI 防御：lockfile registry 白名单检查
- Bundle code-splitting：charts / markdown / qrcode 等按需加载
- Preferences schema 版本化（为破坏性升级预留迁移出口）
- LLM 用量统计
- 自动检查新版本

### 🔒 安全加固

- **界面 PIN 锁屏**：设置 → 锁屏 PIN 启 4-32 位 PIN（bcrypt 哈希存 preferences.json），支持 `⌘L` 快捷键 / 闲置 30min/1h/2h 自动锁 / App 启动即锁三种触发。全屏毛玻璃遮罩 + PIN 输入框。属"视觉锁"不是数据加密，防的是路过偷看
- **默认仅监听 `127.0.0.1`**：后端端口不再默认暴露到局域网，避免同网络用户触达 `/api/export/*` 等敏感端点。开放到 LAN 需显式设 `WELINK_LISTEN_LAN=1`（Docker 镜像默认带，由 compose 端口映射限制宿主侧暴露）
- **Google Drive / OneDrive OAuth 加 state 防 CSRF**：授权 URL 带 crypto/rand 32 字节 state（TTL 30 min，一次性消费），回调前先校验。修复了攻击者诱导受害者浏览器访问 `/api/export/oauth/*/callback?code=...` 即可把攻击者 refresh token 写入受害者 preferences 的漏洞
- **OAuth 回调 base URL 不再信任 `X-Forwarded-*` 请求头**：改为从 `WELINK_PUBLIC_URL` 环境变量读取（否则回退到 `http://127.0.0.1:<PORT>`）。反代部署 OAuth 授权**需显式配置该变量**
- 界面崩溃自救（ErrorBoundary）

## v0.1.2 · 2025-12

- AI 分析 Session 机制
- Skills 管理页面（持久化、状态追踪、搜索筛选、重下载）
- 记忆提炼后台异步任务
- Windows App 原生支持

## v0.1.1 · 2025-11

- 洞察页重设计（react-grid-layout + 经典视图切换）
- Spotify Wrapped 风格年度回顾
- 跨联系人 AI 问答（Agent 模式）

## v0.1.0 · 2025-10

- AI 分身核心功能
- AI 群聊模拟
- Skill 炼化 3 类型 × 6 格式
- MCP Server

## v0.0.9 及更早

- 混合检索 RAG（FTS5 + 向量）
- 回复节奏分析
- 情感趋势分析
- 词云 + 高频词
- 纪念日自动检测
- 红包转账全局总览
- 每日社交广度
- 共同社交圈
- 深夜守护统计

---

## 反馈 / 贡献

- 找到 bug 或想要的新功能：[GitHub Issues](https://github.com/runzhliu/welink/issues)
- 参与讨论：[GitHub Discussions](https://github.com/runzhliu/welink/discussions)
- 查看完整提交历史：`git log --oneline` 或 [GitHub commits](https://github.com/runzhliu/welink/commits/main)
