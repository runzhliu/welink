<p align="center">
  <img src="logo.svg" width="80" height="80" alt="WeLink Logo" />
</p>

<h1 align="center">WeLink</h1>

<p align="center"><strong>AI 驱动的微信聊天数据分析平台</strong></p>

<p align="center">
  <a href="https://github.com/runzhliu/welink/actions/workflows/docker-publish.yml">
    <img src="https://github.com/runzhliu/welink/actions/workflows/docker-publish.yml/badge.svg" alt="Build" />
  </a>
  <a href="https://github.com/runzhliu/welink/pkgs/container/welink%2Fbackend">
    <img src="https://img.shields.io/badge/ghcr.io-backend-blue?logo=docker" alt="Backend Image" />
  </a>
  <a href="https://github.com/runzhliu/welink/pkgs/container/welink%2Ffrontend">
    <img src="https://img.shields.io/badge/ghcr.io-frontend-blue?logo=docker" alt="Frontend Image" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="License" />
  </a>
  <a href="https://github.com/runzhliu/welink/stargazers">
    <img src="https://img.shields.io/github/stars/runzhliu/welink?style=flat" alt="Stars" />
  </a>
  <img src="https://img.shields.io/badge/platform-macOS%2012%2B-lightgrey?logo=apple" alt="Platform macOS" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey?logo=windows" alt="Platform Windows" />
  <img src="https://img.shields.io/badge/data-local%20only-brightgreen" alt="Local Only" />
  <br/><br/>
  <a href="https://welink.click"><strong>官方文档</strong></a> &nbsp;·&nbsp;
  <a href="https://demo.welink.click"><strong>在线 Demo</strong></a>
</p>

你的微信聊天记录里，藏着你和每个人关系最真实的样子。WeLink 把这些数据交给 AI 来读——不只是统计图表，而是能让你直接提问、得到洞察：

> 「我和 XXX 的关系在哪个阶段最好？后来发生了什么？」
>
> 「这个群里真正活跃的人是谁？他们通常聊什么？」
>
> 「我今年和哪些朋友聊得越来越少了？」

所有数据留在本地，不上传任何服务器。

---

## 功能示例

> 点击可放大查看

| AI 分身 | AI 分析 |
|:---:|:---:|
| [![AI 分身](pics/1-AI分身.gif)](pics/1-AI分身.gif) | [![AI 分析](pics/2-AI分析.gif)](pics/2-AI分析.gif) |
| **AI 群聊** | **AI 首页** |
| [![AI 群聊](pics/3-AI群聊.gif)](pics/3-AI群聊.gif) | [![AI 首页](pics/4-AI首页.gif)](pics/4-AI首页.gif) |
| **快速入门引导** | **好友总览** |
| [![快速入门引导](pics/5-快速入门引导.gif)](pics/5-快速入门引导.gif) | [![好友总览](pics/6-好友总览.gif)](pics/6-好友总览.gif) |
| **好友深度画像** | **群聊画像** |
| [![好友深度画像](pics/7-好友深度画像.gif)](pics/7-好友深度画像.gif) | [![群聊画像](pics/8-群聊画像.gif)](pics/8-群聊画像.gif) |
| **全局搜索** | **时间线** |
| [![全局搜索](pics/9-全局搜索.gif)](pics/9-全局搜索.gif) | [![时间线](pics/10-时间线.gif)](pics/10-时间线.gif) |
| **时光机** | **纪念日** |
| [![时光机](pics/11-时光机.gif)](pics/11-时光机.gif) | [![纪念日](pics/12-纪念日.gif)](pics/12-纪念日.gif) |

---

## AI 分身（核心功能）

让 AI 学习任何联系人的聊天风格，**模拟和 TA 对话——像真的在和 TA 聊天一样**。

聊天记录是一个人最真实的语言印记。AI 分身从中学习 TA 的用词习惯、语气特征和表达方式，让你可以：

> 和已经**失去联系**的老友再聊一次——哪怕只是 AI 模拟的，也能找回当年的感觉
>
> 让**远在天堂的亲人**以 TA 熟悉的方式"回复"你——不是冰冷的机器，而是带着 TA 说话习惯的温暖文字
>
> 在做重要决定前，和**最信任的人的 AI 分身**聊聊——TA 会用 TA 的方式给你回应
>
> 或者纯粹好奇——**你最好的朋友**如果看到你发的这句话，会怎么回？

> [!NOTE]
> AI 分身旨在帮助用户回忆珍贵的人际关系。模拟结果由 AI 生成，不代表真人的真实想法。请善意使用，不要用于冒充他人身份或误导第三方。使用本功能即表示用户同意自行承担使用后果，项目作者不对因使用 AI 分身产生的任何直接或间接影响负责。

### 功能特点

- **风格学习**：从私聊记录 + 共同群聊中提取 TA 的文本消息（可选 100 / 300 / 1000 / 2000 / 全部条），AI 学习 TA 的用词、语气、断句、emoji 习惯
- **背景补充**：可填写 TA 的籍贯、职业、与你的关系等背景信息，让 AI 更准确地还原 TA 的人物特征
- **群聊联动**：自动列出与该联系人的共同群聊，可勾选要包含的群聊，只提取 TA 在群里的发言（按 sender_id 精确过滤），不会混入其他人的消息
- **Session 机制**：学习一次即缓存，后续多轮对话不再重复加载数据库，响应速度快
- **流式对话**：仿微信气泡界面，AI 回复逐字显示
- **对话续写**：AI 同时模拟你和 TA 继续聊天，像看一部关于你们的迷你剧

详细实现见 [ai-clone.md](docs/ai-clone.md)。

### AI 群聊模拟

让 AI 模拟群友继续聊天——按每个成员的**发言比例**和**说话风格**生成对话，你也可以随时加入。

- **风格画像**：自动分析每个成员的用词习惯、消息长度、表情使用、提问频率等特征
- **自定义配置**：可选参与成员、设定话题场景、调节聊天氛围（日常/激烈/深夜/搞笑/严肃）
- **多轮记忆**：模拟对话使用多轮对话机制，群友会回应你说的话，不会重复

详细说明见 [ai-group-sim.md](docs/ai-group-sim.md)。

### 跨联系人 AI 问答

不再局限于单个联系人——直接问关于**所有聊天记录**的问题，AI 自动搜索并汇总回答。

> 「谁跟我聊过旅行？」→ AI 搜索全部联系人，找到 3 人提到过旅行，汇总每人聊了什么
>
> 「去年国庆我都跟谁聊天了？」→ AI 查询 10/1-10/7 的日历数据，列出每天的聊天对象
>
> 「哪些朋友经常提到加班？」→ AI 搜索关键词，按匹配频次排列

技术原理：LLM Agent 模式——第一步 LLM 解析问题意图（提取关键词/时间范围），第二步自动调用搜索/日历 API 收集数据，第三步 LLM 基于真实数据生成回答。每次提问仅消耗 ~4000 token。

### AI 洞察

对任意联系人生成三种深度分析（基于统计摘要 + 采样消息，低 token 消耗）：

- **关系报告**：关系发展阶段、沟通特点、关键数字、AI 感言
- **风格画像卡**：性格标签、口头禅、聊天习惯、趣味类比
- **AI 日记**：选择任意一天，AI 以第一人称写日记

### 自定义 Prompt 模板

所有 AI 功能的系统提示词（System Prompt）**完全透明、可自定义**：

- 每个 AI 功能旁边都有「查看 Prompt」按钮，可以看到当前使用的完整提示词
- 在设置页的「Prompt 模板」区块，可以编辑任意功能的 Prompt
- 支持变量：`{{name}}`（联系人名）、`{{today}}`（日期）、`{{rounds}}`（轮数）等
- 留空即恢复默认值，修改即时生效

---

## AI 分析

WeLink 内置完整的 AI 分析引擎，可对任意联系人、群聊或某一天的聊天记录发起对话式分析。

### 三种检索模式

| 模式 | 工作方式 | 适合场景 |
|------|---------|---------|
| **全量分析** | 将选定时间范围内的全部消息送入 LLM 上下文 | 深度关系分析、长期趋势总结 |
| **混合检索（RAG）** | FTS5 全文检索 + 语义向量检索，精准召回相关片段 | 查找特定事件、关键词检索 |
| **时光机 AI** | 跨所有对话的单日聚合分析 | 「某天发生了什么」式的日记回顾 |

### 记忆提炼

LLM 批量阅读聊天记录，自动提炼关键事实（人名、事件、情感节点）并持久化存储。后续对话中，AI 可以调用这些「长期记忆」，而不依赖每次重新加载全量消息。

### 支持的 LLM 提供商

| 提供商 | 说明 |
|--------|------|
| DeepSeek | DeepSeek-Chat，国产高性价比 |
| Kimi | Moonshot（月之暗面），支持超长上下文 |
| OpenAI | GPT-4o 等，标准 API |
| Claude | Anthropic Claude，通过原生 API 接入 |
| Gemini | Google Gemini，支持 OAuth 2.0 认证 |
| **Vertex AI** | **Google Cloud Vertex AI，原生支持**。认证方式：Service Account JSON → JWT → OAuth2 token（自动缓存刷新）。走 Vertex AI 的 OpenAI 兼容端点，支持所有 Gemini 模型 |
| **AWS Bedrock** | **原生支持**。认证方式：AWS SigV4 签名（手写实现，无 AWS SDK 依赖）。使用 Converse API（跨模型家族统一 API），支持 Claude / Llama / Mistral / Titan / Cohere 等所有 Bedrock 模型 |
| MiniMax | 国内版 + 国际版，支持 MiniMax-Text-01 等 |
| GLM | 智谱 AI，GLM-4 系列 |
| Grok | xAI Grok |
| Ollama | 本地部署，完全离线，数据不出本机 |
| 自定义 | 任意兼容 OpenAI 接口的模型服务 |

在设置页面填写提供商、Base URL、API Key 和模型名称即可。支持为 AI 对话和记忆提炼分别指定不同的模型。

> **Vertex AI 配置**：选择 `Google Vertex AI` provider → 粘贴完整的 Service Account JSON → 填写 GCP Project ID 和 Region → 选择模型（默认 `google/gemini-2.0-flash-001`）
>
> **Bedrock 配置**：选择 `AWS Bedrock` provider → 填写 AWS Access Key ID 和 Secret Access Key → 填写 Region → 填写 Model ID（如 `anthropic.claude-3-5-sonnet-20241022-v2:0`）

本地 Ollama 配置参考 [ollama-setup.md](docs/ollama-setup.md)，完整 AI 功能说明见 [ai-analysis.md](docs/ai-analysis.md)。

---

## MCP — 在 Claude Code 里直接提问

WeLink 内置 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 服务器，让你在 **Claude Code（CLI）** 里用自然语言查询微信数据，无需打开浏览器。

完整配置见 [mcp-server/README.md](mcp-server/README.md)。

---

## 🔮 Skill 炼化 — 把聊天记录变成 AI 工具的能力包

**把聊天记录里的人际关系，直接炼化成 Claude Code / Codex / Cursor 等 AI 编程工具的 Skill 文件包。** 一次炼化，多处使用。

### 三种 Skill 类型

| 类型 | 输入 | 用途 |
|------|------|------|
| **contact** 联系人分身 | 和某联系人的全部聊天 | 让 AI 用 TA 的语气帮你写邮件、起草回复、预演对话 |
| **self** 我的写作风格 | 我发出去的所有消息 | 让 AI 用你自己的口吻写公众号、朋友圈、邮件，避免 AI 腔 |
| **group** 群聊智囊 | 某个群的集体聊天 | 回答「这个群会怎么说」，把群的集体知识/术语/氛围封装起来 |

### 六种输出格式（一键切换）

| 格式 | 目标工具 | 产物路径 |
|------|---------|---------|
| **claude-skill** | Claude Code Skills（目录式） | `~/.claude/skills/<name>/SKILL.md` + 附件 |
| **claude-agent** | Claude Code Subagent（单文件） | `~/.claude/agents/<name>.md`（带 frontmatter） |
| **codex** | OpenAI Codex CLI | 项目根 `AGENTS.md` |
| **opencode** | OpenCode Agent | `.opencode/agent/<name>.md` |
| **cursor** | Cursor Rules | `.cursor/rules/<name>.mdc`（支持 glob） |
| **generic** | 通用 Markdown | 工具无关，可粘贴到任何 AI 对话 |

### 炼化的内容
- **性格特征**：LLM 从真实对话里抽取的人物画像
- **说话风格**：句长、语气、用词偏好、标点习惯、emoji 使用
- **高频词与口头禅**：独特词汇和常用短语
- **常聊话题**：兴趣领域和专业方向
- **关系背景**：你和 TA 的关系推断（仅 contact 类型）
- **代表性原话**：5-8 条最能体现风格的消息片段（自动脱敏）
- **使用注意事项**：什么场景适合用、什么场景不适合

### 使用入口
- 联系人深度画像头部 → 紫色 Sparkles 图标按钮
- 群聊画像头部 → 紫色 Sparkles 图标按钮
- 洞察页「个人自画像」卡 → 「炼化我的 Skill」按钮

### Skills 管理

侧边栏新增「Skills」页面，集中管理所有已炼化的 Skill 包：

- **持久化存储**：每次炼化自动写入本地数据库（`ai_analysis.db` 的 `skills` 表），文件保存到 `~/.welink/skills/<id>/<filename>.zip`
- **后台异步执行**：炼化任务在 goroutine 中运行，**关闭弹窗、刷新页面都不会中断**
- **状态实时追踪**：等待中 / 炼化中 / 成功 / 失败（含错误原因），页面每 2s 自动刷新
- **搜索 + 筛选**：按目标名/文件名/模型名搜索，按类型（联系人/自画像/群聊/群成员）和状态筛选
- **表头排序**：按目标、类型、格式、炼化时间升降序排列
- **重新下载**：已成功的任务随时可以重新下载 zip 文件，不需要重新炼化
- **Mac App 路径显示**：炼化成功后显示保存到 `~/Downloads/` 的完整路径，可一键复制

### 隐私保护
- 炼化前手机号、邮箱、身份证号自动脱敏
- 整个过程只调用一次 LLM（约 5-15k token）
- 产物是本地 zip 文件，由你决定是否分享

---

## 数据分析功能

**好友分析**
- 消息总量排行、关系热度变化（历史峰值 vs. 近一个月）
- 聊天趋势折线图、24 小时活跃分布、聊天日历热力图
- 词云分析、情感趋势曲线（按月，可切换仅对方/双方）
- 撤回次数、红包次数、主动发起对话比例等社交特征
- 共同群聊数

**时光机**
- 以 3 个月为单位的可滑动日历热力图，覆盖全部历史
- 点击任意日期查看当天私聊 + 群聊记录，或直接发起 AI 分析

**群聊分析 + 小团体检测 + 对比**
- 成员发言排行、活跃时间分布、高频词
- 人物关系力导向图：互动频率可视化，支持拖拽和悬停高亮
- **小团体检测**：Label Propagation 社区检测算法自动识别群内小圈子，按社区着色节点
- **潜水成员检测**：基于 chatroom_member 表补全零发言成员，一眼找到群里从不说话的人
- **群聊搜索**：支持按发言人筛选，结果可导出 TXT/CSV
- **群聊活跃度对比**：同时选中多个群对比消息量、成员数、日均消息、人均消息

**回复节奏分析（联系人深度画像）**
- 双向对比我 / 对方的回复速度（中位数、均值、秒回次数、慢回次数）
- 按 24 小时分时段的平均回复速度柱状图
- 消息间隔分布直方图：10秒 / 1分钟 / 10分钟 / 1小时 / 6小时 / 1天
- 聊天密度曲线：按月统计消息间隔均值，自动判断升温 / 降温 / 平稳趋势

**谁最像谁 — 联系人相似度分析**
- 基于消息类型分布、平均消息长度、表情偏好、互动方式等 18 维特征向量
- 余弦相似度算法计算所有联系人间的聊天风格相似度
- 展示共同高频词，发现说话最像的两个人

**红包 / 转账全局总览**
- 全局 KPI：红包总数、转账总数、我发出、我收到
- 月度收发趋势柱状图
- 联系人红包转账排行，细分四个方向（发红包 / 收红包 / 发转账 / 收转账）

**个人自画像**
- 汇总所有「我」方向的消息数据
- 发出消息总数、平均字数、最活跃时段、联系过的人数
- 最爱发消息的星期、最常联系的人
- 24 小时个人发送分布

**每日社交广度**
- 每天联系了多少个不同的人（不是消息数）
- 年度曲线 + 日均 / 最广日统计，看到"社牛日"和"闭关日"

**共同社交圈**
- 选择两个联系人，基于共同所在群聊推测他们的共同朋友圈
- 列出共同群聊（小群优先）和推测的共同好友
- 标记每个共同好友出现的群数，多群共现 = 关系更紧密

**链接收藏夹**
- 自动扫描所有聊天中发过 / 收过的链接，按域名聚合
- 支持搜索、按域名筛选、导出 CSV
- 当作"个人书签库" — 那些在微信里分享过的好文章再也不会丢

**消息撤回排行**
- 基于已有的撤回数据做"谁最爱撤回消息"排行 + 撤回率

**词云交互**
- 悬浮显示词频 tooltip，点击固定详情卡（次数、排名、相对频率条）

**全局统计**
- 关系热度分布五档：活跃 / 温热 / 渐冷 / 沉寂 / 零消息
- 月度趋势、深夜聊天排行榜

**纪念日**
- 自动检测生日（扫描"生日快乐"等关键词，按年份去重）
- 友谊里程碑提醒（认识 100/365/1000/... 天）
- 支持自定义纪念日（标题、日期、是否每年重复）

**其他**
- 跨联系人全局关键词搜索（热门推荐 + 搜索历史）
- 认识时间线（垂直河流式，按年月展开，支持播放回忆动画）
- 联系人对比（勾选 2-6 人，雷达图 + 柱状图 + 数据明细）
- 社交体检报告（健康指数 + 洞察，支持分享为图片）
- 时间范围筛选（预设 + 自定义）
- 隐私屏蔽（联系人 / 群聊，仅本地生效）

---

## 快速开始

### 第一步：解密微信数据库

把手机聊天记录同步到电脑后（微信 → 设置 → 通用 → 聊天记录迁移），使用 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 解密：

```bash
git clone https://github.com/ylytdeng/wechat-decrypt
cd wechat-decrypt
sudo python3 main.py   # 选择 decrypt 模式
```

解密后生成 `decrypted/` 目录（含 `contact/contact.db` 和 `message/message_N.db`）。

### 第二步：启动 WeLink

**Docker 模式**（将 `decrypted/` 放在仓库根目录内）：

```bash
cd welink
docker compose up
```

访问 [localhost:3000](http://localhost:3000) 开始使用。

**macOS / Windows App**（无需 Docker）：前往 [GitHub Releases](https://github.com/runzhliu/welink/releases) 下载，启动后在设置页选择 `decrypted/` 目录即可。

### 没有数据？先试试 Demo

```bash
docker compose -f docker-compose.demo.yml up
```

或直接访问 **[https://demo.welink.click](https://demo.welink.click)**。

> Demo 数据以**阿森纳 2025/26 赛季一线队球员与教练组**为联系人，消息内容充满更衣室气息。**COYG！** 🔴⚪

---

## macOS App 安装说明

> **系统要求：macOS 12（Monterey）及以上**

1. 前往 [GitHub Releases](https://github.com/runzhliu/welink/releases) 下载最新 `WeLink.dmg`
2. 拖入 `/Applications`，双击运行

> **提示「无法打开」？** 右键 → 「打开」→ 再次点击「打开」。若仍无效：`xattr -cr /Applications/WeLink.app`

从源码构建：`make dmg`（需 Go 1.22+ 和 Node.js 18+）

## Windows App 安装说明

> **系统要求：Windows 10 1903 及以上**

1. 下载 `WeLink-windows-amd64.zip`，解压后双击 `WeLink.exe`
2. 如提示缺少 WebView2，从 [Microsoft 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 安装 Evergreen Bootstrapper

从源码构建：`make exe`

---

## 推荐运行配置

| 数据规模 | 消息量 | 推荐内存 | 首次索引时间 |
|----------|--------|----------|-------------|
| 轻量     | < 50 万条  | 2 GB | < 30 秒 |
| 中等     | 50–200 万条 | 4 GB | 1–3 分钟 |
| 重度     | 200 万条以上 | 8 GB+ | 3–10 分钟 |

首次使用建议先选「近 6 个月」体验，确认无误后再切换到「全部数据」。

---

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

API 文档：启动后访问 [localhost:3000/swagger/](http://localhost:3000/swagger/)。更多技术细节见 [docs/](docs/README.md)。

---

## 数据安全

所有数据仅在本地处理，不会上传至任何服务器。请仅分析自己的聊天记录。

## 感谢

本项目依赖 [ylytdeng/wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 实现微信数据库解密。微信数据库使用 SQLCipher 加密，该项目从进程内存中提取密钥，是 WeLink 的基础。

## 开源协议

本项目采用 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 协议。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=runzhliu/welink&type=Date)](https://star-history.com/#runzhliu/welink&Date)
