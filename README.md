<p align="center">
  <img src="logo.svg" width="80" height="80" alt="WeLink Logo" />
</p>

<h1 align="center">WeLink — 微信聊天数据分析平台</h1>

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
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey?logo=apple" alt="Platform" />
  <img src="https://img.shields.io/badge/data-local%20only-brightgreen" alt="Local Only" />
</p>

<https://github.com/user-attachments/assets/6964e121-c2a0-4595-8cb5-2f65dfa49420>

微信聊天记录里隐藏着你和每个人关系的完整轨迹：

- 第一条消息是哪天发的
- 哪段时期聊得最密集
- 凌晨还在聊天的都是什么人
- 最常说的词是什么
- ...

这些数据一直都在，只是没有一个地方能让你好好看清楚，而 **WeLink** 就是为这件事而做的。

## 功能

**好友分析**
- 消息总量排行，一眼看出谁是你真正常联系的人
- 第一条消息时间，回顾一段关系的起点
- 24 小时活跃分布，发现你们的聊天习惯
- 聊天日历热力图，哪段时间最密集一目了然
- 词云分析，看看你们之间出现最多的词是什么
- 深夜消息统计、红包次数、发起对话比例等社交特征
- 共同群聊数：联系人列表直接显示与该联系人的共同群聊数量，详情页可查看完整群聊列表并跳转

**群聊分析**
- 群内发言排行
- 群活跃时间分布
- 群内高频词

**全局统计**
- 总消息量、活跃好友数、零互动好友数
- 月度消息趋势
- 消息类型分布（文字 / 图片 / 语音 / 视频 / 表情）
- 深夜聊天排行榜

**时间范围筛选**
- 支持选择近 1 个月 / 3 个月 / 6 个月 / 1 年 / 全部数据进行分析
- 支持自定义任意起止日期，精确分析某段时期的聊天数据

**隐私屏蔽**
- 侧边栏「屏蔽」页面，可按微信ID、昵称或备注名屏蔽指定联系人和群聊
- 被屏蔽的对象从好友列表、群聊列表中完全隐藏，数据仍保留在数据库中
- 屏蔽规则存储在浏览器本地（localStorage），不上传、不修改后端数据

## 🤖 MCP — 用自然语言查询你的微信数据

WeLink 内置了一个 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 服务器，让你在 **Claude Code（CLI）** 里直接用中文提问来分析微信数据——无需打开浏览器，无需手动查找。

**几个例子：**

> 「我今年和哪个朋友聊得最多？」
>
> 「帮我分析一下我和 XXX 的关系深度，我们经常聊什么话题？」
>
> 「我哪个群最活跃？群里谁发言最多？」
>
> 「我凌晨还在聊天的都是什么人？」

AI 会自动调用 WeLink 后端，把分析结果直接呈现在对话里。

完整配置说明（注册 MCP Server + Skills 配置）见 [mcp-server/README.md](mcp-server/README.md)。


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

侧边栏「屏蔽」页面集中管理屏蔽名单，支持按微信ID、昵称或备注名屏蔽联系人，按群名或群ID屏蔽群聊。也可在联系人或群聊详情弹窗右上角点击眼睛图标快速屏蔽。被屏蔽对象的显示名会自动解析展示，仅在找不到匹配时才回退显示原始ID。

![隐私屏蔽](pics/7.png)

## 推荐运行配置

WeLink 在本地跑 Docker Compose，资源消耗取决于聊天数据量。以下是建议：

| 数据规模 | 消息量 | 推荐内存 | 首次索引时间 |
|----------|--------|----------|-------------|
| 轻量     | < 50 万条  | 2 GB | < 30 秒 |
| 中等     | 50–200 万条 | 4 GB | 1–3 分钟 |
| 重度     | 200 万条以上 | 8 GB+ | 3–10 分钟 |

- **CPU**：双核即可，多核对并发群聊分析有提升
- **磁盘**：`decrypted/` 目录本身通常在 1–5 GB，建议预留 10 GB 空余
- **时间范围**：首次使用建议先选「近 6 个月」体验，确认无误后再切换到「全部数据」

如果首次索引时间过长，可在欢迎页选择「自定义范围」缩短分析区间，或减少消息数据库文件数量。

## 快速体验（Demo 模式）

没有微信数据库？可以用内置的示例数据快速预览页面效果：

```bash
cd welink
docker compose -f docker-compose.demo.yml up
```

访问 [localhost:3000](http://localhost:3000) 即可看到预置了 12 个好友、3 个群聊和数千条模拟消息的完整界面。

> Demo 模式下后端会在容器内自动生成仿真数据库，无需挂载任何本地目录。所有数据均为随机生成，不涉及真实聊天记录。


## 使用前提

目前仅支持 **macOS**，Windows / Linux 支持敬请期待。

**第一步：把手机聊天记录同步到电脑（推荐）**

手机微信 → 「我」→「设置」→「通用」→「聊天记录迁移与备份」→「迁移到电脑」，这样能获得最完整的历史数据。

**第二步：解密数据库**

确保 Mac 上的微信处于运行状态，然后使用 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 提取并解密数据库：

```bash
git clone https://github.com/ylytdeng/wechat-decrypt
cd wechat-decrypt
sudo python3 main.py
# 选择 decrypt 模式
```

解密完成后会生成 `decrypted/` 目录，将其中内容放到以下结构：

```
decrypted/
├── contact/
│   └── contact.db
└── message/
    ├── message_0.db
    ├── message_1.db
    └── ...
```

**第三步：放置解密后的数据库**

将上一步生成的 `decrypted/` 目录放在与 `welink/` 仓库**同级**的位置，目录结构如下：

```
~/（或任意父目录）
├── welink/            ← 本仓库
│   ├── backend/
│   ├── frontend/
│   ├── docker-compose.yml
│   └── ...
└── decrypted/         ← 解密后的数据，放在这里
    ├── contact/
    │   └── contact.db
    └── message/
        ├── message_0.db
        ├── message_1.db
        └── ...
```

> wechat-decrypt 生成的 `decrypted/` 目录内部已是上述结构，直接移动过来即可，无需手动调整。

**第四步：启动 WeLink**

确认 `decrypted/` 与 `welink/` 同级后，执行：

```bash
cd welink
docker compose up
```

首次启动会自动拉取 GitHub CI 构建好的镜像，无需本地编译。如需强制本地构建，加上 `--build` 参数。

访问 [localhost:3000](http://localhost:3000) 开始分析。

## 配置

WeLink 支持通过 `config.yaml` 进行自定义配置。**对于大多数用户，无需任何配置，直接 `docker compose up` 即可运行。**

如需自定义，在项目根目录编辑 `config.yaml`（Docker Compose 会自动挂载）：

```yaml
server:
  port: "8080"          # HTTP 监听端口

data:
  dir: "/app/data"      # 微信数据目录（Docker 内路径，通常不需要修改）

analysis:
  timezone: "Asia/Shanghai"   # 统计时区（IANA 时区名）
  late_night_start_hour: 0    # 深夜区间开始（含），默认 0 点
  late_night_end_hour: 5      # 深夜区间结束（不含），默认 5 点
  session_gap_seconds: 21600  # 新对话段判定间隔，默认 6 小时
  worker_count: 4             # 并发分析 goroutine 数，建议不超过 CPU 核心数
  late_night_min_messages: 100  # 进入深夜排行所需最少消息数
  late_night_top_n: 20          # 深夜排行保留前 N 名

  # 启动后自动开始索引的时间范围（Unix 秒，0 表示不限）
  # 设置后无需前端手动点击「开始分析」
  # 示例（只分析 2023 年）：
  #   default_init_from: 1672531200
  #   default_init_to:   1704067199
  default_init_from: 0
  default_init_to: 0
```

配置优先级：`config.yaml` > 环境变量（`DATA_DIR` / `PORT`）> 默认值。

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Go + Gin |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 数据库 | SQLite（modernc，纯 Go，无 CGO） |
| 中文分词 | go-ego/gse |
| 部署 | Docker Compose |

## API 文档

启动后访问 [localhost:3000/swagger/](http://localhost:3000/swagger/) 查看完整接口文档。

更多技术细节（数据库结构、索引流程、情感分析算法等）见 [docs/](docs/README.md)。

## 数据安全

所有数据仅在本地处理，不会上传至任何服务器。请仅分析自己的聊天记录。

## 感谢

这个项目能够实现，首先要感谢 [ylytdeng/wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 项目。

微信数据库使用 SQLCipher 加密，密钥存在运行中的微信进程内存里。wechat-decrypt 实现了从进程内存中扫描并提取密钥的完整方案，支持 macOS / Windows / Linux，让我们第一次真正触碰到了属于自己的聊天记录。没有这个项目，WeLink 无从谈起。

## 开源协议

本项目采用 [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE) 协议。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=runzhliu/welink&type=Date)](https://star-history.com/#runzhliu/welink&Date)
