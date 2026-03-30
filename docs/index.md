---
layout: home

hero:
  name: WeLink
  text: AI 驱动的微信聊天数据分析平台
  tagline: 对你的聊天记录直接提问，让 AI 读懂每一段关系
  image:
    src: /logo.svg
    alt: WeLink
  actions:
    - theme: brand
      text: AI 分析功能
      link: /ai-analysis
    - theme: brand
      text: 在线 Demo
      link: https://demo.welink.click
    - theme: alt
      text: 下载安装
      link: /install

features:
  - icon: 🤖
    title: AI 对话分析
    details: 针对任意联系人或群聊直接提问。「我们最常聊什么话题？」「这段关系经历了哪些阶段？」AI 读完聊天记录再回答，不是搜索框。
  - icon: 🔀
    title: 混合检索（RAG）
    details: FTS5 全文检索 + 语义向量检索双引擎并行，精准召回相关消息片段作为上下文，问题越具体答案越准确。
  - icon: 🧠
    title: 记忆提炼
    details: LLM 批量阅读历史记录，自动提炼关键事实（人名、事件、情感节点）持久化存储，让 AI 在后续对话中拥有长期记忆。
  - icon: ⏳
    title: 时光机
    details: 可滑动的全历史日历热力图，点击任意一天查看当天所有私聊和群聊，或直接对当天内容发起 AI 分析。
  - icon: 👥
    title: 好友深度画像
    details: 消息排行、峰值月份、聊天趋势、24 小时活跃分布、词云、情感曲线，一屏读懂一段关系的完整轨迹。
  - icon: 💬
    title: 群聊分析
    details: 成员发言排行、活跃时间分布、高频词云，支持查看任意一天的完整群聊记录。
  - icon: 🔍
    title: 全局搜索
    details: 跨所有联系人与群聊搜索聊天记录，关键词高亮，点击任意消息可弹出当天完整对话并自动定位。
  - icon: 🔒
    title: 完全本地，数据不出机
    details: 所有分析和 AI 推理均在本机完成，不上传任何服务器。支持 Ollama 离线运行，连 API Key 都不需要。
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
| 全文检索 | SQLite FTS5 |
| 向量检索 | 余弦相似度（纯 Go，无外部依赖） |
| AI / LLM | OpenAI / Ollama / Gemini / 自定义（兼容 OpenAI 接口） |
| 中文分词 | go-ego/gse |
| 部署 | Docker Compose |

</div>
