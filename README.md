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
| MiniMax | 国内版 + 国际版，支持 MiniMax-Text-01 等 |
| GLM | 智谱 AI，GLM-4 系列 |
| Grok | xAI Grok |
| Ollama | 本地部署，完全离线，数据不出本机 |
| 自定义 | 任意兼容 OpenAI 接口的模型服务 |

在设置页面填写提供商、Base URL、API Key 和模型名称即可。支持为 AI 对话和记忆提炼分别指定不同的模型。

本地 Ollama 配置参考 [ollama-setup.md](docs/ollama-setup.md)，完整 AI 功能说明见 [ai-analysis.md](docs/ai-analysis.md)。

---

## MCP — 在 Claude Code 里直接提问

WeLink 内置 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 服务器，让你在 **Claude Code（CLI）** 里用自然语言查询微信数据，无需打开浏览器。

完整配置见 [mcp-server/README.md](mcp-server/README.md)。

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

**群聊分析**
- 成员发言排行、活跃时间分布、高频词
- 人物关系力导向图：互动频率可视化，支持拖拽和悬停高亮

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
