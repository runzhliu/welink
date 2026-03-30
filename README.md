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

[![产品演示视频](https://i0.hdslb.com/bfs/archive/259575508ba3554df77a49136e8ade74948dbdb1.jpg)](https://www.bilibili.com/video/BV1zCXDB6EiN/)

你的微信聊天记录里，藏着你和每个人关系最真实的样子。WeLink 把这些数据交给 AI 来读——不只是统计图表，而是能让你直接提问、得到洞察：

> 「我和 XXX 的关系在哪个阶段最好？后来发生了什么？」
>
> 「这个群里真正活跃的人是谁？他们通常聊什么？」
>
> 「我今年和哪些朋友聊得越来越少了？」

所有数据留在本地，不上传任何服务器。

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
| OpenAI | GPT-4o 等，标准 API |
| Ollama | 本地部署，完全离线，数据不出本机 |
| Gemini | Google Gemini，支持 OAuth 2.0 认证 |
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

**全局统计**
- 关系热度分布五档：活跃 / 温热 / 渐冷 / 沉寂 / 零消息
- 月度趋势、深夜聊天排行榜

**其他**
- 跨联系人全局关键词搜索
- 认识时间线（按第一条消息时间排列）
- 时间范围筛选（预设 + 自定义）
- 隐私屏蔽（联系人 / 群聊，仅本地生效）

---

## 功能截图

### 快速入门引导

首次使用向导，一步步完成数据库解密、目录配置与分析时间范围选择。

![快速入门引导](pics/1.png)

### 好友总览 Dashboard

总好友数、总消息量、活跃好友、零消息好友一览，关系热度分布（活跃 / 温热 / 冷淡），月度趋势柱状图与 24 小时活跃曲线。

![好友总览](pics/2.png)

### 联系人排行榜

按消息总数排序，支持搜索与分页，活跃状态标签快速识别关系冷热，共同群聊数一列呈现与每位联系人的群圈交集。

![联系人排行榜](pics/3.png)

### 联系人深度画像

点击任意联系人进入详情面板：收发消息各自占比、深夜消息统计、主动发起对话率、红包次数、24 小时 & 每周活跃分布，以及可点击的聊天日历——点击任意一天即可查看当天完整对话记录。

![联系人深度画像](pics/4.png)

### 情感分析

基于关键词逐条打分，按月聚合，呈现长达数年的情感趋势折线图，直观反映积极 / 消极 / 中性消息的历史变化。

![情感分析](pics/5.png)

### 群聊画像

群聊列表按消息数排序，显示起始与最近活跃时间，点击群聊查看成员发言排行、词云、活跃日历，同样支持点击日历查看当天群聊记录。

![群聊画像](pics/6.png)

### 隐私屏蔽

侧边栏「屏蔽」页面集中管理屏蔽名单，支持按微信ID、昵称或备注名屏蔽联系人，按群名或群ID屏蔽群聊。也可在联系人或群聊详情弹窗右上角点击眼睛图标快速屏蔽。

![隐私屏蔽](pics/7.png)

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
