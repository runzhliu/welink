# 接入 ChatGPT Custom GPT

把 WeLink 接入 ChatGPT 的 Custom GPT（Actions），就能在 chat.openai.com 里直接用中文问「我和 alice 聊过什么」。

**适用人群**：有 ChatGPT Plus / Team / Enterprise 订阅，且愿意把 WeLink 暴露到公网的用户。

::: danger 数据暴露风险
ChatGPT Actions **走公网** —— 你的 WeLink 后端必须有公网可达地址。这意味着你的聊天数据会通过互联网传给 ChatGPT。请只在**信任这个链路**的前提下使用：

- 访问地址加 HTTP Basic Auth 或 API Key（见下方）
- 数据库不要用工作 / 隐私敏感账号
- 不推荐社恐 / 商业场景
:::

如果只想本地用，推荐 [Claude Code CLI 的 MCP 接入](./mcp-server) 或 [Claude Desktop](./mcp-clients#claude-desktop)，完全不出网。

---

## 步骤总览

1. 把 WeLink 暴露到公网（Cloudflare Tunnel / ngrok / 反代）
2. 加一层 Auth（ChatGPT Actions 支持 API Key / OAuth）
3. 在 ChatGPT 创建 Custom GPT，粘贴 WeLink 的 OpenAPI spec 作为 Action
4. 测试

---

## 1. 暴露到公网

### 方式 A：Cloudflare Tunnel（推荐，免费 + 自动 HTTPS）

```bash
# 安装 cloudflared
brew install cloudflared   # macOS
# 或从 https://github.com/cloudflare/cloudflared/releases 下载

# 登录
cloudflared tunnel login

# 创建 tunnel
cloudflared tunnel create welink-gpt

# 在 DNS 里绑个域名（如 welink.yourdomain.com）到 tunnel
cloudflared tunnel route dns welink-gpt welink.yourdomain.com

# 启动 tunnel 把本地 8080 暴露到公网
cloudflared tunnel --url http://localhost:8080 welink-gpt
```

现在 `https://welink.yourdomain.com` 能访问 WeLink 了。

### 方式 B：ngrok（最简单，临时用）

```bash
ngrok http 8080
```

拿到 `https://xxxx.ngrok.io`，免费版每次重启地址会变。

### 方式 C：自有服务器 + Nginx + Let's Encrypt

参照 [Docker 部署 · 反向代理](./docker#反向代理--https)。

---

## 2. 加 Auth

**WeLink 后端默认没有鉴权**，公网直接开等于把聊天数据送人。必须加一层。

### 推荐：Nginx / Cloudflare 反代加 Basic Auth

Nginx 例子：

```nginx
server {
    listen 443 ssl http2;
    server_name welink.yourdomain.com;
    # ... SSL 配置 ...

    auth_basic "WeLink";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

生成 htpasswd：`htpasswd -c /etc/nginx/.htpasswd welink-gpt`

### 替代：Cloudflare Access / Zero Trust

Cloudflare Access 在 tunnel 前面加身份验证（GitHub / Google 单点登录）。

### 用 API Key header

更轻量的方式：Nginx 层检查 `X-API-Key` header：

```nginx
location / {
    if ($http_x_api_key != "your-long-random-key-here") {
        return 401;
    }
    proxy_pass http://127.0.0.1:8080;
}
```

ChatGPT Actions 支持在 Authentication 里配 API Key header。

---

## 3. 创建 Custom GPT

1. 在 [chat.openai.com](https://chat.openai.com) 右上角头像 → **My GPTs** → **Create a GPT**
2. **Configure** tab 填：
   - **Name**：WeLink
   - **Description**：问我任何微信聊天记录相关的问题
   - **Instructions**（系统 prompt 示例）：
     ```
     你是 WeLink 的对话助手，帮用户查询和分析他们自己的微信聊天数据。

     可用的工具：
     - 列联系人 / 群聊统计（get_contact_stats, get_groups）
     - 查某人 / 某群的深度画像（get_contact_detail, get_group_detail）
     - 情感分析、词云、关系预测等
     - 跨全局搜索消息（search_messages）

     回答时：
     - 如果涉及具体联系人，先用 search_messages 或 get_contact_stats 找到 username
     - 敏感信息（手机号 / 身份证）用户已经本地脱敏，但你不要主动问或强调具体数字
     - 结果用中文，简洁有结构
     ```

3. **Actions** 区点 "**Create new action**"：
   - **Authentication** → API Key → Custom header name `X-API-Key` → 填上面你设的 key
   - **Schema** → 粘贴 WeLink 的 OpenAPI：访问 `https://welink.yourdomain.com/api/swagger.json` 把 JSON 复制粘贴进来
   - **Privacy policy URL**（可选，公开 GPT 才需要）

4. **Save** → **Only me**（个人用）或 **Anyone with a link**（分享）

---

## 4. 测试

新开一个对话，问 GPT：

- 「我最常联系的 5 个人是谁？」
- 「我和 alice 过去三个月的情感趋势怎么样？」
- 「我在哪些群里主要活跃？」

GPT 会自动调用对应的 Action，返回的数据会自动用中文解读。

::: tip 第一次调用会弹授权
Custom GPT 首次调用 Actions 会让用户确认授权（"Allow / Deny"），授权一次后记住。
:::

---

## 原理

- ChatGPT Actions = 带 OpenAPI spec 的 function calling
- WeLink 已有 `/api/swagger.json`（80+ 端点完整描述），直接可用
- 请求走 `https://welink.yourdomain.com/api/*`，body 和 response 都是 JSON

---

## 常见问题

### Schema 太大 ChatGPT 拒绝

ChatGPT Actions 对 OpenAPI 有大小限制（~30 tokens per field × 约束）。如果粘贴 swagger.json 报错，可以：

1. 手动精简 `swagger.json`，只保留 10-15 个最常用工具的 path
2. 或拆成多个 Action（每个 GPT 最多 10 个 Action）

### GPT 说"无法访问" / 连接超时

- ChatGPT Actions 的 IP 出口**没有固定列表**，不能用防火墙 IP 白名单
- 确认公网地址可访问：浏览器打开 `https://welink.yourdomain.com/api/status` 能看到 JSON
- 确认 Auth header 配对了

### 限速 / 超时

- ChatGPT Actions 单次调用超时约 45 秒；长任务（如 AI 年报 `GET /groups/year-review`）可能返回 "timed out"
- 建议不要把重计算端点暴露给 GPT；用只读统计型工具为主

### 隐私数据泄露了怎么办

- 立即关掉 tunnel / 下线公网地址
- 改 htpasswd 密码或 API Key
- 到 https://chat.openai.com/settings → Data controls → **删除对话历史**（或请求 OpenAI 删除）

---

## 对比 Claude Code MCP

| 方式 | 数据是否出网 | 配置复杂度 | 性能 |
|---|---|---|---|
| **Claude Code CLI + MCP** | ❌ 全本地 | ⭐⭐ 简单 | ⭐⭐⭐⭐⭐ 本地直连 |
| **Claude Desktop + MCP** | ❌ 全本地 | ⭐⭐ 简单 | ⭐⭐⭐⭐⭐ |
| **ChatGPT Custom GPT** | ✅ 走公网 | ⭐⭐⭐⭐ 要暴露 + Auth | ⭐⭐ 依赖公网延迟 |

**结论**：有 Claude Code 订阅的优先 Claude 路线。ChatGPT 路线适合：
- 只有 ChatGPT Plus 订阅
- 已经把 WeLink 部署在 VPS / 家用 NAS 上公网可访问
- 家庭共享场景（给家人一个入口查自己的聊天）
