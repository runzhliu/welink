# Docker 部署

适合 Linux 服务器部署 / 偏好容器化 / 需要反代接入 HTTPS 的场景。macOS / Windows 用户推荐直接用 [原生 App](/install)，免 Docker、省资源。

## 快速开始

```bash
git clone https://github.com/runzhliu/welink
cd welink
# 把解密好的 decrypted/ 放在仓库根目录
docker compose up
```

浏览器打开 [http://localhost:3418](http://localhost:3418) 即可使用。

首次启动会自动从 [GitHub Container Registry](https://github.com/runzhliu/welink/pkgs/container/welink%2Fbackend) 拉镜像，无需本地编译。

## 仓库目录布局

```
welink/
├── docker-compose.yml        ← 默认 Compose 文件
├── docker-compose.demo.yml   ← Demo 模式 Compose（不需要数据）
├── backend/
├── frontend/
└── decrypted/                ← 你放在这里的微信解密数据
    ├── contact/
    │   └── contact.db
    └── message/
        ├── message_0.db
        └── message_1.db
```

`decrypted/` 的获取方式参见 [解密微信数据库](/install#解密微信数据库)。

## 服务拓扑

默认 `docker-compose.yml` 起两个容器：

| 服务 | 镜像 | 作用 | 对外端口 |
|---|---|---|---|
| `backend` | `ghcr.io/runzhliu/welink/backend:main` | Go 后端 API，监听 `:8080` | `127.0.0.1:8080`（仅本机，前端容器内部走 Docker 网络访问） |
| `frontend` | `ghcr.io/runzhliu/welink/frontend:main` | Nginx + 静态页 + 反代到 backend | `0.0.0.0:3418 → 80` |

前端容器内置 Nginx 会把 `/api/*` 请求反代到 `backend:8080`。浏览器只访问 `3418`，后端不暴露给公网。

## 镜像版本选择

镜像 tag 约定：

| Tag | 含义 | 推荐场景 |
|---|---|---|
| `main` | `main` 分支最新自动构建 | 尝鲜 / 开发 |
| `latest` | 最近一次 release tag | **生产推荐** |
| `v0.1.2` 等具体版本 | 指定版本锁定 | 生产 + 可回滚 |

切换到 `latest` 版本：

```yaml
# docker-compose.yml
services:
  backend:
    image: ghcr.io/runzhliu/welink/backend:latest  # ← 改这里
  frontend:
    image: ghcr.io/runzhliu/welink/frontend:latest # ← 改这里
```

然后：

```bash
docker compose pull   # 拉新镜像
docker compose up -d  # 重启
```

## 环境变量

后端容器支持的环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 后端监听端口（容器内） |
| `GIN_MODE` | `release`（Dockerfile 默认） | `release` / `debug` / `test` |
| `DATA_DIR` | `/app/data`（Dockerfile 默认） | 微信解密数据根目录，需包含 `contact/` 和 `message/` |
| `WELINK_DATA_DIR` | — | 备用数据目录探测路径（优先级低于 `DATA_DIR`） |
| `PREFERENCES_PATH` | `/app/prefs/preferences.json`（compose 默认） | 配置文件绝对路径，用于持久化 LLM key / 屏蔽名单 / 自定义 prompt 等 |
| `DEMO_MODE` | — | 填 `true` 启 Demo 模式，自动生成阿森纳球员示例数据 |
| `DEMO_DISABLE_AI` | — | Demo 模式下额外禁用 AI（省 token） |
| `WELINK_LISTEN_LAN` | `1`（Dockerfile 默认） | 填 `1` 时监听 `0.0.0.0`，否则仅 `127.0.0.1`。容器内必须 `1` 才能接收端口映射流量；宿主机层面通过 compose 的 `127.0.0.1:8080:8080` 限制暴露范围。 |
| `WELINK_PUBLIC_URL` | — | 反代场景下显式指定公网 base URL（如 `https://welink.example.com`），用于构造 Google Drive / OneDrive OAuth 回调地址。**不设置时默认用 `http://127.0.0.1:<PORT>`**，反代部署时不设就会拿不到 token。不再读取 `X-Forwarded-*` 请求头以避免伪造。 |

在 Compose 文件里覆盖：

```yaml
backend:
  environment:
    - PORT=8080
    - GIN_MODE=release
    - DATA_DIR=/app/data
    - PREFERENCES_PATH=/app/prefs/preferences.json
    # 通过环境变量注入 LLM API key，避免明文落盘
    - LLM_API_KEY_OVERRIDE=sk-xxx
```

::: tip LLM API Key 的安全做法
不建议把 OpenAI/DeepSeek/Claude 等 key 明文写到 `preferences.json`。推荐流程：
1. 在 Compose 里通过 `environment` 或 `.env` 注入
2. 应用启动后在设置页粘贴一次，后端会写入 `preferences.json`
3. 设置页 GET 时返回 `__HAS_KEY__` 占位符，PUT 时遇到占位符保留旧值 —— 不会被刷成空字符串
:::

## Volume 映射

默认有两个挂载点：

| 容器内路径 | Compose 映射 | 作用 | 持久化建议 |
|---|---|---|---|
| `/app/data` | `./decrypted:/app/data` | 微信解密数据（只读常规） | 放在仓库里即可，也可以改成 NAS / 其他路径 |
| `/app/prefs` | `welink-prefs:/app/prefs` | `preferences.json` 持久化配置（含 LLM key / 屏蔽名单 / 索引时间范围 `default_init_from/to`，丢失会导致容器重启后回到 WelcomePage） | 用 named volume 或换成绑定挂载 |

### decrypted 放其他路径

NAS 或独立数据盘场景：

```yaml
backend:
  volumes:
    - /mnt/nas/wechat-decrypted:/app/data
    - welink-prefs:/app/prefs
```

也可以只读挂载（更安全）：

```yaml
    - /mnt/nas/wechat-decrypted:/app/data:ro
```

### preferences.json 换成绑定挂载

便于直接编辑或备份到 Git：

```yaml
backend:
  volumes:
    - ./decrypted:/app/data
    - ./welink-config:/app/prefs
```

## 端口自定义

### 改前端暴露端口

`docker-compose.yml`：

```yaml
frontend:
  ports:
    - "5000:80"   # 3418 → 5000
```

浏览器改用 [http://localhost:5000](http://localhost:5000)。

### 改后端端口

一般没必要改（因为前端走 Docker 网络访问后端，不经过宿主机端口）。若真要改：

```yaml
backend:
  environment:
    - PORT=9090
  ports:
    - "127.0.0.1:9090:9090"
frontend:
  environment:
    - BACKEND_URL=http://backend:9090  # 告诉前端 Nginx 反代到新端口
```

## 反向代理 / HTTPS

生产部署推荐用 Nginx / Caddy / Traefik 反代 + Let's Encrypt 证书，这样浏览器能走 `https://welink.yourdomain.com`。

### Nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name welink.example.com;

    ssl_certificate     /etc/letsencrypt/live/welink.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/welink.example.com/privkey.pem;

    # WebSocket + SSE 需要
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
    proxy_read_timeout 600s;  # AI 长任务

    location / {
        proxy_pass http://127.0.0.1:3418;
    }
}
```

同时建议把 Compose 里 frontend 的端口限定在本机：

```yaml
frontend:
  ports:
    - "127.0.0.1:3418:80"
```

### Caddy（更简单）

```caddy
welink.example.com {
    reverse_proxy 127.0.0.1:3418
}
```

Caddy 会自动申请和续签 HTTPS 证书。

::: warning 部署后端的风险提示
WeLink 是 **单用户个人分析工具**，没有账号体系 / 登录鉴权。暴露到公网意味着任何人拿到域名就能看你的微信数据。

推荐的几种保护：
1. 反代上加 **HTTP Basic Auth**（Nginx `auth_basic`）
2. 反代前加 Cloudflare Access / Zero Trust
3. 仅在 VPN / Tailscale / Wireguard 内网访问
:::

## 升级流程

```bash
cd welink
git pull                 # 如果改了 compose
docker compose pull      # 拉最新镜像
docker compose up -d     # 重启（旧容器自动替换）
docker image prune -f    # 清理旧镜像（可选）
```

首次会保留 `welink-prefs` volume（你之前的 LLM key / 屏蔽名单 / 自定义 prompt 等），所以升级不会丢配置。

## 日志

```bash
# 实时跟踪
docker compose logs -f backend
docker compose logs -f frontend

# 最近 100 行
docker compose logs --tail=100 backend
```

让后端日志在宿主机落盘便于归档：

```yaml
backend:
  volumes:
    - ./decrypted:/app/data
    - welink-prefs:/app/prefs
    - ./logs:/app/logs   # 增加这一行
  environment:
    - LOG_PATH=/app/logs/welink.log  # 后端会写这里（如未来版本支持）
```

或者用 Compose 自带的日志驱动：

```yaml
backend:
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
```

## 健康检查

给 backend 加一个 `healthcheck`，让 Compose 自动重启异常容器：

```yaml
backend:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8080/api/status"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 60s  # 首次索引可能较慢，给够启动时间
```

## docker-compose.override.yml 推荐模板

Compose 会自动合并同目录下的 `docker-compose.override.yml`。用这个文件存你的本地/生产定制，**不要改 `docker-compose.yml`**，方便 `git pull` 升级。

```yaml
# docker-compose.override.yml
services:
  backend:
    volumes:
      # 用 NAS 数据
      - /mnt/nas/wechat-decrypted:/app/data:ro
      - ./welink-config:/app/prefs
    environment:
      - GIN_MODE=release
      - DEMO_DISABLE_AI=false
  frontend:
    ports:
      # 改端口
      - "127.0.0.1:3418:80"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 多账号 / 多 profile 部署

WeLink 支持在设置页切换多个 `decrypted/` profile。Docker 部署推荐把每个 profile 挂成独立子目录：

```
welink-data/
├── me-2024/
│   ├── contact/
│   └── message/
├── me-2025/
│   ├── contact/
│   └── message/
└── spouse/
    ├── contact/
    └── message/
```

Compose 挂载**父目录**：

```yaml
backend:
  volumes:
    - ./welink-data:/app/data-profiles
  environment:
    # 让 welink 扫父目录下所有子目录作为 profile
    - DATA_DIR=/app/data-profiles/me-2025  # 主 profile
```

在设置页「数据目录 · 多账号切换」里加 `/app/data-profiles/me-2024` 等路径，热切换即可，不需要重启容器。

## Demo 模式（无需真实数据）

```bash
docker compose -f docker-compose.demo.yml up
```

或等效写法：

```yaml
services:
  backend:
    image: ghcr.io/runzhliu/welink/backend:main
    environment:
      - DEMO_MODE=true
      # - DEMO_DISABLE_AI=true  # 若想禁掉所有 AI 调用
```

Demo 数据以阿森纳 2025/26 赛季球员和教练组为联系人，消息内容偏更衣室气息。**COYG！** 🔴⚪

## 常见问题

### 容器起来了但 `localhost:3418` 打不开
- 先 `docker compose ps` 看两个容器是否都是 `running`
- `docker compose logs frontend` 看 Nginx 是否报错
- 宿主机防火墙（Linux 下 `ufw` / `firewalld`）可能拦截了 3418，开放下：`sudo ufw allow 3418`

### 首页显示"找不到数据目录"
- 确认 `decrypted/` 里有 `contact/contact.db` 和至少一个 `message/message_*.db`
- 检查 Compose 挂载：`docker compose exec backend ls -la /app/data/`
- 若路径正确但仍失败，看 `docker compose logs backend` 有没有权限错误

### 权限错误 `permission denied`
Alpine 镜像里跑 `welink` 用户（UID 1001）。若 `decrypted/` 在 NAS 上，确保 NAS 权限对 UID 1001 可读。或在 Compose 里声明 user：

```yaml
backend:
  user: "${UID:-1000}:${GID:-1000}"
```

然后 `UID=$(id -u) GID=$(id -g) docker compose up`。

### LLM API 调用从容器内超时
检查容器是否能出网：`docker compose exec backend wget -qO- https://api.openai.com`。国内通常需要配 HTTP proxy：

```yaml
backend:
  environment:
    - HTTPS_PROXY=http://host.docker.internal:7890
    - HTTP_PROXY=http://host.docker.internal:7890
    - NO_PROXY=localhost,127.0.0.1,backend
```

（Linux 上 `host.docker.internal` 默认不可用，可以改成宿主机 IP 或在 Compose 里 `extra_hosts: - "host.docker.internal:host-gateway"`）

### 升级后配置丢失
大概率是 named volume 被删。确保你没跑过 `docker compose down -v`（`-v` 会删 volumes）。正确升级用 `docker compose pull && docker compose up -d`，不要加 `-v`。

---

需要把 WeLink 接入 K8s / Swarm 等编排系统，或需要其他未覆盖的部署姿势，欢迎到 [GitHub Issues](https://github.com/runzhliu/welink/issues) 提。
