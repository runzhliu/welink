---
layout: home

hero:
  name: WeLink
  text: 微信聊天数据分析平台
  tagline: 你的每一段关系都有迹可循
  image:
    src: /logo.svg
    alt: WeLink
  actions:
    - theme: brand
      text: 下载安装
      link: /install
    - theme: brand
      text: 在线 Demo
      link: https://demo.welink.click

features:
  - icon: 👥
    title: 好友深度分析
    details: 消息排行、峰值月份、聊天趋势折线图、24 小时活跃分布、聊天日历热力图，一屏读懂一段关系。
  - icon: 🕐
    title: 认识时间线
    details: 所有联系人按第一条消息排成时间轴，按年份分组，一眼看出每年认识了哪些人。
  - icon: 🔍
    title: 全局搜索
    details: 跨所有联系人与群聊搜索聊天记录，关键词高亮，点击任意消息可弹出当天完整对话并自动定位。
  - icon: 👥
    title: 群聊画像
    details: 群内发言排行（Top 500）、活跃时间分布、高频词云，支持查看任意一天的完整群聊记录。
  - icon: 🗄️
    title: SQL 编辑器
    details: 数据库页内置 SQL 编辑器，可直接对底层 SQLite 执行 SELECT 查询，⌘+Enter 执行，结果一键复制。
  - icon: 😊
    title: 情感分析
    details: 基于关键词逐条打分，按月聚合，呈现数年情感趋势折线图。
  - icon: 🔒
    title: 完全本地
    details: 所有数据仅在本机处理，不上传任何服务器。隐私屏蔽功能可从列表中完全隐藏指定联系人。
  - icon: 🤖
    title: MCP Server
    details: 内置 MCP Server，让 Claude Code 用自然语言直接查询你的微信聊天数据——无需打开界面，直接在终端提问。
---

<div class="vp-doc" style="max-width:900px;margin:0 auto;padding:48px 24px;">

## 产品演示

<div style="position:relative;width:100%;padding-top:56.25%;margin:16px 0;">
  <iframe
    src="//player.bilibili.com/player.html?isOutside=true&aid=116276223548755&bvid=BV1dmQ9B6ELE&cid=36902799165&p=1"
    scrolling="no"
    frameborder="0"
    allowfullscreen="true"
    style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px;"
  ></iframe>
</div>

## 功能截图

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0;">
<div>

**快速入门引导**

<img :src="'/pics/1.png'" alt="快速入门引导" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
<div>

**好友总览 Dashboard**

<img :src="'/pics/2.png'" alt="好友总览" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
<div>

**联系人排行榜**

<img :src="'/pics/3.png'" alt="联系人排行" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
<div>

**联系人深度画像**

<img :src="'/pics/4.png'" alt="联系人详情" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
<div>

**情感分析**

<img :src="'/pics/5.png'" alt="情感分析" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
<div>

**群聊画像**

<img :src="'/pics/6.png'" alt="群聊画像" style="width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);" />

</div>
</div>

## 快速开始

### Demo 模式（无需真实数据）

```bash
cd welink
docker compose -f docker-compose.demo.yml up
```

访问 [localhost:3000](http://localhost:3000) 即可体验，预置了完整联系人列表与模拟消息。

### 正式使用

**第一步** — 解密微信数据库（需要电脑微信处于运行状态）：

```bash
git clone https://github.com/ylytdeng/wechat-decrypt
cd wechat-decrypt
sudo python3 main.py
```

**第二步** — 启动 WeLink：

::: code-group

```bash [Docker]
cd welink
docker compose up
```

```bash [macOS App]
# 从 GitHub Releases 下载 WeLink.dmg
# 启动后在配置向导中选择 decrypted/ 目录
```

```bash [Windows App]
# 从 GitHub Releases 下载 WeLink-windows-amd64.zip
# 解压后双击 WeLink.exe
```

:::

访问 [localhost:3000](http://localhost:3000) 开始分析。

## 系统要求

| 平台 | 要求 |
|------|------|
| macOS App | macOS 12（Monterey）及以上 |
| Windows App | Windows 10 1903 及以上 |
| Docker | 任意支持 Docker 的系统 |

| 数据规模 | 消息量 | 推荐内存 |
|----------|--------|----------|
| 轻量 | 50 万条以下 | 2 GB |
| 中等 | 50–200 万条 | 4 GB |
| 重度 | 200 万条以上 | 8 GB+ |

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Go + Gin |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 数据库 | SQLite（modernc，纯 Go，无 CGO） |
| 中文分词 | go-ego/gse |
| 部署 | Docker Compose |

</div>
