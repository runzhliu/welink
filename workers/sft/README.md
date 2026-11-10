# WeLink SFT worker

独立于浏览器和 Go 服务的训练组件。首版执行器是 Apple Silicon / Metal 的 `mlx-lm==0.32.2` 和 Linux / NVIDIA 的 `llamafactory==0.9.5`。两者通过同一套配对、租约、事件与产物协议接入 `#/sft`。

Mac MLX 与 CUDA L20 的合成数据测试范围见 [SFT 测试记录](../../docs/sft-release-checklist.md)；实际效果取决于模型、数据与训练环境。

## 安装与配对

使用 Python 3.12。Mac 需要原生 arm64 Python、macOS 14 或更新版本；Rosetta、Intel Mac 和 Docker 容器不能作为 Metal 训练环境。CUDA 锁文件针对 Linux x86_64，驱动需要兼容锁定的 PyTorch wheel；其他 CUDA / 架构组合需另做锁定与验收。

在仓库根目录执行，模型和私聊数据均不需要放入仓库：

```sh
python3.12 -m venv ~/.local/share/welink-sft/venv
# Mac；GPU 机器改为 requirements-cuda.lock：
~/.local/share/welink-sft/venv/bin/pip install --require-hashes -r workers/sft/requirements-mlx.lock
~/.local/share/welink-sft/venv/bin/pip install ./workers/sft
~/.local/share/welink-sft/venv/bin/welink-sft doctor
```

`doctor` 只探测设备与依赖，不下载模型。完整依赖锁文件生成目标为 CPython 3.12 / macOS arm64、CPython 3.12 / Linux x86_64；引擎能力仍需两步真实训练预检，不能仅凭依赖已安装判断模型可运行。

在工作台创建项目，打开“环境管理”生成 10 分钟有效的一次性配对码：

```sh
~/.local/share/welink-sft/venv/bin/welink-sft pair --server http://127.0.0.1:8080 --name '我的 Mac'
# 按提示输入配对码，凭据不写入命令行参数或 URL。
~/.local/share/welink-sft/venv/bin/welink-sft run
```

默认目录 `~/.local/share/welink-sft`；可在命令前用 `--root /独立目录` 指定另一安装。配对凭据、日志、样本和检查点仅在该目录保存，敏感文件权限为 0600。一个 worker 只授权给一个数据账号的一个项目。换项目时先停止任务与服务、撤销原授权，再用新的目录配对。

同一用户、同一台机器的 WeLink 引擎共享进程级设备锁；即使有多个安装目录，原训练或推理进程未退出也不能再次占用设备。首版采用保守的单设备域，不启用多卡并发。

可用 launchd / systemd 托管 `run`，使用同一用户、同一个 `--root`。`run` 不依赖浏览器生命周期。不要把凭据写入服务启动参数。升级依赖前先停止任务和推理服务。

## 远程连接与 Docker

远程 worker 必须使用 HTTPS。HTTP 只允许原生 Go 控制端确实收到的 TCP loopback 连接；Docker 端口映射后的来源通常不是 loopback，也需要 HTTPS。worker 不需要暴露 SSH、推理端口或通用 shell，推理服务仅监听训练机 `127.0.0.1`，由已认证的控制通道转发。

若 TLS 在反向代理终止，将 `/api/sft-worker/` **直接**转发至 Go 后端，并覆盖 `X-Forwarded-Proto` 为代理自身的 `$scheme`。后端 `WELINK_SFT_TLS_PROXY` 只能设置为该 TLS 终止代理的精确 TCP IP，不能填任意客户端地址。只信任头、不限制实际代理来源的配置会破坏传输校验。

开发环境 `dev-nginx.conf` 已包含直接转发路由；启动 `docker-compose.dev.yml` 时显式提供 `WELINK_SFT_TLS_PROXY`。代理容器 IP 变化后需同步配置。普通前端 HTTP Nginx 会覆盖转发协议，不能充当可信 TLS 终止点。不自动开放公网端口、绕过证书校验或向 worker 提供 WeLink 通用访问凭据。

远程浏览器访问工作台需先启用 WeLink 配对鉴权；worker 使用自己的项目凭据。设置过 PIN 的实例还需在工作台验证 PIN，得到 30 分钟会话；更换 PIN 会使原会话失效。

## 训练语义

- 选择精确 Hugging Face commit，不接受 `main` 或网页任意命令；只下载 safetensors / tokenizer 等模型文件，不信任远程 Python 代码。需登录的模型先在训练机自行配置 Hugging Face 凭据。
- 冻结数据按完整会话、共享源消息、重复簇分组切分。导入数据缺少可信原始时间和 ID，按导入顺序及相同问题 / 历史轮次保守分组，不宣称外部来源已经过真实性核对。
- 两种引擎都只监督最终本人回复。长度超限优先裁掉最早历史，最终回复仍放不下则排除。预检校验实际 token labels、有效样本门槛并运行两次 optimizer updates。
- MLX iterations 是 micro steps；界面同时保留 optimizer step。标准训练受 1 epoch、step 和时间预算限制。MLX 保存验证最优权重作为推理 adapter，保留最新权重；验证最优可能是初始状态，不能据“训练完成”推断效果改善。
- GPU 保留完整训练检查点，只有存在 optimizer、scheduler、RNG、trainer state 和 adapter 的完整包才标记 `full_state`。MLX 默认只提供 `weights_only`，重新建立优化器，不能称为原进度恢复。
- 停止只有在实际保存与退出后才确认；保存超过 120 秒会终止本任务进程，保留此前有效检查点。本机组件失联宽限 30 秒，远程 600 秒；超过宽限或任务预算后保存并停止。
- 原始 stdout 只写机器本地日志。指标通过固定版本 Python callback 进入结构化事件；没有真实计数就没有训练百分比。
- 评测先运行基础模型、释放资源，再运行微调模型，使用相同测试问题、解码参数和种子。目标真实回复只用于离线 loss / 参考，不进入生成 prompt。默认不向外部 judge API 发送私聊。
- Adapter 包不含原始数据和优化器；恢复包单独保留。MLX adapter、PEFT、GGUF 不互相冒充，首版不提供未经验证的通用 GGUF 转换。

## 状态与恢复

`daemon.json`、`process.json`、`engine-events.jsonl`、`result.json` 是 attempt 的本地执行记录。控制端保留数据库租约；worker 重连使用同一 attempt / fence，不会重新领取仍在执行的训练。事件先写本地 outbox，丢失回执后重发相同 seq；大文件用偏移与 SHA-256 校验恢复传输。心跳独立于文件传输，慢上传不会阻断停止请求。

停止整个 Mac App 会持久化本机停止请求；远程任务按离线宽限处理。不要手动删除仍在运行的 worker 根目录或复用别人的进程 PID。执行记录丢失时控制端明确失败并等待人工核对，不自动启动另一份训练。

控制端数据在 preferences 所在目录的 `sft-data/`，包括独立 `sft.db`、冻结 JSONL 和已完成上传的产物。清理页面只删除确认清单中的、无后续引用的失败 / 停止任务文件，不清理训练机上的共享模型缓存。

大于 256 MB 的产物由工作台提供 `welink-sft download --id … --sha256 … --output …` 命令，在所属训练机流式下载与续传；命令使用本机已有凭据，不把密钥放入 URL 或参数。浏览器下载只处理有界的小文件。

## 自动化验证

```sh
cd backend && go test -race -timeout 90s ./...
# 仓库根目录：
PYTHONPATH=workers/sft python3 -m unittest discover -s workers/sft/tests -v
cd frontend && npm ci && npm run test:ui && npm run build
```

Mac 上如已有可本地读取的兼容模型，还可使用合成提示词验证模型加载线程与 HTTP 请求线程之间的 MLX 推理；测试不会下载模型：

```sh
WELINK_TEST_MODEL_PATH=/本机模型目录 PYTHONPATH=workers/sft ~/.local/share/welink-sft/venv/bin/python -m unittest discover -s workers/sft/tests -p test_mlx_threaded_inference.py -v
```

更新锁定依赖时使用 `uv pip compile`，Mac 目标额外指定 `MACOSX_DEPLOYMENT_TARGET=14.0`。锁文件用于固定依赖解析结果与哈希；可根据具体修改选择适合的测试。
