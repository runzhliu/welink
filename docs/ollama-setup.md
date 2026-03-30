# Ollama 本地 AI 配置指南

WeLink 的混合检索（RAG）和记忆提炼功能支持使用 [Ollama](https://ollama.com) 在本地运行 AI 模型，无需注册账号、无需联网、数据完全不离开设备。

> **关于"mem0 风格记忆提炼"**：这是 WeLink 的内置功能，**不需要安装 mem0**。只需配置好 Ollama（或其他 LLM），在 AI 分析面板构建向量索引时会自动触发。

---

## Ollama 的作用

WeLink 中 Ollama 可承担两个角色：

| 角色 | 说明 | 推荐模型 |
|------|------|---------|
| **Embedding 模型** | 将消息转换为向量，用于语义检索 | `nomic-embed-text`（必需） |
| **LLM 对话模型** | 回答问题、提炼记忆事实 | `qwen2.5:7b` 或更大（可选） |

> Embedding 和 LLM 可以分别使用不同的 Provider。例如：Embedding 用本地 Ollama，LLM 用云端 DeepSeek。

---

## 安装 Ollama

### macOS / Windows / Linux

前往 [ollama.com/download](https://ollama.com/download) 下载对应平台安装包，或使用命令行：

**macOS**（Homebrew）：
```bash
brew install ollama
```

**Linux**：
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

安装完成后，Ollama 服务默认监听 `http://localhost:11434`。

---

## 拉取所需模型

### Embedding 模型（必需）

```bash
ollama pull nomic-embed-text
```

`nomic-embed-text` 体积约 274 MB，支持中英文，生成 768 维向量，是语义检索的核心。

### LLM 对话模型（可选，用于记忆提炼）

推荐按设备内存选择：

| 模型 | 内存需求 | 中文能力 | 说明 |
|------|---------|---------|------|
| `qwen2.5:7b` | 8 GB+ | 优秀 | **推荐首选** |
| `qwen2.5:3b` | 4 GB+ | 良好 | 内存受限时使用 |
| `llama3.2:3b` | 4 GB+ | 一般 | 中文较弱，不推荐 |

```bash
ollama pull qwen2.5:7b
```

---

## 验证 Ollama 已启动

```bash
curl http://localhost:11434/api/tags
```

若返回 JSON 列表（包含已拉取的模型）即表示正常运行。

---

## 在 WeLink 中配置

### Embedding 配置（语义检索必需）

1. 进入 **设置 → 向量 Embedding 配置**
2. Provider 选择 **Ollama（本地，免费）**
3. Base URL 留空（默认 `http://localhost:11434`）
4. 模型填写 `nomic-embed-text`（或留空使用默认值）
5. 点击**保存**，再点击**测试连接**

### LLM 配置（记忆提炼可选）

1. 进入 **设置 → AI 模型配置**
2. Provider 选择 **Ollama**
3. Base URL 填写 `http://localhost:11434/v1`
4. 模型填写 `qwen2.5:7b`（或你已拉取的模型名）
5. API Key 留空
6. 点击**保存**

---

## Docker 部署时的特殊配置

若 WeLink 通过 Docker Compose 运行，容器内无法直接访问宿主机的 `localhost`，需使用特殊地址：

| 平台 | Ollama 地址 |
|------|------------|
| macOS / Windows（Docker Desktop） | `http://host.docker.internal:11434` |
| Linux（Docker） | 宿主机 IP，如 `http://172.17.0.1:11434` |

**Linux 获取宿主机 IP：**
```bash
ip route show default | awk '/default/ {print $3}'
```

在 WeLink 设置中将 Base URL 填写为对应地址，设置页面也提供了点击自动填入 `host.docker.internal` 的快捷按钮。

### 开启 Ollama 跨主机访问

默认情况下 Ollama 只监听本机，需添加环境变量让其监听所有接口：

**macOS / Linux（命令行启动）：**
```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

**macOS（launchd 服务）：**
```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
# 然后重启 Ollama 服务
```

**Linux（systemd）：**
```bash
sudo systemctl edit ollama
# 在 [Service] 段添加：
# Environment="OLLAMA_HOST=0.0.0.0"
sudo systemctl restart ollama
```

---

## 常见问题

**Q: 点击测试连接提示"connection refused"？**

Ollama 服务可能未启动，或端口被防火墙拦截。执行 `ollama serve` 手动启动，确认 `http://localhost:11434` 可访问。

**Q: Docker 中提示"connection refused"？**

使用 `http://host.docker.internal:11434`（macOS/Windows）或宿主机 IP（Linux），并确认 Ollama 已开启跨接口监听（见上方配置）。

**Q: Embedding 报错"input length exceeds context length"？**

WeLink 已内置截断处理（每条消息最多 400 个字符参与向量化），此错误不应再出现。若仍出现，请更新到最新版本。

**Q: 小模型提炼记忆效果差，JSON 格式频繁出错？**

建议至少使用 `qwen2.5:7b`。3B 以下模型对结构化输出支持有限，WeLink 会自动跳过解析失败的批次，不会中断索引构建，但提炼的事实数量会减少。

**Q: 构建索引太慢？**

Embedding 批次大小在 Ollama 模式下为 20 条/批，主要受 CPU/GPU 性能影响。若有独立 GPU，Ollama 会自动使用，速度可提升 5–10 倍。进度可在 AI 分析面板实时查看。
