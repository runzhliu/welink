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
    title: 群聊分析
    details: 成员发言排行、活跃趋势图、高峰日 TOP 5、高频词云，支持查看任意一天的完整群聊记录。
  - icon: 🔍
    title: 全局搜索
    details: 跨所有联系人与群聊搜索聊天记录，关键词高亮，热门搜索推荐，点击任意消息可弹出当天完整对话并自动定位。
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
