---
layout: home

hero:
  name: WeLink
  text: AI 驱动的微信聊天数据分析平台
  tagline: 选择聊天记录直接提问，让 AI 读懂每一段关系
  image:
    src: /logo.svg
    alt: WeLink
  actions:
    - theme: brand
      text: 在线 Demo
      link: https://demo.welink.click
    - theme: alt
      text: 下载安装
      link: /install

features:
  - icon: 🪞
    title: AI 分身（核心功能）
    details: 让 AI 学习任何联系人的聊天风格，模拟和 TA 对话。追忆远方的亲人、重逢失联的老友，或和最信任的人聊聊——TA 会用 TA 的方式回应你。
    link: /ai-clone
    linkText: 了解更多
  - icon: 🔮
    title: Skill 炼化
    details: 把聊天记录炼化为 Claude Code / Codex / OpenCode / Cursor 等 AI 编程工具的 Skill 文件包。3 种类型（联系人 / 我自己 / 群聊智囊）× 6 种输出格式，让任意 AI 工具都能用 TA 的语气说话。
    link: /skill-forge
    linkText: 了解更多
  - icon: 👥
    title: AI 群聊模拟
    details: AI 按群友的发言比例和说话风格模拟群聊对话，你也可以随时加入。支持自定义话题、氛围和参与成员。
    link: /ai-group-sim
    linkText: 了解更多
  - icon: 🌐
    title: 跨联系人 AI 问答
    details: 不限于单个联系人——问「谁聊过旅行」「去年国庆和谁聊天了」，AI 自动搜索所有记录并汇总回答。Agent 模式，低 token 消耗。
  - icon: 📝
    title: AI 洞察（报告/画像/日记）
    details: 一键生成关系发展报告、性格风格画像卡、任意一天的 AI 日记。基于统计摘要+采样，每次仅消耗约 5k token。
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
  - icon: 📊
    title: 好友深度画像
    details: 消息排行、峰值月份、聊天趋势、24 小时活跃分布、词云、情感曲线，一屏读懂一段关系的完整轨迹。
  - icon: 💬
    title: 群聊分析 + 小团体检测
    details: 成员发言排行、活跃趋势图、高频词云。力导向关系图自动识别群内小圈子（Label Propagation 社区检测）。潜水成员检测一眼找到从不说话的人，群聊搜索支持按发言人筛选和导出。
  - icon: ⏱️
    title: 回复节奏分析
    details: 双向对比我和对方的回复速度（中位数、秒回次数、慢回次数）、分时段柱状图、消息间隔分布直方图、聊天密度曲线自动判断关系升温或降温。
  - icon: 🪞
    title: 谁最像谁
    details: 基于消息类型分布、平均长度、表情偏好、互动方式等 18 维特征向量，余弦相似度计算联系人聊天风格相似度排行，发现说话最像的两个人。
  - icon: 🧧
    title: 红包 / 转账总览
    details: 全局 KPI + 月度收发趋势 + 联系人红包转账排行，细分四方向（发红包 / 收红包 / 发转账 / 收转账）。
  - icon: 👤
    title: 个人自画像 + 社交广度
    details: 汇总「我」方向的所有数据，画出你的发言指纹：最活跃时段、最常联系的人、24h 发送分布；每日社交广度曲线看到「社牛日」和「闭关日」。
  - icon: 🌐
    title: 共同社交圈
    details: 选两个联系人，基于共同所在群聊推测他们的共同朋友圈。列出共同群（小群优先）和推测的共同好友，多群共现意味着关系更紧密。
  - icon: 🔗
    title: 链接收藏夹
    details: 自动扫描所有聊天中发过 / 收过的链接，按域名聚合，支持搜索和 CSV 导出。那些在微信里分享过的好文章再也不会丢。
  - icon: 📊
    title: 群聊活跃度对比
    details: 同时选中多个群进行对比，柱状图展示消息量，表格对比成员数、日均消息、人均消息、活跃天数。
  - icon: 🔍
    title: 全局搜索
    details: 跨所有联系人与群聊搜索聊天记录，关键词高亮，热门搜索推荐，点击任意消息可弹出当天完整对话并自动定位。
  - icon: 🧩
    title: 13+ LLM 提供商原生支持
    details: DeepSeek、Kimi、OpenAI、Claude、Gemini、GLM、Grok、MiniMax、Ollama，以及原生 Google Vertex AI（Service Account JWT 认证）和 AWS Bedrock（SigV4 签名 + Converse API），还支持任意 OpenAI 兼容接口。
  - icon: 🔒
    title: 完全本地，数据不出机
    details: 所有分析和 AI 推理均在本机完成，不上传任何服务器。支持 Ollama 离线运行，连 API Key 都不需要。
---

<div class="vp-doc" style="max-width:900px;margin:0 auto;padding:48px 24px;">

## 功能示例

> 点击下方示例可放大查看

<!-- 视频点击放大遮罩 -->
<div id="video-overlay" onclick="this.style.display='none';this.querySelector('video').src=''" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.85);cursor:zoom-out;justify-content:center;align-items:center;">
  <video autoplay loop muted playsinline style="max-width:92vw;max-height:92vh;border-radius:12px;"></video>
</div>

<script setup>
import { onMounted } from 'vue'
onMounted(() => {
  window.zoomVideo = (src) => {
    const overlay = document.getElementById('video-overlay')
    const video = overlay.querySelector('video')
    video.src = src
    overlay.style.display = 'flex'
  }
})
</script>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0;">
<div>

**AI 分身**

<video src="/pics/1-AI分身.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**AI 分析**

<video src="/pics/2-AI分析.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**AI 群聊**

<video src="/pics/3-AI群聊.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**AI 首页**

<video src="/pics/4-AI首页.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**快速入门引导**

<video src="/pics/5-快速入门引导.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**好友总览**

<video src="/pics/6-好友总览.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**好友深度画像**

<video src="/pics/7-好友深度画像.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**群聊画像**

<video src="/pics/8-群聊画像.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**全局搜索**

<video src="/pics/9-全局搜索.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**时间线**

<video src="/pics/10-时间线.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**时光机**

<video src="/pics/11-时光机.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

</div>
<div>

**纪念日**

<video src="/pics/12-纪念日.mp4" autoplay loop muted playsinline onclick="zoomVideo(this.src)" style="cursor:zoom-in;width:100%;border-radius:8px;border:1px solid var(--vp-c-divider);"></video>

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


</div>
