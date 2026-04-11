# 下载与安装

当前版本：**{{VERSION}}**　[查看所有版本](https://github.com/runzhliu/welink/releases)

---

## macOS App <Badge type="tip" text="推荐" />

> 系统要求：**macOS 12（Monterey）及以上**

无需 Docker、无需命令行，下载即用的原生 App。

[下载 WeLink.dmg](https://github.com/runzhliu/welink/releases/download/{{VERSION}}/WeLink.dmg){ .btn-download }

**安装步骤：**

1. 双击 `WeLink.dmg`，将 `WeLink.app` 拖入 `/Applications`
2. 双击运行

::: warning 首次打开提示「无法打开」？
macOS Gatekeeper 会拦截未经 Apple 公证的 App。右键点击 `WeLink.app` → 「打开」→ 再次点击「打开」即可。

若右键仍无效，在终端执行：
```bash
xattr -cr /Applications/WeLink.app
```
:::

**首次配置：**

App 启动后弹出配置向导：

- **有解密好的微信数据库**：点击「浏览」选择 `decrypted/` 目录，点击「完成配置，开始分析」
- **没有数据，只想看效果**：直接点击「使用演示数据，开始分析」，App 会自动生成示例数据

---

## Windows App <Badge type="tip" text="推荐" />

> 系统要求：**Windows 10 1903 及以上**（Windows 11 完全支持）

无需 Docker、无需命令行，解压即用。

[下载 WeLink-windows-amd64.zip](https://github.com/runzhliu/welink/releases/download/{{VERSION}}/WeLink-windows-amd64.zip){ .btn-download }

**安装步骤：**

1. 解压 `WeLink-windows-amd64.zip` 到任意目录
2. 双击 `WeLink.exe` 运行

::: info 提示缺少 WebView2 Runtime？
Windows 11 及安装了 Microsoft Edge 的 Windows 10 已自带，无需额外安装。若提示缺少，前往 [Microsoft 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 下载 Evergreen Bootstrapper（约 2 MB）安装后重试。
:::

**首次配置：**

启动后弹出配置向导，与 macOS 相同：
- **有数据**：选择 `decrypted\` 目录，开始分析
- **只看效果**：点击「使用演示数据，开始分析」

---

## Docker Compose

> 适合 Linux 服务器部署，或偏好容器化环境的用户

### 前提

已完成微信数据库解密，`decrypted/` 目录结构如下：

```
decrypted/
├── contact/
│   └── contact.db
└── message/
    ├── message_0.db
    ├── message_1.db
    └── ...
```

将 `decrypted/` 放在 `welink/` 仓库**内部**：

```
welink/
├── backend/
├── frontend/
├── docker-compose.yml
└── decrypted/         ← 放在这里
```

### 启动

```bash
git clone https://github.com/runzhliu/welink
cd welink
docker compose up
```

首次启动会自动拉取镜像，无需本地编译。访问 [localhost:3418](http://localhost:3418) 开始分析。

### Demo 模式（无需真实数据）

```bash
docker compose -f docker-compose.demo.yml up
```

---

## 解密微信数据库

所有部署方式（除 Demo 模式外）都需要先解密数据库。

**第一步** — 确保电脑微信处于运行状态

**第二步** — 使用 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 提取并解密：

```bash
git clone https://github.com/ylytdeng/wechat-decrypt
cd wechat-decrypt
sudo python3 main.py
# 选择 decrypt 模式
```

::: tip 推荐先同步完整聊天记录
手机微信 → 「我」→「设置」→「通用」→「聊天记录迁移与备份」→「迁移到电脑」，可获得最完整的历史数据。
:::

---

## 推荐配置

| 数据规模 | 消息量 | 推荐内存 | 首次索引时间 |
|----------|--------|----------|-------------|
| 轻量 | 50 万条以下 | 2 GB | 30 秒以内 |
| 中等 | 50–200 万条 | 4 GB | 1–3 分钟 |
| 重度 | 200 万条以上 | 8 GB+ | 3–10 分钟 |

首次使用建议先选「近 6 个月」体验，确认无误后再切换到「全部数据」。
