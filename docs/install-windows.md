# Windows App 安装

原生 Windows App（内嵌 WebView2），无需 Docker、无需命令行，解压即用。

## 系统要求

- **Windows 10 1903（19H1）及以上** / Windows 11 完全支持
- 64 位（amd64）
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) —— Windows 11 和大多数 Windows 10 已预装

## 下载与安装

[下载 WeLink-windows-amd64.zip](https://github.com/runzhliu/welink/releases/latest){ .btn-download }

**安装步骤：**

1. 解压 `WeLink-windows-amd64.zip` 到任意目录（建议 `C:\Program Files\WeLink\` 或用户目录下）
2. 双击 `WeLink.exe` 启动

::: warning Windows SmartScreen 拦截「已保护你的电脑」？
WeLink 没有购买代码签名证书，首次启动会被 SmartScreen 警告。

**放行方式：**点击提示弹窗里的「**更多信息**」 → 「**仍要运行**」即可，此后不再提示。

或者右键 `WeLink.exe` → **属性** → 底部勾选「**解除锁定**（Unblock）」→ 确定。
:::

::: info 提示缺少 WebView2 Runtime？
Windows 11 和装了新版 Microsoft Edge 的 Windows 10 都已自带。若真的缺失：

1. 从 [Microsoft 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 下载「**Evergreen Bootstrapper**」（约 2 MB）
2. 双击运行，自动联网安装 Runtime
3. 再次启动 WeLink
:::

## 首次配置

App 启动后弹出配置向导：

- **有解密好的微信数据库** → 点「浏览」选择 `decrypted\` 目录 → 点「完成配置，开始分析」
- **没有数据，只想看效果** → 直接点「使用演示数据，开始分析」，App 会自动在 `%APPDATA%\WeLink\demo\` 生成阿森纳球员示例数据

数据库的解密方式见 [解密微信数据库](/install#解密微信数据库)。

## 应用数据位置

```
%APPDATA%\WeLink\
├── preferences.json      ← LLM key / 屏蔽名单 / 自定义 prompt / Skills 目录路径等
├── ai_analysis.db        ← Skills 和记忆提炼存储
├── demo\                 ← Demo 模式示例数据（仅首次生成）
└── logs\
    ├── welink.log        ← 后端日志
    └── frontend.log      ← 前端日志
```

`%APPDATA%` 默认是 `C:\Users\<你的用户名>\AppData\Roaming`。

文件资源管理器里打开：按 `Win+R` → 输入 `%APPDATA%\WeLink` → 回车。

要完全清除 WeLink 所有状态（卸载重装 / 排查问题），在 PowerShell 里：

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\WeLink"
```

## 端口自定义

默认后端监听 `:8080`。一般不用改，但遇到端口冲突可以：

**A. 在设置页修改**
设置 → 基本配置 → 端口号 → 保存 → App 会提示重启

**B. 手动编辑 preferences.json**

用记事本打开 `%APPDATA%\WeLink\preferences.json`：

```json
{
  "port": "9090"
}
```

保存后重启 App。

**C. 环境变量覆盖**（临时）

```powershell
$env:PORT=9090; & "C:\Program Files\WeLink\WeLink.exe"
```

## 升级

下载新版本 ZIP → 解压覆盖原目录即可，`%APPDATA%\WeLink\` 里的配置和数据会保留。

## 从源码构建

需要 Go 1.22+、Node.js 18+、[TDM-GCC](https://jmeubank.github.io/tdm-gcc/) 或其他 MinGW 工具链。

```powershell
git clone https://github.com/runzhliu/welink
cd welink
make exe
# 产出在 dist\WeLink-windows-amd64\
```

## 多账号 / 多 profile

App 支持热切换多个 `decrypted\` 目录。设置 → 数据目录 · 多账号切换 → 加新目录。切换不需要重启。

## 常见问题

### 启动后白屏或卡在 loading
查看日志 `%APPDATA%\WeLink\logs\welink.log`。WebView 渲染错误可按 `Ctrl+Shift+I` 打开开发者工具。

### WebView2 Runtime 已装但仍报错
运行命令检查版本：`reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients"`。版本过旧可以卸载重装最新 Evergreen Bootstrapper。

### 防火墙弹窗
第一次启动 Windows Defender 防火墙可能询问是否允许网络访问。选「允许」或「仅专用网络」都可以 —— WeLink 只在本机 `127.0.0.1:8080` 提供服务，不对外开端口。

### 路径含中文 / 空格
完全支持。`decrypted\` 可以放在 `C:\Users\张三\Desktop\` 这种路径。

### 数据存在 OneDrive 文件夹里会有问题吗
不建议。OneDrive 的「按需下载」可能让文件被标记为仅云端，WeLink 读不到。建议把 `decrypted\` 放在本地盘。`%APPDATA%\WeLink\` 默认不同步 OneDrive，安全。

### 如何把 App 模式数据迁移到 Docker
把 `%APPDATA%\WeLink\preferences.json` 拷到 Docker 的 `welink-prefs` volume 里，数据目录指到原 `decrypted\`。详见 [Docker 部署](/docker)。
