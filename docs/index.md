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
      text: 🚀 在线 Demo
      link: https://demo.welink.click
    - theme: alt
      text: 📦 下载安装
      link: /install
    - theme: sponsor
      text: GitHub ⭐
      link: https://github.com/runzhliu/welink

features:
  - icon: 🪞
    title: AI 分身（核心功能）
    details: 让 AI 学习任何联系人的聊天风格，模拟和 TA 对话。追忆远方的亲人、重逢失联的老友——TA 会用 TA 的方式回应你。
    link: /ai-clone
    linkText: 了解更多
  - icon: 🔮
    title: Skill 炼化
    details: 把聊天记录炼化为 Claude Code / Codex / Cursor 等 AI 工具的 Skill 文件包。3 种类型 × 6 种格式。
    link: /skill-forge
    linkText: 了解更多
  - icon: 💕
    title: 关系动态预测
    details: 扫描最近 6 月节奏，给每个联系人打「升温/稳定/降温/濒危」4 档，AI 生成破冰开场白。主动占比 + 响应时延 + 连续冷却多维信号。
  - icon: 📦
    title: 导出中心
    details: 年度回顾、对话归档、AI 历史、记忆图谱一键导出到 8 种目标：Markdown / Notion / 飞书 / WebDAV / S3 / Dropbox / Google Drive / OneDrive。
  - icon: 🗄️
    title: 自然语言查数据
    details: 在数据库页用中文问 AI「我和老婆的第一条消息是什么时候」，LLM 自动写 SQL 并执行，支持跨库联系人查询。
  - icon: 📊
    title: 好友深度画像
    details: 消息排行、聊天趋势、24h 分布、词云、情感曲线、回复节奏，一屏读懂一段关系。
  - icon: 🧩
    title: 13+ LLM 提供商
    details: DeepSeek、Kimi、OpenAI、Claude、Gemini、Ollama、Vertex AI、Bedrock 等原生支持。
  - icon: 🔒
    title: 完全本地，数据不出机
    details: 所有分析均在本机完成，不上传任何服务器。支持 Ollama 离线运行。
  - icon: ⏳
    title: 时光机 + 年度回顾
    details: 全历史日历热力图 + Spotify Wrapped 风格的年度社交总结，可分享。
---

<div class="vp-doc" style="max-width:960px;margin:0 auto;padding:24px;">

<div class="welink-badges">
  <a href="https://github.com/runzhliu/welink/stargazers"><img src="https://img.shields.io/github/stars/runzhliu/welink?style=social" alt="Stars" /></a>
  <a href="https://github.com/runzhliu/welink/releases"><img src="https://img.shields.io/github/v/release/runzhliu/welink?include_prereleases&color=07c160" alt="Latest release" /></a>
  <a href="https://github.com/runzhliu/welink/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-brightgreen" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20·%20Windows%20·%20Docker-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/data-100%25%20local-brightgreen" alt="100% local" />
</div>

<div class="welink-stats">
  <div class="welink-stat-card">
    <div class="stat-icon" style="color:#07c160;">🛠️</div>
    <div class="num" style="color:#07c160;"><span class="welink-countup" data-to="20" data-dur="1500">0</span></div>
    <div class="lbl">MCP 工具</div>
  </div>
  <div class="welink-stat-card">
    <div class="stat-icon" style="color:#10aeff;">📦</div>
    <div class="num" style="color:#10aeff;"><span class="welink-countup" data-to="8" data-dur="1200">0</span></div>
    <div class="lbl">导出目标</div>
  </div>
  <div class="welink-stat-card">
    <div class="stat-icon" style="color:#ff9500;">🧩</div>
    <div class="num" style="color:#ff9500;"><span class="welink-countup" data-to="13" data-dur="1400">0</span><span style="font-size:24px;">+</span></div>
    <div class="lbl">LLM 提供商</div>
  </div>
  <div class="welink-stat-card">
    <div class="stat-icon" style="color:#fa5151;">🔒</div>
    <div class="num" style="color:#fa5151;"><span class="welink-countup" data-to="100" data-dur="1800" data-suffix="%">0</span></div>
    <div class="lbl">本地运行</div>
  </div>
</div>

## 为什么选 WeLink

<div class="welink-pillars">
  <div class="pillar">
    <div class="pillar-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
    </div>
    <div class="pillar-title">数据不出机</div>
    <div class="pillar-body">分析、索引、向量化全都跑在你本机。Ollama 离线模式下连 API Key 都不用填，AGPL-3.0 全开源可审计。</div>
  </div>
  <div class="pillar">
    <div class="pillar-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>
    </div>
    <div class="pillar-title">AI 读懂关系</div>
    <div class="pillar-body">不是搜索框 —— AI 分身模拟 TA 说话，关系预测提前预警降温，4 种调性破冰话术一键生成，还能让 AI 写双人对话播客。</div>
  </div>
  <div class="pillar">
    <div class="pillar-icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.98.98 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z"/></svg>
    </div>
    <div class="pillar-title">13+ 种 LLM 任选</div>
    <div class="pillar-body">DeepSeek / Kimi / OpenAI / Claude / Gemini / Ollama / Vertex / Bedrock 原生支持，多配置热切换，哪家便宜用哪家。</div>
  </div>
</div>

## 动图直观感受

<div class="welink-video-hero">
  <div class="welink-video-card">
    <div class="welink-video-card-label">🪞 AI 分身</div>
    <video src="/pics/1-AI分身.mp4" poster="/pics/1.png" autoplay loop muted playsinline onclick="zoomVideo(this.src)"></video>
  </div>
  <div class="welink-video-card">
    <div class="welink-video-card-label">🧠 AI 分析</div>
    <video src="/pics/2-AI分析.mp4" poster="/pics/2.png" autoplay loop muted playsinline onclick="zoomVideo(this.src)"></video>
  </div>
</div>

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

<div class="welink-more-videos">

<details>
<summary>📽️ 查看更多功能演示（10 条）</summary>

<div class="welink-video-grid">
  <div class="welink-lazy-video"><div class="lbl">AI 群聊</div><video src="/pics/3-AI群聊.mp4" poster="/pics/3.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">AI 首页</div><video src="/pics/4-AI首页.mp4" poster="/pics/4.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">快速入门引导</div><video src="/pics/5-快速入门引导.mp4" poster="/pics/5.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">好友总览</div><video src="/pics/6-好友总览.mp4" poster="/pics/6.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">好友深度画像</div><video src="/pics/7-好友深度画像.mp4" poster="/pics/7.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">群聊画像</div><video src="/pics/8-群聊画像.mp4" poster="/pics/8.png" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">全局搜索</div><video src="/pics/9-全局搜索.mp4" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">时间线</div><video src="/pics/10-时间线.mp4" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">时光机</div><video src="/pics/11-时光机.mp4" loop muted playsinline preload="none"></video></div>
  <div class="welink-lazy-video"><div class="lbl">纪念日</div><video src="/pics/12-纪念日.mp4" loop muted playsinline preload="none"></video></div>
</div>

</details>

</div>

<p class="welink-all-features-cta">
  <a href="/features">📚 查看全部功能清单 →</a>
</p>

## 🎮 试一下（无需安装）

不想下载也能试 —— 我们托管了一个带阿森纳 2025/26 球员示例数据的 Demo 站点：

<div class="welink-demo-embed">
  <div class="iframe-wrap">
    <iframe
      src="https://demo.welink.click"
      title="WeLink 在线 Demo"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
  </div>
  <div class="footer">
    <span>🏴󠁧󠁢󠁥󠁮󠁧󠁿 <b>COYG!</b> · Demo 数据：阿森纳 2025/26 一线队与教练组聊天记录</span>
    <a href="https://demo.welink.click" target="_blank">在新窗口打开 →</a>
  </div>
</div>

## 快速开始

### Demo 模式（无需真实数据）

```bash
cd welink
docker compose -f docker-compose.demo.yml up
```

访问 [localhost:3418](http://localhost:3418) 即可体验，预置了完整联系人列表与模拟消息。

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

访问 [localhost:3418](http://localhost:3418) 开始分析。

<div class="welink-marquee" aria-hidden="true">
  <div class="welink-marquee-track">
    <span>本地优先</span>
    <span>数据不出机</span>
    <span>AI 分身</span>
    <span>关系动态预测</span>
    <span>群聊时钟指纹</span>
    <span>AI 群年报</span>
    <span>自然语言查数据</span>
    <span>导出到 8 种目标</span>
    <span>Skill 炼化</span>
    <span>MCP × Claude Code</span>
    <!-- 复制一份保证无缝循环 -->
    <span>本地优先</span>
    <span>数据不出机</span>
    <span>AI 分身</span>
    <span>关系动态预测</span>
    <span>群聊时钟指纹</span>
    <span>AI 群年报</span>
    <span>自然语言查数据</span>
    <span>导出到 8 种目标</span>
    <span>Skill 炼化</span>
    <span>MCP × Claude Code</span>
  </div>
</div>

</div>
