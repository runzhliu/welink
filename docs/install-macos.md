# macOS App 安装

原生 macOS App，无需 Docker、无需命令行，下载即用。

## 系统要求

- **macOS 12（Monterey）及以上**
- 64 位 Intel 或 Apple Silicon（通用二进制，单个 DMG 两种芯片都可用）

## 下载与安装

[下载 WeLink.dmg](https://github.com/runzhliu/welink/releases/latest){ .btn-download }

**安装步骤：**

1. 双击 `WeLink.dmg`，把 `WeLink.app` 拖入 `/Applications`
2. Launchpad 或双击启动

::: warning 首次打开提示「无法打开」？
WeLink 未经 Apple 公证（需 99 USD/年的开发者账号），macOS Gatekeeper 会拦截。解决方式：

**方法 A**（推荐）：右键点 `WeLink.app` → 「打开」→ 弹窗再点「打开」。**此后正常双击即可**。

**方法 B**（若右键仍被拦截）：在终端运行

```bash
xattr -cr /Applications/WeLink.app
```

清除 Gatekeeper 隔离属性，然后正常启动。

**方法 C**（从源码构建，完全避免 Gatekeeper）：见下方「从源码构建」。
:::

## 首次配置

App 启动后弹出配置向导：

- **有解密好的微信数据库** → 点「浏览」选择 `decrypted/` 目录 → 点「完成配置，开始分析」
- **没有数据，只想看效果** → 直接点「使用演示数据，开始分析」，App 会自动在 `~/Library/Application Support/WeLink/demo/` 生成阿森纳球员示例数据

数据库的解密方式见 [解密微信数据库](/install#解密微信数据库)。

## 应用数据位置

```
~/Library/Application Support/WeLink/
├── preferences.json      ← LLM key / 屏蔽名单 / 自定义 prompt / Skills 目录路径等
├── ai_analysis.db        ← Skills 和记忆提炼存储
├── demo/                 ← Demo 模式示例数据（仅首次生成）
└── logs/
    ├── welink.log        ← 后端日志
    └── frontend.log      ← 前端日志
```

Finder 里打开：在 Finder 里按 `⌘⇧G` 粘贴 `~/Library/Application Support/WeLink/`。

要完全清除 WeLink 所有状态（卸载重装/排查问题）：

```bash
rm -rf "$HOME/Library/Application Support/WeLink"
```

## 端口自定义

默认后端监听 `:8080`。一般不用改，但遇到端口冲突可以：

**A. 在设置页修改**
设置 → 基本配置 → 端口号 → 保存 → App 会提示重启

**B. 手动编辑 preferences.json**

```bash
open "$HOME/Library/Application Support/WeLink/preferences.json"
```

```json
{
  "port": "9090"
}
```

保存后重启 App。

**C. 环境变量覆盖**（临时）

```bash
PORT=9090 /Applications/WeLink.app/Contents/MacOS/WeLink
```

## 升级

新版本 DMG 直接覆盖安装即可，`preferences.json` 和 `ai_analysis.db` 会保留。

## 从源码构建

需要 Go 1.22+、Node.js 18+、Xcode Command Line Tools。

```bash
git clone https://github.com/runzhliu/welink
cd welink
make dmg
# 产出在 dist/WeLink.dmg
```

自构建的 App 用本机开发者证书签名，不会触发 Gatekeeper。

## 多账号 / 多 profile

App 支持热切换多个 `decrypted/` 目录。设置 → 数据目录 · 多账号切换 → 加新目录。切换不需要重启。

## 常见问题

### 启动后白屏或卡在 loading
查看日志 `~/Library/Application Support/WeLink/logs/welink.log` 看后端有无报错。WebView 的渲染错误可以通过 `Cmd+Opt+I` 打开开发者工具排查。

### 菜单栏没有
WeLink 是 WebView 包装，没有自定义菜单栏。所有操作都在窗口内完成。

### Apple Silicon 上能跑吗
可以。DMG 是通用二进制（Universal），Intel 和 M1/M2/M3/M4 都原生运行。

### 数据存在云盘（iCloud / OneDrive）里会有问题吗
`~/Library/Application Support/` 默认不同步 iCloud，安全。但若你手动把 `decrypted/` 放在 iCloud Drive 里，iCloud 的「优化存储」可能把文件标记为仅云端，WeLink 读不到。建议把 `decrypted/` 放在本地盘或外置 SSD。

### 如何把 App 模式数据迁移到 Docker
把 `~/Library/Application Support/WeLink/preferences.json` 拷到 Docker 的 `welink-prefs` volume 里，数据目录指到原 `decrypted/`。详见 [Docker 部署](/docker)。
