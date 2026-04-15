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
    details: 让 AI 学习任何联系人的聊天风格，模拟和 TA 对话。追忆远方的亲人、重逢失联的老友——TA 会用 TA 的方式回应你。
    link: /ai-clone
    linkText: 了解更多
  - icon: 🔮
    title: Skill 炼化
    details: 把聊天记录炼化为 Claude Code / Codex / Cursor 等 AI 工具的 Skill 文件包。3 种类型 × 6 种格式。
    link: /skill-forge
    linkText: 了解更多
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

## 全部功能一览

<style>
.feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
@media (max-width: 768px) { .feat-grid { grid-template-columns: 1fr; } }
.feat-card { border: 1px solid #f0f0f0; border-radius: 12px; padding: 20px; background: #fafafa; }
.feat-card h4 { margin: 8px 0 4px; font-size: 15px; }
.feat-card p { font-size: 13px; color: #666; line-height: 1.6; margin: 0; }
.feat-card .icon { font-size: 24px; }
html.dark .feat-card { background: #1e1e20; border-color: #2e2e30; }
html.dark .feat-card p { color: #999; }
</style>

<details open>
<summary style="font-size:16px;font-weight:800;cursor:pointer;padding:8px 0;color:#07c160;">🤖 AI 功能</summary>
<div class="feat-grid">
<div class="feat-card"><div class="icon">👥</div><h4>AI 群聊模拟</h4><p>AI 按群友发言比例和风格模拟群聊，你也可以随时加入。支持自定义话题、氛围和参与成员。</p></div>
<div class="feat-card"><div class="icon">🌐</div><h4>跨联系人 AI 问答</h4><p>问「谁聊过旅行」「去年国庆和谁聊天了」，AI 自动搜索所有记录并汇总回答。Agent 模式。</p></div>
<div class="feat-card"><div class="icon">📝</div><h4>AI 洞察</h4><p>一键生成关系报告、性格画像卡、AI 日记。基于统计摘要+采样，每次约 5k token。</p></div>
<div class="feat-card"><div class="icon">🤖</div><h4>AI 对话分析</h4><p>针对任意联系人或群聊直接提问，AI 读完聊天记录再回答，不是搜索框。</p></div>
<div class="feat-card"><div class="icon">🔀</div><h4>混合检索（RAG）</h4><p>FTS5 全文检索 + 语义向量检索双引擎并行，精准召回相关消息片段作为上下文。</p></div>
<div class="feat-card"><div class="icon">🧠</div><h4>记忆提炼</h4><p>LLM 批量提炼关键事实（人名、事件、情感节点）持久化存储，让 AI 拥有长期记忆。</p></div>
</div>
</details>

<details>
<summary style="font-size:16px;font-weight:800;cursor:pointer;padding:8px 0;color:#07c160;">📊 数据分析</summary>
<div class="feat-grid">
<div class="feat-card"><div class="icon">💬</div><h4>群聊分析 + 小团体检测</h4><p>成员排行、趋势图、词云、力导向关系图自动识别小圈子。潜水成员检测 + 按发言人搜索导出。</p></div>
<div class="feat-card"><div class="icon">⏱️</div><h4>回复节奏分析</h4><p>双向对比回复速度、分时段柱状图、消息间隔分布、聊天密度曲线判断关系升温或降温。</p></div>
<div class="feat-card"><div class="icon">🪞</div><h4>谁最像谁</h4><p>18 维特征向量 + 余弦相似度，找到说话最像的两个人，展示共同高频词。</p></div>
<div class="feat-card"><div class="icon">🧧</div><h4>红包 / 转账总览</h4><p>全局 KPI + 月度趋势 + 联系人排行，细分发红包/收红包/发转账/收转账四方向。</p></div>
<div class="feat-card"><div class="icon">👤</div><h4>个人自画像</h4><p>汇总「我」的发言指纹：活跃时段、常联系的人、24h 分布、社交广度曲线。</p></div>
<div class="feat-card"><div class="icon">🌐</div><h4>共同社交圈</h4><p>选两个联系人，基于共同群聊推测共同朋友圈，多群共现意味着关系更紧密。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>群聊活跃度对比</h4><p>同时选中多个群对比消息量、成员数、日均消息、人均消息。</p></div>
</div>
</details>

<details>
<summary style="font-size:16px;font-weight:800;cursor:pointer;padding:8px 0;color:#07c160;">🔧 平台能力</summary>
<div class="feat-grid">
<div class="feat-card"><div class="icon">🔗</div><h4>链接收藏夹</h4><p>自动扫描所有聊天中的链接，按域名聚合，支持搜索和 CSV 导出。</p></div>
<div class="feat-card"><div class="icon">🔍</div><h4>全局搜索</h4><p>跨联系人与群聊搜索，关键词高亮，热门推荐，点击消息弹出当天完整对话。</p></div>
<div class="feat-card"><div class="icon">🎬</div><h4>聊天回放</h4><p>选择联系人和时间范围，按真实时间间隔回放聊天记录，6 档倍速控制。</p></div>
<div class="feat-card"><div class="icon">📅</div><h4>年度社交回顾</h4><p>Spotify Wrapped 风格，分页卡片展示年度 Top5、活跃月、深夜时光、新朋友。</p></div>
<div class="feat-card"><div class="icon">✏️</div><h4>自定义 Prompt</h4><p>所有 AI 功能的 System Prompt 完全透明可编辑，支持变量替换。</p></div>
<div class="feat-card"><div class="icon">🖥️</div><h4>多平台支持</h4><p>Docker + macOS App + Windows App + MCP Server（Claude Code 集成）。</p></div>
</div>
</details>

<details>
<summary style="font-size:16px;font-weight:800;cursor:pointer;padding:8px 0;color:#07c160;">⚡ 使用技巧 <a href="/ux" style="font-size:12px;font-weight:500;color:#07c160;text-decoration:underline;margin-left:8px;">完整说明 →</a></summary>
<div class="feat-grid">
<div class="feat-card"><div class="icon">⌨️</div><h4>命令面板（⌘K）</h4><p>任意页面按 ⌘K 搜索联系人、群聊、AI 对话历史，触发备份 / 诊断 / 刷新索引等动作。空查询展示最近打开。</p></div>
<div class="feat-card"><div class="icon">🔢</div><h4>⌘1..⌘9 Tab 快捷键</h4><p>一键跳转到任意主 Tab：⌘1 首页 · ⌘2 统计 · ⌘3 联系人 · ⌘4 群聊 · ⌘5 搜索 · ⌘6 时间线 · ⌘7 日历 · ⌘8 Skills · ⌘9 设置。</p></div>
<div class="feat-card"><div class="icon">🩺</div><h4>一键诊断</h4><p>设置页 → 诊断：数据目录健康 / 索引状态 / LLM 探活 / 磁盘占用。右上角可复制为 Markdown 直接贴 issue。</p></div>
<div class="feat-card"><div class="icon">💾</div><h4>AI 数据备份 / 恢复</h4><p>Skills、聊天历史、记忆一键导出为 .db 快照（VACUUM INTO，自洽无损）。换机 / 重装前先备份，不会丢 AI 工作。</p></div>
<div class="feat-card"><div class="icon">👥</div><h4>多账号快速切换</h4><p>把多个 decrypted/ 目录作为 profile 保存，下拉切换即热替换，无需重启。</p></div>
<div class="feat-card"><div class="icon">📊</div><h4>真实索引进度</h4><p>初始化屏幕显示真实进度条 + ETA + 当前处理联系人；支持中途取消。</p></div>
</div>
</details>

</div>

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


</div>
