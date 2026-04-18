# 常见问题

## 数据隐私

### WeLink 会上传我的聊天记录吗？

**不会。** WeLink 是**单用户本地优先**应用：

- 所有统计分析、图表、搜索都在你自己的机器上完成
- 解密好的 `decrypted/` 数据库只读取、不上传
- AI 调用（LLM / Embedding）**只在你主动配置 Provider** 后才会发送**采样文本**到对应厂商
- 使用 [Ollama 本地模型](./ollama-setup) 可实现完全离线运行

### 那 AI 调用到底发什么给厂商？

看具体功能：

- **AI 分析**（默认）：消息数量统计 + 采样后的片段（≤10k token），系统 prompt 里明确要求 AI 不要复述敏感信息
- **AI 分身**（Skill 炼化）：目标联系人的消息样本（≤50k 字符），敏感字段（手机号 / 邮箱 / 身份证 / 卡号）自动脱敏
- **记忆提炼**：批量抽取事实，返回的结构化 JSON 存本地 `ai_analysis.db`
- **其他**：情感分析、词云、关系预测等都是**纯本地计算**，不调 AI

::: tip 录屏前开启隐私模式
设置 → 隐私 → 录屏模式，所有联系人姓名、群名、词云都会模糊显示。
:::

### 我的 API Key 会泄露吗？

- 本地保存在 `preferences.json`（macOS: `~/Library/Application Support/WeLink/`，Windows: `%APPDATA%\WeLink\`，Docker: `welink-prefs` volume）
- 前端通过 `__HAS_KEY__` 占位符获取脱敏后的 key 状态，不会明文传输
- 在日志里被自动替换为 `[REDACTED]`
- Docker 场景可用环境变量注入，避免落盘

### 同事在局域网里能访问我电脑上的 WeLink 吗？

**默认不能。** 后端只监听 `127.0.0.1:<PORT>`，只有本机能访问。

需要开放给局域网（比如跑在 NAS 上、反代对内共享）时显式设环境变量 `WELINK_LISTEN_LAN=1`。Docker 镜像默认就带了这个变量，但宿主侧通过 compose 里 `127.0.0.1:8080:8080` 的端口映射依然限制暴露范围——如需开放到 LAN，把映射改成 `8080:8080`。

::: warning 开放到 LAN 前的注意事项
- 后端目前无内置 auth，开放到 LAN 等于把聊天数据、API key、OAuth token 的管理面交给同网络任何人
- 仅在**可信网络**（家庭 Wi-Fi、私有 VPC）+ 反代加 HTTPS / Basic Auth 的前提下开
:::

---

## 安装 / 运行

### 我的微信聊天记录怎么解密？

见 [下载与安装 → 解密微信数据库](./install#解密微信数据库)。关键步骤：

1. 手机微信 → 聊天记录迁移到电脑
2. 在电脑上用 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 提取密钥并解密

### macOS 打不开 / Windows SmartScreen 拦截

- macOS：[具体解决方式](./install-macos#下载与安装)（右键打开 / `xattr -cr`）
- Windows：[放行方式](./install-windows#下载与安装)（更多信息 → 仍要运行，或属性解除锁定）

### 内存 / 磁盘要求

参见 [推荐配置](./install#推荐配置)：50 万条以内消息只要 2GB，200 万条以上建议 8GB。首次索引时间与消息量相关。

### 支持多账号吗？

支持。**设置 → 数据目录 · 多账号切换** 里加多个 `decrypted/` 路径作为 profile，下拉切换即热替换，**不需要重启**。

---

## 功能

### AI 分身跟真人有多像？

取决于：

- **输入数据量**：100 条消息只能学表层习惯，≥1000 条能学到口头禅和断句
- **LLM 模型**：Claude / GPT-4 级别的模型能更好捕捉风格
- **共同群聊**：开启后自动抽取 TA 在群里的发言，样本更丰富

::: warning 免责声明
模拟结果不代表真人的真实想法。请善意使用，不要用于冒充或误导他人。
:::

### 关系预测的"濒危"靠谱吗？

基于三维信号综合判定：

1. **消息量对比**：最近 3 月 vs 前 3 月 < 50% 
2. **主动占比变化**：你从 >55% 主动变成 <45%
3. **响应时延**：TA 回复从 10 分钟变成 ≥3× 慢

触发「濒危」需要前 3 月 ≥10 条且 60 天没说话。**≥2 周连续 cooling/endangered** 会带红色「连续 N 周」徽章，避免单周随机波动误判。

### MCP Server 有什么用？

在 Claude Code CLI 里用中文直接查微信数据，无需打开浏览器。例如：

> "我和谁联系最多？列出前 10 名"  
> "帮我看看我和 alice 最近一年的情感变化趋势"  
> "凌晨经常和我聊天的人是谁？"

配置见 [MCP Server 文档](./mcp-server)。

### 能导出到哪里？

[导出中心](./ux#导出中心) 支持 8 种目标：

- **笔记 / 文档**：Markdown / Notion / 飞书
- **云盘 / 对象存储**：WebDAV（坚果云/Nextcloud）/ S3（AWS/R2/OSS/COS/七牛/MinIO）/ Dropbox / Google Drive / OneDrive

每个目标都有详细配置教程。

---

## 故障排查

### 初始化卡住 / 进度条不动

设置 → 诊断。会显示：

- 数据目录是否健康
- 各个 DB 文件大小
- 当前正在处理的联系人
- LLM 探活结果

支持一键复制诊断报告为 Markdown 粘到 issue。

### 群聊分析超时 / 某个大群卡住

40k+ 消息的大群曾经卡半小时。修复后：

- refermsg XML 加 128KB 原始 / 256KB 解压硬上限
- Louvain 社区检测加模块度 Q<0.3 兜底
- 前端 poll 从 nodes.length>0 改为 resp!==null，空图也停
- defer recover + 兜底写空图（避免 panic 导致永远 loading）

如果还是卡，查看日志 `welink.log` 里的 `[GROUPREL]` 行。

### AI 调用失败 / 超时

- 设置 → 诊断 → LLM 探活，看具体哪个 Provider 不通
- 国内网络环境建议：DeepSeek / Kimi / 通义（走国内端点）
- Docker 下需要 `HTTPS_PROXY` 环境变量，详见 [Docker 部署](./docker)

### "找不到数据目录"

- 确认 `decrypted/` 里有 `contact/contact.db` 和 `message/message_*.db`
- Docker 模式检查 volume 挂载：`docker compose exec backend ls /app/data/`
- App 模式在配置向导里重新选择目录

---

## 找不到答案？

- [GitHub Issues](https://github.com/runzhliu/welink/issues) — 报告 bug / 建议新功能
- [GitHub Discussions](https://github.com/runzhliu/welink/discussions) — 使用讨论
- 设置页「反馈问题」一键打开 Modal，自动附带诊断报告 + 环境信息
