# SFT 工作台设计方案

状态：工作台、数据与任务控制端、MLX / CUDA worker 已实现并完成自动化测试；CUDA 已进行一次 L20 合成数据冒烟，Mac 及完整硬件验收仍待完成。当前交付边界和发布门槛见 [v0.4.0 验收清单](./sft-release-checklist.md)，使用见 [Worker 连接指南](./sft.md#连接远程-gpu-容器)。本文保留完整目标设计，API 草案以当前实现及验收清单的说明为准。

更新：2026-10-22。已确认运行范围：本机 Apple Silicon Mac + 远程 Linux / NVIDIA GPU 训练机。

## 1. 当前能力与目标

设计开始前已有 `lora-jsonl` 导出：

- 入口：洞察 → 个人自画像 → 炼化我的 Skill → LoRA 训练集（高级）。
- `backend/lora_export.go` 从私聊中提取“对方上一句 → 我的回复”，做基础过滤、脱敏和配额限制。
- `POST /api/ai/forge-skill` 接受 `skill_type=self, format=lora-jsonl`，异步生成训练数据 ZIP。
- ZIP 包含 `data.jsonl`、统计、README 和训练说明；当前至少需要 500 条配对。
- 设计开始前没有训练进程、训练资源管理、检查点恢复、效果评测或训练产物接入页面；这些能力现已落地为独立 SFT 工作台与 worker，不复用 legacy Skill 任务队列。

目标是让用户在 WeLink 内完成：

**选数据 → 审核样本 → 冻结数据版本 → 选择本机或远程资源 → 训练 → 与基础模型比较 → 试用 / 接入 → 回滚。**

首版训练目标是“我的沟通风格”。近期事实与关系信息继续由现有聊天检索、记忆模块提供；SFT 不作为事实数据库更新机制。首版不开放第三方人物训练、群体人格训练、全参数微调、DPO 或多卡分布式训练，但数据结构预留目标类型和执行器扩展。

首版交付必须同时跑通 Mac 与远程 GPU 的完整闭环，不把“生成脚本 / 导出 ZIP”标为训练已完成。

## 2. 产品入口与信息架构

侧栏“AI 工作台”新增 **模型训练**，页面标题为 **SFT 工作台**，路由 `#/sft`。移动端入口放在“更多”；个人自画像增加“训练我的模型”，带当前账号进入工作台。Skills 保留原有导出及历史下载入口。

工作台按训练项目组织，同一项目可以有多个数据版本、训练任务和模型版本。

| 区域 | 用户主要问题 | 内容与动作 |
| --- | --- | --- |
| 项目概览 | 现在进行到哪一步？ | 当前账号头像 / 名称、数据状态、进行中的训练、最近评测、当前试用模型 |
| 数据集 | 用哪些聊天训练？ | 数据范围、质量报告、样本审核、版本列表、导入 / 导出 |
| 训练 | 在哪里、怎么训练？ | 新建任务、资源检查、队列、损失曲线、日志、检查点、停止 / 继续 |
| 评测 | 比原模型更好吗？ | 固定测试集、基础 / 微调模型盲测、人工评分、退化与重复情况 |
| 模型 | 如何在 WeLink 使用？ | 适配器与模型版本、兼容性、试聊、服务启动、接入、停用 / 回滚 |
| 环境管理 | 我的机器能训练吗？ | 本机组件、远程 worker、设备能力、模型缓存、磁盘和连接状态 |

环境管理是工作台内的设置入口，不在主侧栏继续增加一级菜单。项目页只放三个有实际意义的摘要：当前数据版本、运行中的任务、当前使用的模型。

### 2.1 概览布局草图

```text
SFT 工作台                                      [环境管理] [新建训练]
[我的头像] 我的沟通风格       数据账号：主号

[数据版本 v3 · 8,420 条] [训练中 · 42%] [当前使用：基础模型]

数据集 | 训练 | 评测 | 模型
-------------------------------------------------------------------
最近训练             环境              状态           操作
风格模型 #12         本机 Mac          训练中         查看
风格模型 #11         GPU 训练机 A      待评测         开始评测
-------------------------------------------------------------------
下一步：#11 已生成模型，完成与基础模型的对比后再决定是否使用。
```

### 2.2 新建训练流程

采用分步页面，不使用叠加多个弹窗：

1. **选数据版本**：使用已冻结版本，或进入“准备数据”；展示账号、范围、样本数及审核状态。
2. **选运行环境与基础模型**：先选 Mac / 远程 worker，再展示该环境确实支持的模型和训练方式。
3. **设置训练**：默认只显示预设与预计资源；高级参数折叠。试跑检测显存后才能正式提交。
4. **提交摘要**：数据版本、目标机器、基础模型、训练预算、保存策略、预计时间区间；点击“开始训练”。
5. **进入任务详情**：即使刷新 / 关闭浏览器，任务仍可从列表找回。

无环境时展示“启用本机训练组件 / 连接训练机 / 先导出数据”；无数据时展示“准备训练数据”。按钮旁明确缺少的前置条件。

## 3. 视觉与控件约束

- 延续现有中性色卡片、品牌绿主操作；失败 / 警告使用语义状态色，图表只使用必要的两到三种区分色。
- 不新增彩虹渐变、发光效果、机器人、魔法棒、星星装饰或虚假的“智能指数”。训练用普通文字状态和线性功能图标。
- 人物、账号、联系人全部优先显示真实头像，失败才显示姓名首字；使用现有 `Avatar`，保留录屏模式的隐私模糊。
- 下拉、搜索建议、日期、时间、开关、弹窗使用 `Select`、`ComboBox`、`DatePicker`、`TimePicker`、`Switch`、`Dialog`；统一 `Popover` 管理浮层，不新增原生浏览器弹出选择器。
- 桌面训练详情采用“指标 / 曲线 + 右侧配置摘要”；手机先显示状态、进度、剩余预算及停止入口，配置与日志分区折叠。表单与曲线不制造横向页面溢出。
- 进度来自真实阶段与计数；模型下载、数据上传、训练步数分别计量。无法估算时显示当前阶段，不用计时器伪造百分比。
- 图表提供文字摘要与表格替代；日志不抢焦点，屏幕阅读器只播报阶段变化，不连续播报每一步。

## 4. 数据准备与样本审核

### 4.1 数据来源

首版支持当前账号私聊以及导入的 JSONL。选择全部联系人 / 指定联系人、日期范围、排除联系人；联系人选择器带头像和搜索。后端强制执行屏蔽名单、账号归属与源数据范围，不能仅依赖前端隐藏。

数据草稿绑定 `source_profile_id` 与源账号指纹。账号切换不改变已经冻结的版本，也不能让正在构建的数据混入另一个账号。首版不从群聊或图片 / 语音识别内容构造训练标签。

### 4.2 从消息构造样本

执行顺序固定并记录流水线版本：

1. 从消息仓库按联系人与时间流式读取，按稳定消息 ID 去重；不要一次性把所有聊天加载入内存。
2. 使用可靠时间戳排序；时间未知、乱序或角色不确定的记录排除并计数，不跨时间未知区间拼接。
3. 按联系人与会话边界分组。初始会话间隔建议 30 分钟，可配置；系统消息、非文本和无法解析的转发内容形成边界。
4. 合并连续同一角色的短消息，保留换行与常用表达；合并间隔初值 60 秒。首版参数均为产品初值，需用真实样本验证。
5. 组成最多若干轮历史 + 对方输入 + 我的目标回复。最后一条必须为本人 `assistant` 回复；对方文本只作为 `user` 上下文。
6. 对最后一轮应用回复窗口，初值 5 分钟；跨窗口不生成回复标签。不要把同一条对方消息重复配给多条零散回复。
7. 规范化链接与非文本占位，检测手机号 / 邮箱 / 证件号等；保留口语、标点及可读表情，避免过度清洗改变风格。脱敏检测不等于保证消除全部隐私，用户可在样本预览中修正和排除。
8. 对完整上下文 + 回复做精确去重，再识别近重复、模板回复和过短空泛样本。每位联系人设置贡献配额，避免单一关系主导风格。
9. 按会话与近重复簇切分数据，再生成训练格式。任何来源消息重叠的样本必须在同一个集合中。
10. 用所选模型的 tokenizer 做第二次长度和标签校验；超长优先从最早历史裁剪，不能删空或截断目标回复后仍当作完整样本。

外部导入支持 `messages` 及现有 Alpaca 字段；先检查 schema、角色、目标回复、文件大小 / 行数和重复情况。导入的 `meta`、路径或配置文本不作为执行指令。只有校验通过的内容进入草稿。

### 4.3 统一样本格式与监督规则

内部规范使用对话格式；来源定位信息与训练内容分开存储：

```json
{
  "sample_id": "smp_01",
  "messages": [
    {"role": "system", "content": "根据上下文，用我的沟通方式回复。"},
    {"role": "user", "content": "晚上几点到？"},
    {"role": "assistant", "content": "差不多七点，到楼下跟你说"}
  ],
  "supervision": "final_assistant_only"
}
```

`sample_id`、监督说明和来源元数据由数据构建器管理，编译给训练引擎时只输出其支持的字段。训练包不含真实 wxid、头像 URL 或联系人姓名；使用按数据账号隔离的稳定匿名 ID，反向映射只留在本机元数据中。

**两种引擎统一只对最后一次本人回复计算损失。** 之前的 assistant 历史也是上下文，不再次监督，避免多轮样本重叠放大同一回复权重。MLX 的 `--mask-prompt` 在 chat 数据中针对最后一条消息；LLaMA-Factory 配置 `train_on_prompt=false`、`mask_history=true`。这两项必须通过 token 标签测试，不能只在 UI 上写“仅训练回复”。参见 [MLX 数据与 prompt masking](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md)、[LLaMA-Factory 参数](https://llamafactory.readthedocs.io/en/latest/advanced/arguments.html)。

### 4.4 防止训练与评测相互泄漏

- 默认按时间顺序与完整会话组分配 80% / 10% / 10%，用于训练 / 验证 / 测试；实际比例受会话大小影响，展示真实数量。
- 相同 / 近重复样本、共享源消息的滑动窗口组成不可拆分组。跨时间边界的重复样本从较晚集合移除并计数；不能重新随机分散到三个集合。
- 验证集用于超参比较、早停与检查点选择；测试集冻结，只用于最终比较，不参与训练样本扩充或挑选检查点。
- 修改清洗、范围、审核结果或划分方式产生新版本；已有任务继续引用旧的只读版本。
- 展示报告：原始消息 → 候选 → 排除原因 → 去重 → 审核保留 → 三个集合。没有足够独立会话时报告低可信度，不能通过复制样本补齐。

### 4.5 审核页面与版本

左侧是联系人 / 质量问题 / 审核状态筛选；中间展示上下文、目标回复及脱敏标记；右侧展示排除原因、来源时间和审核操作。

可保留 / 排除、批量排除某类问题、编辑脱敏文本、撤销草稿操作；编辑不回写原始微信数据库。支持抽样检查以及只看可疑样本。冻结前显示所有未处理问题及数据分布。

冻结版本保存：来源快照指纹、构建参数、匿名化规则版本、去重簇、划分清单、审核快照、样本数量和内容 SHA-256。token 统计是按基础模型单独生成的派生 manifest，不能覆盖原始版本。

建议初始门槛：正式训练至少 500 条训练样本、50 条验证样本、50 条测试样本；这是产品质量门槛，不代表达到数量就能保证效果。另提供“短训验证”，允许至少 100 / 10 / 10 条进行环境与流程验证，结果明确标记“样本不足，仅供试用”。旧版 500 条的 ZIP 导出门槛保留兼容。

## 5. 两类运行环境

| 项目 | 本机 Mac | 远程 GPU |
| --- | --- | --- |
| 首个训练后端 | `mlx-lm` | LLaMA-Factory / Transformers + PEFT |
| 设备 | Apple Silicon、Metal、统一内存 | Linux、NVIDIA CUDA；首版单卡 |
| 安装方式 | 用户启用独立的本机训练组件，使用隔离 Python 环境 | 用户在自己的训练机安装 WeLink worker 并配对 |
| 训练方法 | 受模型与 worker 版本支持的 LoRA / 量化 LoRA | LoRA / 经探测支持的 QLoRA |
| 预检重点 | 可用统一内存、系统内存压力、磁盘、Metal 与库兼容性 | 指定 GPU、可用显存、驱动 / CUDA、磁盘、依赖版本 |
| 执行位置 | macOS 原生进程，不把 Docker 容器识别为可访问 Metal 的本机环境 | worker 自己的进程 / 受控容器 |
| 推理接入 | 首先支持本机 MLX 服务 + adapter | 首先支持同一 worker 的受控推理服务 |

MLX 提供 LoRA 训练接口；LLaMA-Factory 提供 YAML 驱动的 SFT 接口。选择它们是本设计的工程取舍，不宣称它们对所有模型都可用。[MLX 训练入口](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/lora.py)、[LLaMA-Factory SFT](https://llamafactory.readthedocs.io/en/latest/getting_started/sft.html)。

Unsloth 可作为后续 GPU 执行适配器，不要求首版同时维护三套训练行为。两个首版后端都通过 WeLink worker 协议接入；浏览器不直接控制 Python 或远程 shell。

### 5.1 环境安装与连接

本机“启用训练组件”显示将安装的版本、目录与占用空间；不改全局 Python。启用后检测并报告能力，不具备 Apple Silicon / Metal 条件时保留远程和导出路径。

远程提供一次性、短有效期的配对信息，用户在训练机运行 worker CLI；worker 主动通过 TLS 连接 WeLink 控制端，不要求浏览器保存 SSH 私钥，也不要求训练机暴露通用 shell。对接地址必须是 worker 可以访问的控制端地址；本机只监听 loopback 时，页面明确要求先配置受认证的远程可达地址或现有安全隧道，不能自动开放公网端口。

配对后展示机器名、设备、允许的项目与数据账号、存储目录、版本和最近心跳。凭据使用独立 secret 引用，日志、配置导出和普通 preferences 响应不返回凭据。撤销 worker 会撤销后续领取任务和下载数据的权限；正在运行的任务进入明确的停止 / 离线处理流程。

### 5.2 模型目录与兼容性

模型条目保存 `model_id`、精确 revision、架构、权重格式、tokenizer / chat template 指纹、量化方式、许可信息、可用执行器及测试记录。不要把现有聊天 provider 下拉里的 API 模型直接作为可微调模型。

已在所选环境验证的模型排在前面；手动 Hugging Face ID / 本地模型路径属于高级入口，也必须通过探测。下载前展示大小、来源、许可 / 访问条件；离线时允许选择已完整校验的本地缓存。基础模型下载与私聊数据传输是两个独立操作。

页面不固定承诺“某型号显存一定能训练某参数量”。worker 用实际版本、量化、序列长度及设备执行短预检，返回“可运行 / 资源不足 / 未验证”，并给出测得峰值内存及估算范围。未完成预检不能显示绿色“兼容”。

## 6. 训练配置与资源预算

普通模式只暴露：数据版本、环境、基础模型、训练预设、训练时长上限。预设为“短训验证 / 标准训练”；所有高级配置仍可查看和导出。

建议的起始配置如下，属于待真实数据校准的产品初值：

| 参数 | 初值 / 规则 |
| --- | --- |
| 方法 | 支持时优先量化 LoRA；否则明确显示 LoRA |
| 监督范围 | 最后一次本人 assistant 回复，强制开启 |
| 序列上限 | 2,048 tokens；预检后可下调 |
| micro batch | 1；不以自动扩大 batch 改变已提交任务 |
| 梯度累积 | 8，按后端的实际优化步定义编译 |
| LoRA rank / dropout | 16 / 0.05；目标层按已验证模型配方指定 |
| 学习率 | 1e-4，支持高级调整，不标注为普适最优 |
| 正式训练量 | 默认 1 个 epoch；同时设置 optimizer step 与运行时间上限 |
| 短训验证 | 默认最多 100 个 optimizer updates，受时间预算约束 |
| 随机种子 | 42；保存所有派生参数与精确版本 |
| packing | 首版关闭，先保证样本边界和标签正确 |
| 保存 | 周期保存 + 保留最近两个有效恢复点 + 验证集最优权重；磁盘预算先行 |

前端分别显示样本数、token 数、micro step、optimizer step、epoch；MLX iterations 与 Transformers optimizer steps 不得直接混用。worker 编译并回显实际计划，服务端校验与提交快照一致。

LoRA 的 alpha / scale、目标模块、训练层数和精度字段也由各后端 adapter 按已验证配方编译；不得因为字段名字相近就做一比一映射。不支持的参数应在预检阶段拒绝，而不是忽略。

正式任务前执行少量真实训练步的预检；预检输出不可当作正式模型。预检可以建议减少序列长度、micro batch 或训练层数，但需要生成新配置，不能在后台静默改变正式任务。

提交摘要必须包含数据将运行于哪台机器、数据传输大小、模型下载大小、可用磁盘、检查点保留量和训练预算。远程 GPU 是用户自有资源，无法可靠获知价格时不编造费用；可允许用户填写小时单价，再显示粗略预算范围。

## 7. 任务执行、进度与恢复

### 7.1 持久化状态

```text
draft → preflight → ready → queued → preparing → running → saving → succeeded
                      ↘ failed               ↘ stopping → canceled / paused
running / preparing → reconciling → running / paused / failed
```

数据构建、训练、评测、转换、部署是不同类型的任务，各有状态与错误，不能用一个“训练成功”覆盖后续失败。worker 连接状态独立于任务状态；失去心跳先进入 `reconciling`，不立即重新启动另一份训练。

提交 `start` 与 `cancel` 支持幂等键；任务的每次执行有独立 `attempt_id`。数据库事务领取、设备租约和 fencing token 防止重复执行、旧 worker 回调覆盖新 attempt。相同请求重试只返回原任务。

### 7.2 详情页面

```text
风格模型 #12           本机 Mac             训练中
640 / 1,600 optimizer steps   预计剩余 18–26 分钟    [保存并停止]

[训练 / 验证损失曲线]               [固定配置摘要]
训练 loss 1.82                     数据：v3 / sha256…
验证 loss 1.94                     基础模型 / revision
有效 tokens/s / 内存峰值           LoRA / 序列长度 / batch

指标 | 日志 | 检查点 | 配置 | 事件
```

指标至少包括：train loss、val loss、学习率、已监督 token 数、tokens/s、内存 / 显存、磁盘、训练步与耗时；引擎不提供的指标显示“未提供”。剩余时间在测得稳定吞吐后给区间，排除下载 / 上传阶段。

页面默认选中最近有效检查点，允许查看校验和、大小、对应步数、验证结果与恢复能力。验证损失持续变差时标注可能过拟合，并保留用户选择与原始曲线，不用模型自己生成“训练效果 98 分”。

### 7.3 停止、恢复与服务重启

- “保存并停止”是 cooperative stop 请求；只有收到实际保存 / 退出回执后才显示已停止。页面显示保存进度。
- “立即终止”说明会丢失上次检查点后的进度；worker 管理自己的进程组，超时后清理子进程和设备租约，不能误杀别的训练任务。
- **完整恢复**要求模型、优化器、调度器、随机状态、数据进度与配置兼容；缺少任何部分不得称作断点恢复。
- **从权重继续训练**创建新 attempt / 新任务关系，重建优化器并清楚标识。这与完整恢复不同。
- MLX 现有 `resume_adapter_file` 入口加载 adapter 权重，首版保守定义为“从权重继续训练”；除非 worker 另行实现并通过完整状态恢复测试，不显示“原进度恢复”。LLaMA-Factory 只有保存了完整训练状态的检查点才提供完整恢复。[MLX 恢复实现](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/lora.py)、[LLaMA-Factory 检查点说明](https://llamafactory.readthedocs.io/en/latest/getting_started/merge_lora.html)。
- 浏览器刷新、断线、切换页面不中断任务。控制端重启后通过持久化记录与 worker 进程身份对账，不重复启动；只有确认原进程结束后才释放其设备租约。
- 首版不承诺训练迁移后逐步一致：只有执行器、精确模型、数据、训练状态格式和设备配置均受支持时才允许完整恢复；Mac 与 CUDA 之间默认只能重新训练或导入经验证的权重格式。
- 本机 worker 由独立组件管理，关闭浏览器不会退出。退出整个 WeLink 服务时默认请求本机保存并停止；不能保存时保留最近检查点并记录中断原因。
- 远程 worker 与控制端断连可继续当前已领取任务，最长离线执行窗口初值 10 分钟，并受任务时间预算约束；超过窗口后保存并停止。重新连接先对账，不能自动领取重复任务。

## 8. 评测与试聊

训练成功后进入“待评测”，不自动成为默认模型。

自动评测固定同一测试版本、chat template、system prompt、解码配置与种子，分别运行基础模型和微调模型。基准与微调模型若不在同等运行条件下，延迟 / 吞吐只作参考，不能当作训练效果结论。评测不注入目标真实回复，也不混入检索到的测试答案。

| 维度 | 展示方式 |
| --- | --- |
| 拟合与退化 | 同一 tokenizer 下的 holdout loss；训练 / 验证差距 |
| 回复风格 | 长度、口语 / 表情 / 标点分布与真实回复统计；明确不是绝对质量评分 |
| 人工偏好 | A/B 随机位置、隐藏版本名；选“更像我 / 更有帮助 / 平局”，提交后揭晓 |
| 常见失败 | 重复、空回复、过长、无关、明显格式错误的数量及可查看样例 |
| 内容复现 | 检查生成结果中异常长的训练原文片段和未替换标识符，展示命中上下文供审核 |
| 运行情况 | 推理错误、tokens/s、启动耗时、运行环境 |

默认抽取最多 50 条测试问题做人工盲测起始集合，按会话分组抽样，记录评价人数和样本数；没有足够样本时标注“证据不足”，不展示误导性胜率。自动 judge 可在后续作为显式选择的辅助项；默认不用外部 API 发送私聊评测内容。

“试聊”可随时切换基础 / 微调模型，并固定同一段对话上下文。新产生的试聊内容不自动写回训练集；用户可以显式收藏为下一版的人工样本。

比较检查点只用验证集；最终模型选定后才运行测试集。看过测试结果后继续调参，要创建新的评测轮次并提示测试集已被反复使用，不能把重复试验当作独立证据。

## 9. 模型产物、导出与 WeLink 接入

模型版本记录：基础模型精确 revision、数据版本、训练配置 hash、执行器 / 库版本、adapter 格式、文件校验和、监督规则、模板 / tokenizer 指纹、评测记录和恢复能力。

产物分级：

1. **Adapter 包**：权重、adapter 配置、manifest、评测摘要；默认不附带原始训练数据和恢复用优化器状态。
2. **恢复检查点**：单独下载 / 保留，不与推理模型混为一谈。
3. **合并模型**：独立转换任务；成功后才显示产物，不因训练完成就承诺可下载。
4. **GGUF / Ollama**：仅对所选模型与转换器确实支持的链路提供；不支持时明确原因，并保留 MLX / Transformers 推理路径。

默认不承诺 MLX adapter 可直接导入 PEFT / Ollama，或任意模型都能导出 GGUF。MLX 文档明确其内置 GGUF 导出存在模型家族与精度限制；Ollama 的 GGUF 导入要求先准备相应文件。[MLX 导出说明](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md)、[Ollama 导入说明](https://docs.ollama.com/import)。

首版确保两条直接接入路线：

- Mac：由 worker 启动基础模型 + 对应 MLX adapter 的私有推理实例，通过兼容接口供 WeLink 使用。MLX server 有 adapter 路径加载逻辑，但 worker 必须测试所需的接口与流式行为。[MLX server 实现](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py)。
- 远程：worker 启动与训练框架匹配的受控推理实例，由已认证的数据通道 / 网关转发；浏览器不直接访问 GPU 机器上的无认证端口。

“接入 WeLink”依次执行：产物校验 → 基础模型 / tokenizer / 模板匹配 → 内存预算 → 服务启动 → 健康检查 → 固定提示词与流式推理 smoke test → 创建独立 LLM profile。模板一致是部署校验项；跨框架模板错误可能造成输出异常，参见 [Unsloth 部署排错](https://docs.unsloth.ai/basics/saving-and-using-models/troubleshooting)。

新 profile 记录 `sft_model_version_id` 与 endpoint 身份，沿用现有模型下拉选择。用户可以在首页 / AI 分身等支持 profile 的入口试用；不自动覆盖现有 API key、模型配置或默认 profile。

“设为默认”是单独动作，持久化上一个默认项，支持回滚。服务不健康时给出“重新启动 / 切回原配置”，不静默用另一个模型回答。删除被引用模型前要求先解除 profile 引用；运行中的任务、共享基础权重、有效检查点采用引用计数清理。

## 10. 控制端与 worker 架构

```text
React / SFT 工作台
        │ 账号隔离的 API + SSE
Go / SFT 控制端 ── sft.db / 任务与版本元数据
        │         sft/ / 冻结数据、配置、产物清单
        │ worker 主动建立的受认证连接 / 租约 / 结构化事件
        ├── 本机 worker ── MLX adapter ── Metal
        └── 远程 worker ── LLaMA-Factory adapter ── 指定 CUDA GPU
```

Go 负责权限、数据构建、配置校验、任务调度和持久化；Python worker 负责设备探测、训练、指标与推理实例。不能把长训练塞进现有 Skill 的裸 goroutine，或复用生图队列中的伪进度 / 重启即失败策略。

### 10.1 持久化与账户隔离

新增独立 `sft.db`，WAL、版本化迁移；避免高频训练指标抢占现有 `ai_analysis.db` 的全局锁。每个业务实体保存 `owner_profile_id` 与项目归属；所有查询与下载必须带服务端确定的归属条件。

数据根目录由后端配置解析，浏览器不传入任意写入路径：

```text
sft/
  profiles/<stable-profile-id>/
    projects/<project-id>/
      datasets/<version-id>/     manifest / train / valid / test / local provenance
      runs/<run-id>/<attempt>/   compiled config / events / checkpoints
      models/<model-version>/   artifact manifest / evaluation references
  cache/models/<content-hash>/   共享基础权重，按引用计数管理
```

| 表 | 主要职责 / 关键字段 |
| --- | --- |
| `sft_projects` | owner、source profile / identity、target、名称 |
| `sft_dataset_drafts` | 数据范围、清洗配方、审核版本、并发编辑 version |
| `sft_dataset_versions` | 只读 manifest、hash、划分清单、质量报告、source snapshot |
| `sft_sample_reviews` | draft / sample、保留或排除、脱敏编辑、原因、revision |
| `sft_workers` / `sft_worker_bindings` | 安装级 worker 身份与项目级授权、设备、能力、secret 引用 |
| `sft_jobs` / `sft_attempts` | 类型、状态、dataset / model、执行快照、幂等键、预算、fencing token |
| `sft_device_leases` | worker + device 唯一租约、有效期、attempt、对账状态 |
| `sft_job_events` / `sft_metrics` | attempt + seq 唯一事件、阶段 / step 指标、SSE 游标 |
| `sft_artifacts` | 类型、相对位置、sha256、完整 / 可恢复状态、引用与保留策略 |
| `sft_evaluations` / `sft_eval_votes` | 固定配置、基准与目标版本、样例、随机化 A/B、人评结果 |
| `sft_model_versions` / `sft_deployments` | 训练溯源、兼容性、endpoint、健康状态、profile 引用 |

大 JSONL / 权重不放 SQLite BLOB。文件先写临时路径、校验后原子提交 manifest；没有完整 manifest 的文件不显示为成功产物。样本查询分页，日志滚动保留，指标分批写入与降采样。

### 10.2 worker 协议

- `capabilities`：OS / arch、设备、内存、Python 与库的精确版本、训练 / 恢复 / 转换 / 推理能力；采用版本化协议。
- `claim`：领取已校验的不可变任务，返回 attempt / lease / fencing token、资源绑定、预算与产物规范。
- `artifact transfer`：分块、断点续传、总量限制、逐块及最终校验；下载权限限定当前任务需要的文件。
- `events`：结构化 `stage / metric / checkpoint / log / error / completed`，带单调 seq；重复上报去重，过期 attempt 不能更新当前任务。
- `commands`：只允许预定义的停止、保存、探测和推理管理动作；配置编译为固定 executable + 参数数组，不接受网页任意 shell / Python 代码。
- `heartbeat / reconcile`：设备与进程身份、最近事件、任务和预算；控制端重启后先对账。

引擎 adapter 使用版本固定的 Python callback 产生 JSON 事件，不把可能变化的彩色 stdout 正则当作唯一状态来源；原始日志仅用于排错。结构化事件缺失时显示指标不可用，并把协议 / 版本失配作为可定位错误。

首版每个物理 GPU / Mac 统一内存训练域只允许一个训练任务；推理与评测也参与资源预约。无足够资源时排队，不与训练抢内存。队列只在真正创建进程前分配设备与数据权限。

## 11. API 草案

所有用户 API 位于现有认证 / PIN 锁保护后的路由组；worker API 使用独立凭据与更窄的作用域。以下是拟新增契约，尚未实现。

| 方法与路由 | 作用 |
| --- | --- |
| `GET /api/sft/capabilities` | 当前账号可用环境、功能与质量门槛 |
| `GET/POST /api/sft/projects` | 列表 / 新建项目 |
| `GET/PATCH /api/sft/projects/:id` | 概览 / 名称与草稿设置 |
| `POST /api/sft/projects/:id/datasets` | 从筛选范围或已上传内容构建草稿，返回异步 job |
| `POST /api/sft/uploads` / `POST /api/sft/uploads/:id/complete` | 受大小、账号与内容校验约束的 JSONL 导入，完成后返回不含文件路径的引用 |
| `GET /api/sft/datasets/:id/report` | 质量漏斗、贡献分布、划分与问题 |
| `GET /api/sft/datasets/:id/samples` | 分页过滤样本 |
| `PATCH /api/sft/datasets/:id/reviews` | 带 revision 的批量审核；冲突返回 409 |
| `POST /api/sft/datasets/:id/freeze` | 冻结版本并生成 hash；草稿未处理问题按规则阻断 |
| `POST /api/sft/dataset-versions/:id/exports` | 生成 MLX / LLaMA-Factory / legacy ZIP |
| `GET /api/sft/workers` / `POST /api/sft/workers/pairings` | 环境与一次性配对 |
| `DELETE /api/sft/workers/:id/binding` | 撤销本项目绑定，不删除别的项目任务 |
| `POST /api/sft/preflights` | 检查环境、模型、资源与 token 标签，返回结果 / job |
| `POST /api/sft/runs` | 从 ready preflight 与只读版本提交训练 |
| `GET /api/sft/runs` / `GET /api/sft/runs/:id` | 训练列表 / 详情 |
| `GET /api/sft/jobs/:id/events` | SSE；支持 Last-Event-ID 补发和分页 HTTP 降级 |
| `GET /api/sft/runs/:id/checkpoints` | 恢复点及兼容能力 |
| `POST /api/sft/jobs/:id/cancel` | 幂等请求停止，不提前宣告已停止 |
| `POST /api/sft/runs/:id/resume` | 显式选择 `full_state` 或 `weights_only` 并校验 |
| `POST /api/sft/evaluations` | 固定测试版本、基础与微调版本开始评测 |
| `GET /api/sft/evaluations/:id` / `POST /api/sft/evaluations/:id/votes` | 结果 / 盲测评分 |
| `GET /api/sft/models` / `GET /api/sft/models/:id` | 模型版本、引用与兼容性 |
| `POST /api/sft/models/:id/conversions` | 适配器合并、GGUF 等独立转换任务 |
| `POST /api/sft/models/:id/deployments` | 启动推理、健康检查与测试 |
| `POST /api/sft/deployments/:id/connect` | 幂等创建独立 WeLink LLM profile |
| `POST /api/sft/deployments/:id/default` / `POST /api/sft/deployments/:id/rollback` | 显式设为默认 / 恢复之前的 profile，复用受锁保护的 preferences 写入 |
| `POST /api/sft/deployments/:id/stop` | 停止推理并更新健康状态 |
| `GET /api/sft/artifacts/:id/download` | 归属校验、流式下载、支持 Range |
| `POST /api/sft/projects/:id/cleanup-preview` | 列出可清理文件、引用及可回收空间 |
| `POST /api/sft/projects/:id/cleanup` | 按已确认清单清理非引用产物 |

异步请求返回 202 + job ID，不长时间占住 HTTP 请求。`Idempotency-Key` 对创建、训练、部署、停止生效；409 表示版本 / 状态冲突；422 为不兼容或预检失败，附机器可读 `reason_code` 与修复动作。错误体不包含密钥或原始聊天片段。

`POST /api/sft/runs` 示例：

```json
{
  "project_id": "sftp_01",
  "dataset_version_id": "ds_v3",
  "preflight_id": "pf_07",
  "worker_id": "worker_mac_01",
  "model_revision_id": "base_rev_01",
  "recipe_id": "style_standard_v1",
  "limits": {"max_runtime_seconds": 7200, "max_optimizer_steps": 1600},
  "seed": 42
}
```

服务端从 preflight 固定配置推导参数，不信任前端任意覆写设备路径、引擎命令或模型 revision。重复请求返回同一个任务；数据 / 配置有变化需生成新 preflight。

## 12. 与现有代码的衔接

| 现有位置 | 拟调整 |
| --- | --- |
| `backend/lora_export.go` | 抽出可测试的读取、会话构造、清洗、配额与格式 adapter；旧导出保持兼容，不直接把现有固定阈值当新训练流水线 |
| `backend/main.go` Skill 路由 | 保留 legacy `lora-jsonl`；新增独立 SFT 路由组与任务服务，避免继续扩大匿名 goroutine |
| `backend/service` / 消息 repository | 提供带账号与屏蔽策略的流式消息读取，复用按联系人分库路由 |
| `backend/ai_store.go` | 仅接入 SFT 初始化协调；SFT 自己管理 DB 生命周期，账号切换不关闭训练元数据连接 |
| `backend/preferences.go` | 增加受控 SFT 数据目录、组件路径、默认 worker 引用和运行策略；模型密钥不借作 worker 凭据 |
| `frontend/src/types/index.ts` / `App.tsx` / `Sidebar.tsx` | 增加 `sft` tab、懒加载页面及移动入口 |
| `frontend/src/services` | 新建 `sftApi.ts`，类型化任务、事件与错误，不继续堆叠全部接口到单一文件 |
| `frontend/src/components/sft` | 项目概览、数据审核、训练向导、任务详情、评测、模型与环境页面 |
| `SelfPortraitCard.tsx` / `ForgeSkillModal.tsx` | 增加工作台入口，旧 ZIP 导出仍可用 |
| `settings/ai` 与 LLM profile | 支持引用 SFT deployment、状态显示、显式设默认和回滚 |

建议代码边界：`backend/sft/{dataset,store,scheduler,worker,artifact,eval,deploy}`，路由层只做输入 / 权限 / 状态转换；训练 worker 单独置于 `workers/sft/`，Mac 与 CUDA 使用独立锁定依赖 / 镜像。原始数据库、样本、模型与 secret 均不进入 Git 或 Docker 构建上下文。

## 13. 异常与恢复体验

| 情况 | 页面与后端行为 |
| --- | --- |
| 无训练组件 / 无 GPU | 指出缺少环境，提供启用 / 配对 / 导出入口，不出现假成功 |
| 数据不足、角色不明 | 显示数量与具体排除原因，返回审核或调整范围；不复制数据凑数 |
| tokenizer / 模板不匹配 | 预检阻断，提示选择匹配的基础 revision / 配方 |
| OOM | 保存可用状态，标记失败阶段；提供复制为低资源配置，禁止静默改参数重跑 |
| 磁盘不足 | 预检或保存阶段具体报错，保留原有效 manifest，展示可清理项 |
| worker 断网 / 控制端重启 | 进入对账，显示最后心跳和事件；不把旧曲线当实时、不重复训练 |
| 电脑睡眠 | 标记指标中断并对账；不能从墙上时间假算训练进度 |
| 训练 loss NaN | 停止并保存诊断配置 / 最后有效检查点；不给“已训练完成”状态 |
| 保存或转换失败 | 训练权重与失败转换任务分别保留，可以只重试转换 |
| 推理服务启动失败 | 模型保留，profile 不标可用，给出服务日志与资源修复动作 |
| 取消与完成同时到达 | 以 attempt 状态事务与实际退出回执定序；迟到的事件不重开终态 |
| 切账号 / 重新索引 | 只读数据快照继续使用，当前 UI 只看当前账号有权访问的任务 |
| 被引用文件清理 | 展示具体引用，不删除活动模型或其他账号使用的缓存 |

## 14. 分阶段实施与首版验收

| 阶段 | 可验证的交付结果 |
| --- | --- |
| A：数据与版本 | 工作台、草稿审核、完整会话样本、脱敏、分组切分、不可变版本；两种引擎可消费同一版本 |
| B：Mac 闭环 | 环境探测、预检、真实 MLX 训练、结构化指标、停止、权重继续、评测、MLX 推理接入 |
| C：GPU 闭环 | worker 配对、指定设备租约、断点传输、LLaMA-Factory 训练、完整检查点恢复、远程推理接入 |
| D：发布质量 | 盲测、人评记录、显式默认 / 回滚、清理、错误恢复、兼容性与升级回归；正式发布需 B + C 都通过 |
| 后续 | 经验证的 GGUF 链路扩展、Unsloth adapter、增量样本版本、更多训练目标、多 GPU 等 |

“完整功能”验收至少覆盖：

1. 从真实私聊构建可审核的数据版本，抽样核对角色、连续回复合并、边界与排除原因。
2. 证明三个集合没有共享源消息 / 重复簇；实际 token labels 仅监督最后一次本人回复，prompt 与 padding 不计入 loss。
3. Mac 和 CUDA 各使用一个固定 revision 的已验证小模型跑真实训练，不以 mock loss 或截图代替。
4. 两端能在刷新页面后恢复观察；控制端 / worker 重启、心跳过期、网络重连不会重复分配设备或重复训练。
5. 验证“停止后权重继续”与“完整状态恢复”的不同语义；支持完整恢复的引擎对固定环境执行步数、数据进度与状态连续性检查。
6. 基础 / 微调模型用同一冻结测试集完成对比和人工盲测，结论附样本数，测试目标答案不泄漏到输入。
7. 两种环境均能把模型接入 WeLink，完成一次真实流式试聊，显式设默认并回滚至原 profile。
8. 两个数据账号相互不能查询、下载或部署对方产物；被屏蔽联系人在后端构建时被排除；worker 只能读取所领取任务的内容。
9. 注入 OOM、NaN、磁盘满、半文件、重复提交、重复事件、过期 attempt、取消竞争与撤销 worker，检查终态和修复动作。
10. 桌面 / 390px 手机、深浅色、键盘完整走通向导与审核，人物显示头像，全流程不出现浏览器原生下拉或日期弹层。

每次发布固定并保存 worker / 引擎版本与已验证模型清单；依赖升级先跑数据标签、恢复、推理模板与转换兼容性回归，再标记新能力可用。发布不以“支持最新所有模型”为目标，而以可复现的已验证组合为准。
