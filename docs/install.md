# 下载与安装

当前版本：**{{VERSION}}**　[查看所有版本](https://github.com/runzhliu/welink/releases)

WeLink 提供三种部署方式，按你的场景选：

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:24px 0;">

<a href="/install-macos" style="text-decoration:none;border:1px solid var(--vp-c-divider);border-radius:12px;padding:20px;background:var(--vp-c-bg-soft);color:inherit;display:block;">
  <div style="font-size:28px;margin-bottom:8px;">🍎</div>
  <div style="font-size:16px;font-weight:800;margin-bottom:6px;">macOS App <Badge type="tip" text="推荐" /></div>
  <div style="font-size:13px;color:var(--vp-c-text-2);line-height:1.6;">原生 DMG，双击即用。macOS 12+。内嵌 WebView，无需 Docker、无需命令行。</div>
</a>

<a href="/install-windows" style="text-decoration:none;border:1px solid var(--vp-c-divider);border-radius:12px;padding:20px;background:var(--vp-c-bg-soft);color:inherit;display:block;">
  <div style="font-size:28px;margin-bottom:8px;">🪟</div>
  <div style="font-size:16px;font-weight:800;margin-bottom:6px;">Windows App <Badge type="tip" text="推荐" /></div>
  <div style="font-size:13px;color:var(--vp-c-text-2);line-height:1.6;">原生 EXE（内嵌 WebView2），解压即用。Windows 10 1903+。</div>
</a>

<a href="/docker" style="text-decoration:none;border:1px solid var(--vp-c-divider);border-radius:12px;padding:20px;background:var(--vp-c-bg-soft);color:inherit;display:block;">
  <div style="font-size:28px;margin-bottom:8px;">🐳</div>
  <div style="font-size:16px;font-weight:800;margin-bottom:6px;">Docker Compose</div>
  <div style="font-size:13px;color:var(--vp-c-text-2);line-height:1.6;">Linux 服务器 / 容器化环境。支持反代 / HTTPS / 多 profile。</div>
</a>

</div>

---

## 快速试用（无需数据）

想先感受下 WeLink 的交互和分析能力，不用真实聊天数据？

**macOS / Windows App**：首次启动配置向导里点「使用演示数据，开始分析」。

**Docker**：

```bash
docker compose -f docker-compose.demo.yml up
```

或直接访问在线 Demo：[https://demo.welink.click](https://demo.welink.click)

Demo 数据以阿森纳 2025/26 赛季一线队球员与教练组为联系人，消息内容充满更衣室气息。**COYG！** 🔴⚪

---

## 解密微信数据库

所有部署方式（除 Demo 模式外）都需要先把手机上的聊天记录解密到 `decrypted/` 目录。

**第一步** — 手机微信 → 「我」→「设置」→「通用」→「聊天记录迁移与备份」→「迁移到电脑」，把完整历史迁到电脑。迁移过程中保持电脑微信处于登录状态。

**第二步** — 使用 [wechat-decrypt](https://github.com/ylytdeng/wechat-decrypt) 提取并解密：

```bash
git clone https://github.com/ylytdeng/wechat-decrypt
cd wechat-decrypt
sudo python3 main.py
# 选择 decrypt 模式
```

解密完成后得到如下目录结构：

```
decrypted/
├── contact/
│   └── contact.db
└── message/
    ├── message_0.db
    ├── message_1.db
    └── ...
```

::: tip 数据安全
解密后的数据库文件包含你的所有聊天记录，请妥善保管。WeLink 所有分析都在本地进行，不会上传任何服务器。
:::

---

## 推荐配置

| 数据规模 | 消息量 | 推荐内存 | 首次索引时间 |
|----------|--------|----------|-------------|
| 轻量 | 50 万条以下 | 2 GB | 30 秒以内 |
| 中等 | 50–200 万条 | 4 GB | 1–3 分钟 |
| 重度 | 200 万条以上 | 8 GB+ | 3–10 分钟 |

首次使用建议先选「近 6 个月」体验，确认无误后再切换到「全部数据」。

---

## 下一步

- [使用技巧](/ux)：命令面板、多账号切换、AI 数据备份等
- [Docker 部署](/docker)：反代、HTTPS、多 profile、K8s 等生产部署
- [AI 分身](/ai-clone)：让 AI 学习某人的聊天风格模拟对话
- [MCP Server](/mcp-server)：在 Claude Code 里用中文直接查微信数据
