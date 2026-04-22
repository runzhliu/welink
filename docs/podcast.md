# AI 播客文档

> 本文档描述 WeLink 的 AI 播客功能：脚本生成、TTS 语音合成、以及如何接入第三方 / 自建兼容 OpenAI `/audio/speech` 协议的服务。

## 目录

- [播客功能概览](#播客功能概览)
- [两层架构：脚本 + 语音](#两层架构脚本--语音)
- [脚本生成：所有 LLM Provider 均可用](#脚本生成所有-llm-provider-均可用)
- [TTS 语音合成：OpenAI 协议兼容](#tts-语音合成openai-协议兼容)
- [推荐服务一览](#推荐服务一览)
  - [OpenAI 官方](#openai-官方)
  - [硅基流动 SiliconFlow](#硅基流动-siliconflow)
  - [自建 Edge-TTS 代理](#自建-edge-tts-代理)
  - [其他兼容服务](#其他兼容服务)
- [配置示例](#配置示例)
- [常见问题](#常见问题)

## 播客功能概览

联系人详情页点「🎙 播客」按钮：AI 读取你和对方的聊天历史 → 写出一份双主持人（A/B）对话脚本 → 逐段调 TTS 合成语音 → 拼成 MP3 可下载分享。

默认 3 分钟时长，支持 5 分钟、10 分钟。脚本和音频都保存在本地，可重播。

## 两层架构：脚本 + 语音

| 层次 | 负责什么 | 用什么 provider |
|------|---------|---------------|
| **脚本生成** | 把聊天历史变成自然对话稿，标注 A/B 角色 | 走全站主 AI 配置，任意 LLM 都行 |
| **语音合成 (TTS)** | 把文字变成音频 | 只认 OpenAI `/audio/speech` 协议 |

两层独立配置，脚本用 Claude 写，语音用 SiliconFlow 合 —— 都行。

## 脚本生成：所有 LLM Provider 均可用

脚本生成复用全站主 AI 配置，设置 → AI 配置（分析模型）里选的 provider 就是播客用的：

- DeepSeek / Kimi / Gemini / GLM / Grok / MiniMax
- OpenAI / Claude
- Google Vertex AI / AWS Bedrock
- Ollama（本地）
- 自定义 OpenAI 兼容接口

如果同时配了多个 profile，播客界面可切换用哪一个生成脚本。

## TTS 语音合成：OpenAI 协议兼容

**后端实现上只支持 OpenAI 的 `/audio/speech` 端点**。但这个协议已经是事实标准，许多第三方和自建服务都兼容，所以实际可选面很广。

配置位置：**设置 → 播客 TTS 配置**

需填 4 项：
- `Base URL`：服务端点（不含 `/audio/speech` 后缀）
- `API Key`：该服务的密钥
- `模型`：服务端定义的模型名
- `主持人 A / B 声音`：服务端支持的 voice id

## 推荐服务一览

设置页已内置「快速填充」按钮，一键套用下列预设。

### OpenAI 官方

- **Base URL**：`https://api.openai.com/v1`
- **模型**：`tts-1`（标准）或 `tts-1-hd`（高清）
- **声音**：`alloy` / `echo` / `onyx` / `fable` / `nova` / `shimmer`
- **Key 获取**：<https://platform.openai.com/api-keys>
- **特点**：英文最佳，中文可接受；需海外付费账号

### 硅基流动 SiliconFlow

- **Base URL**：`https://api.siliconflow.cn/v1`
- **模型**：`FunAudioLLM/CosyVoice2-0.5B`（推荐，中文效果最好）
- **声音**：`FunAudioLLM/CosyVoice2-0.5B:alex` 等（用 `模型:voiceId` 格式）
- **Key 获取**：<https://cloud.siliconflow.cn/account/ak>
- **特点**：国内友好，新注册送额度，CosyVoice 中文自然度极佳

### 自建 Edge-TTS 代理

通过 [openai-edge-tts](https://github.com/travisvn/openai-edge-tts) 等开源项目，把微软 Edge TTS 包装成 OpenAI 协议。

```bash
docker run -d --name edge-tts -p 5050:5050 travisvn/openai-edge-tts
```

- **Base URL**：`http://localhost:5050/v1`
- **API Key**：留空或 `any`
- **模型**：`tts-1`
- **声音**：`zh-CN-YunxiNeural` / `zh-CN-XiaoyiNeural` / `zh-CN-XiaoxiaoNeural` / `zh-CN-YunyangNeural` 等
- **特点**：完全免费，无需注册，中文声音丰富（40+ 种）

### 其他兼容服务

- **Fish Audio / ElevenLabs**：通过第三方 OpenAI 兼容封装可接入
- **本地 Kokoro / GPT-SoVITS / XTTS**：部署 OpenAI 协议 wrapper 后即可
- **火山引擎 / 阿里云**：需要 OpenAI 协议转换层

只要该服务实现了 `POST /audio/speech`，请求体接受 `{model, input, voice, response_format}` 字段，响应返回 audio 二进制，就可以用。

## 配置示例

### 示例 1：OpenAI 脚本 + OpenAI 语音

设置 → AI 配置 → DeepSeek（国内快，写稿便宜）
设置 → 播客 TTS → OpenAI 官方（语音质量好）

### 示例 2：全本地离线

设置 → AI 配置 → Ollama（本地 LLM）
设置 → 播客 TTS → 自建 Edge-TTS（本地代理）

完全不依赖外部 API。

### 示例 3：国内成本最低

设置 → AI 配置 → DeepSeek（脚本）
设置 → 播客 TTS → 硅基流动（语音）

## 常见问题

**Q：播客生成很慢？**
A：脚本生成 10-20 秒，TTS 按段合成，3 分钟的播客大约 30-60 秒。TTS 服务响应速度 > LLM 响应速度。自建 Edge-TTS 最快，硅基流动次之，OpenAI 官方有时会慢。

**Q：声音只能二选一吗？**
A：目前双主持人 A/B 两种声音。如果你的服务支持更多 voice，填进设置即可。

**Q：脚本里 A/B 角色错位怎么办？**
A：可以在设置 → Prompts → 播客脚本 里自定义 prompt，明确角色分工。

**Q：为什么不支持 Azure / 阿里云原生接口？**
A：为了代码简洁，后端只实现 OpenAI 协议。这些服务通过 openai-compatible 代理层就能用，社区已有成熟方案。

**Q：能否自己加声音预置？**
A：设置页声音字段是 datalist 输入，可以填任意值（包括 CosyVoice 的长 voice id）。只要你的 TTS 服务认就行。
