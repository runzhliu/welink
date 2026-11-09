# WeLink DSH 插件

将 WeLink 作为 DeepSeek Harness 的只读工具接入。此版本提供按需查询，不自动创建任务、发送消息或启动 Super Agent Source。插件代码遵循本仓库的 AGPL-3.0 许可。

## 能力

| 工具 | 作用 | 前提 |
| --- | --- | --- |
| `welink_conversations` | 列出配置允许的联系人或群聊 ID | 无网络请求 |
| `welink_active_dates` | 查看指定会话中最近有记录的日期 | 会话在白名单中 |
| `welink_day_messages` | 查询指定会话某一天的消息 | 白名单中，且开启原文访问 |
| `welink_search_messages` | 在指定会话内搜索文字 | 白名单中，且开启原文访问 |

会话 ID 使用 WeLink 的 `username`，不是备注名；群聊通常以 `@chatroom` 结尾。返回值包括会话、日期、时间、发言方向、内容和截断标记，日期加时间并非全局唯一消息 ID。工具使用 `offset` / `next_offset` 分页，`has_more` 表示还有未返回的数据。默认每页最多 30 条、每条最多 500 个 Unicode 字符；后端先截断再返回。原文访问默认关闭，白名单默认为空。

需要包含 `/api/agent/query` 的 WeLink 后端版本。插件通过该接口查询，账户、日期和关键词放在请求体中，不放入 URL；WeLink 默认 HTTP 访问日志不记录请求体。后端仍会在本机执行搜索并读取对应会话，截断限制的是返回给插件的数据。

## 安装到本机 DSH

需要 Node.js 24.9 或更高，以及 DSH 0.2.2 系列（已在 `0.2.2-rc.1` 容器用合成数据验证）。本机如果是更早版本的 DSH，请先使用兼容版本；不要用本机 CLI 的版本推断独立容器的版本。

在仓库根目录运行：

```sh
cd plugins/dsh-welink
npm ci
npm test
npm pack --pack-destination /tmp
# 按需要改成 headless、tui 或自己的 profile
# 路径以 npm pack 打印的文件名为准
dsh plugin --profile web add /tmp/runzhliu-dsh-welink-0.1.0.tgz
```

首次安装和 `dsh plugin add` 需要访问 npm registry 安装依赖。该包尚未发布到 npm；这里安装的是本地打包文件。安装后启动或重启对应 DSH 实例，并在**启动 DSH 的环境**中设置：

```sh
# 默认是 WeLink Docker Compose 发布在宿主机回环地址的 8088 端口
export WELINK_URL='http://127.0.0.1:8088'
# 示例是假 ID；换成你明确允许查询的 ID
export WELINK_ALLOWED_CONVERSATIONS='["synthetic-contact","synthetic@chatroom"]'
# 默认关闭。仅在需要读取原文时设置为 1
export WELINK_ALLOW_MESSAGES=1

dsh web --no-open
```

授权配置必须是 JSON 字符串数组，空数组代表无授权。启动后可以询问“列出已授权会话”“这个会话有哪些聊天日期”或“搜索这个会话中提到旅行的内容”。检索前提是 WeLink 已完成索引；当列表被截断时可以继续指定 `next_offset`。

Agent 查询需要独立的只读令牌，即使从本机回环连接也必须提供；普通移动配对令牌不能用于该接口。将令牌存为仅 DSH 运行用户可读的文件，使用 `WELINK_TOKEN_FILE` 或插件的 `tokenFile` 配置指定**绝对路径**（插件配置优先）。不要把令牌本身写进配置、命令历史或镜像。插件每次请求读取文件，支持轮换。

## 独立 DSH / Super Agent 容器

插件也能作为 DSH Web profile 的原生工具安装到独立的 Super Agent 实例；它不依赖 Super Agent 原型，也不注册事件 Source。不要挂载 `decrypted/`、个人 home 或 Docker socket：DSH 只需访问 WeLink 的受控 API。需要先在目标容器或镜像中安装该插件，再把上述环境变量配置到该实例。容器内的 `127.0.0.1` 是容器自身，不能默认代表宿主机。

优先通过本机安全隧道或正确配置 TLS 的 HTTPS 地址访问 WeLink。对于**同机、可信的私有 Docker 网络**，如果确需直接使用明文 HTTP，必须同时指定精确主机名白名单和凭据文件，例如：

```sh
WELINK_URL=http://welink-backend:8080
WELINK_ALLOWED_HTTP_HOSTS='["welink-backend"]'
WELINK_TOKEN_FILE=/run/secrets/welink-agent-token
```

还需要将双方接入同一个私有网络，并在 WeLink 配置 Agent 授权策略。这个例子不创建网络或暴露端口；它取决于你的容器部署。HTTP 仍是明文，token 和聊天内容会经过该网络，不能用于不可信网络。插件拒绝未列出的非回环 HTTP 地址和 HTTP 重定向。

对于标准容器布局，可以在仓库根目录运行以下命令，为一个明确指定的 username 创建 30 天有效的凭据；脚本不会显示令牌，且不会覆盖已有授权策略：

```sh
bash plugins/dsh-welink/authorize-container.sh welink-backend <DSH容器名> <允许的username>
```

脚本将令牌写入 DSH 的 `/home/node/.dsh/secrets/welink-agent-token`，将令牌摘要、允许的会话与操作、有效期写入后端 `/app/prefs/agent-access.json`。后端每次请求检查策略；撤销时移除该策略文件并删除 DSH 中对应的令牌文件。当前策略只支持一个令牌，重新授权前需要安全撤销旧策略。容器重建时还需通过部署文件重新加入 WeLink 私有网络；可参考 [Compose 网络覆盖文件](compose.welink.example.yml)，按实际服务名和网络名调整后，在启动 DSH 时作为额外 `-f` 参数传入。应用 Compose 变更可能重建容器，请先确认 DSH 数据卷已配置。

## 数据与权限边界

- 插件只注册上述查询工具，不主动查询、写入、发送或自行保存聊天记录；允许的 ID 和是否开放原文由配置明确决定。
- Agent 接口在后端独立校验令牌、有效期、会话及操作，不能使用普通移动配对令牌访问。若 Agent 另有普通配对令牌、数据库或其他更高权限，仍可能绕过此限制；应隔离工作区并控制网络和凭据。
- `maxItems`、`maxContentChars`、`maxResponseBytes`、`timeoutMs` 可通过 DSH 插件配置调整，分别默认为 30、500、2 MiB、15 秒。后端上限是每页 100 条、每条 2000 字符。
- DSH 可能持久化工具结果、会话或 Agent 生成的文件；使用远程模型时，返回给模型的内容会发送给所选服务。需要非持久化时，应在部署层使用可验证的临时会话与存储策略；本插件本身不能保证 DSH 或模型服务不留存。
- 聊天记录是第三方不可信内容；插件附带提示，要求 Agent 不把其中的指令当成自己的操作指令。这只是辅助提示，不代替执行器隔离和权限控制。

### 网页首次访问

配对启用后，Docker 前端到后端不是 TCP 回环连接。网页首次访问时需输入已有移动配对令牌；网页会在验证成功后将令牌保存在当前浏览器。`Origin` 和 `Referer` 不再作为认证凭据。本机 SFT 进程管理接口只接受后端的 TCP 回环请求，Docker 前端与远程设备不能以伪造来源绕过这一限制；远程训练请使用工作台的 Worker 配对流程。

在运行 WeLink 的电脑上，可在 Compose 项目目录执行以下命令，通过容器内回环接口查看已有的移动配对令牌（这是完整访问凭据，请勿截图、分享或提交）：

```bash
docker compose exec backend wget -qO- http://127.0.0.1:8080/api/app/pairing/status
```

将输出 JSON 中的 `token` 填入网页；该命令不会更换令牌，也不会输出其他应用设置。如果 Compose 服务名不是 `backend`，请替换为实际名称。

Docker 前端使用 SFT 工作台前需要先启用配对：若状态返回 `enabled: false`，可以在运行 WeLink 的电脑上执行下面的命令，再使用返回的 `token` 连接网页。**仅在尚未启用时执行**，否则会更换令牌并使已配对设备失效：

```bash
docker compose exec backend wget -qO- --post-data='' http://127.0.0.1:8080/api/app/pairing/enable
```

启用配对后，Docker 网页可以使用需要认证的 SFT 工作台和远程 Worker。直接管理后端所在机器的本地 SFT 进程仍需要从后端容器内的回环地址访问；Docker 网页不具备该权限。

## 验证

```sh
npm test
# 可选：需 Docker 和已缓存或可拉取的 DSH 0.2.2-rc.1 Super Agent 镜像
./tests/smoke-dsh.sh
```

容器 smoke 测试使用隔离的临时 DSH_HOME、虚构数据和容器内 mock 后端，禁用外部网络，不连接现有 DSH 实例或真实 WeLink 数据。可用 `DSH_TEST_IMAGE` 指定兼容的本地测试镜像。Super Agent 特定的 Source、Router / Worker 权限继承和事件自动化尚未在此版本验收。
