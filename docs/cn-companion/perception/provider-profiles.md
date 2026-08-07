# M3 Provider 与 runtime 基线

文档核对状态：2026-07-28。阿里云百炼中国站公开 Realtime、客户端/服务端事件、限流、价格和隐私页面已于 2026-07-17 重新核对；阿里云官方售后工程师又于 2026-07-27 书面确认中国内地 Endpoint、日志留存、数据用途和断连后的会话上下文处理，并按用户确认冻结中国内地、Flash/Plus 和费用策略。Desktop 直接依赖 `ws@8.20.0`，production main-only socket factory、逐会话媒体授权、Screen/Camera orchestrator、共享云麦克风 subscriber 和严格 completed parser 已接线并通过无费用测试。Git 忽略的 Desktop `.env.local` 当前只绑定日期化 Provider 隐私证据；本次进程、用户和机器环境均未观察到 Workspace、API Key 或模型可用性标记，因此当前真实 Provider readiness 仍应 fail-closed。Provider 政策事实门现按“各种日志留存一个月、断连立即清除模型会话上下文、不用于训练/改进/评估或人工审阅、中国内地 Endpoint 不跨地域或跨境”记录，并已进入 cloud policy/control v0.4。会话上下文清除不等于服务日志删除，不得声明零留存；真实 Provider session/费用验收仍未完成，因此尚未发起本轮真实 Provider session 或产生费用。用户已于 2026-07-16 批准本地 Qwen3-VL 量化权重下载与真实 GPU 实测。

| Profile | 状态 | 固定产品策略 | 实现前阻塞 |
|---|---|---|---|
| Local Screen Qwen3-VL | ready / device-verified | `Qwen/Qwen3-VL-4B-Instruct`，1280x720，normal ≤0.2 FPS，active ≤1 FPS | Transformers NF4、Desktop main worker、定向 Eventa、consent/indicator/single-owner/context 与真实 UI 已通过；10 分钟 deterministic cadence 与 single-in-flight/latest-slot 压力 trace 已通过 |
| Cloud Screen Flash | production-integrated / provider-acceptance-pending | `qwen3.5-omni-flash-realtime` 常驻；text-only objective JSON | screen/audio 独立 grant、Manual PCM→JPEG→commit/create、strict completed parser、change gate、费用护栏和生产 socket 已通过；一月服务日志政策与 v0.4 readiness 字段已接线，仍缺真实付费 Provider 验收 |
| Cloud Screen Plus | production-integrated / provider-acceptance-pending | `qwen3.5-omni-plus-realtime`，仅六个 allowlisted reason、单 in-flight | route evidence、consent/cost/cooldown、Flash pause、最多 24 张/4 分钟 memory-only sparse keyframes 和完成/失败回落已通过；一月服务日志政策与 v0.4 readiness 字段已接线，真实 Plus 费用仍未验收 |
| Local Camera MediaPipe | ready / device-verified | presence/pose/hands/observable cue | Tasks Vision runtime、WASM 与 task assets 已进入 production build；只发布窄化 evidence |
| Local Camera OpenCV | ready / device-verified | quality/motion/change/preprocess | 官方 OpenCV.js 4.13.0，10,964,323 bytes，固定 SHA-256，Apache-2.0；独立 Worker 实测通过 |
| Local Camera YOLO | ready / device-verified | allowlisted person/object/count | 官方 YOLOX-Nano ONNX 0.1.1rc0，3,659,407 bytes，固定 SHA-256，Apache-2.0；ORT Web 1.24.3 WebGPU 实测通过 |
| Cloud Camera Qwen | production-integrated / provider-acceptance-pending | 固定 Flash、不自动升级 Plus；640x360 默认；change gate ≤1 FPS | JPEG/尺寸/FPS/privacy gate、独立 camera/audio grant、shared microphone、echo/backpressure/cancel、Camera Plus 拒绝和生产 socket 已通过；一月服务日志政策与 v0.4 readiness 字段已接线，仍缺真实付费 Provider 验收 |
| Minecraft adapter | production-integrated / external-acceptance-pending | registry identity + structured schema facts | schema/skew/replay、grant ceiling 与 Desktop consent 已通过；仍需真实 PCL/Fabric 客户端中已配对 Mod 的端到端运行；PCL/游戏身份不作为授权依据 |

## Qwen Realtime 冻结差异门

AGENTS 基线：图片前需真实音频输入；使用 Manual response control；M3 只请求 text output；delta 只临时组装；assistant 播放与 echo tail 期间丢弃云音频；单会话应在公开限制前主动轮换。

开始 M3.4/M3.6 真实 Provider 工作时必须记录：核对日期、官方 URL、模型 ID、region、协议版本、session/turn/media limits、RPM/TPM、价格来源、数据保留、Workspace 配置、与冻结策略差异。任何差异先停止接线并请求用户决策，禁止 silent fallback。

### 2026-07-17 Qwen Realtime 中国内地公开资料复核

- WebSocket：`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=<model-id>`，Bearer Token 位于 `Authorization` 请求头；Workspace ID 与 API Key 必须只由 Electron main 持有。
- Desktop 使用 catalog 固定的 `ws@8.20.0`，只在 Electron main 构造连接；socket boundary 拒绝非 TLS、非北京域名、额外 query/header、未知模型和含空白 API Key，关闭 redirect/per-message deflate，并限制单条 Provider event 为 64KiB。readiness 检查只验证 factory 已注入，不创建连接。
- 模型：公开页仍列出 `qwen3.5-omni-flash-realtime` 与 `qwen3.5-omni-plus-realtime`。会话可设置 `modalities: ["text"]`；Manual 模式把 `turn_detection` 设为 `null`，发送真实 `input_audio_buffer.append`、可选 `input_image_buffer.append`，随后 `input_audio_buffer.commit` 与 `response.create`。
- 输入约束：公开页明确音频输入必需、图片可选；输入音频为 16kHz PCM。M3 仍额外要求图片前已发送真实获授权音频，禁止伪静音。
- 输出：只接受 `response.text.done` 与最终 `response.done(status=completed)`；delta 只允许临时有界组装。任何音频输出、工具调用、联网搜索、转写 user turn 或不完整响应都拒绝。
- 会话上限：单连接最长 120 分钟。Plus 为 100 音频轮/50 视频轮/600 秒音频/240 秒视频；Flash 为 80/50/480/120。实现必须在上限前主动轮换。
- 中国内地公开限流：两个模型均为 60 RPM / 100,000 TPM；服务还可能按 RPS/TPS 执行，实际 Workspace 配额仍以控制台为准。
- 公开价格（每百万 Token）：Plus 输入文本/图片 10 元、输入音频 80 元、输出文本 60 元、输出音频 300 元；Flash 分别为 3.3/27/20/107 元。M3 禁止音频输出，费用账本只使用前三类相关费率，price profile ID 为 `qwen-realtime-cn-2026-07-17`。
- 隐私公开页：明确客户数据不用于模型训练，并说明调用数据会依法存储；公开页没有给出可选的最短保留时长。该公开页面本身不能证明零留存或具体期限，需以 2026-07-27 官方售后书面回复补充数据政策事实。
- 2026-07-18 使用已登录中国站控制台复核了业务空间管理、账号管理、安全管理与业务空间内设置：未发现数据保留时长或“不用于训练”的可配置开关。控制台不可配置不等于零留存；2026-07-27 官方售后书面回复已确认日志留存期限和数据用途，因此 `AIRI_QWEN_RETENTION_VERIFIED` 只能在生产配置准确绑定下述一个月日志留存政策、地区和证据日期后设为 `true`，不能被解释为“无服务端留存”。
- 2026-07-28 本机 Desktop 开发配置已通过 Git 忽略的 `apps/stage-tamagotchi/.env.local` 写入 `MAIN_VITE_AIRI_QWEN_RETENTION_VERIFIED=true` 与 `MAIN_VITE_AIRI_QWEN_PRIVACY_PROFILE_ID=qwen-realtime-cn-support-2026-07-27`；Electron-Vite `loadEnv` 已确认可读取。只有这两个隐私证据键同时接受无前缀和 `MAIN_VITE_` 前缀；Workspace、API Key 与模型可用性仍只读取运行进程中的无前缀变量。该配置只满足隐私证据门，不代表 Provider session、模型可用性或费用验收已经完成。
- 官方来源：`https://help.aliyun.com/zh/model-studio/realtime`、`client-events`、`server-events`、`rate-limit`、`model-pricing`、`privacy-notice`（核对日期 2026-07-17）。

### 2026-07-27 阿里云官方售后书面回复

证据来源为阿里云官方售后工程师在官方服务渠道的书面回复，日期为 2026-07-27。本文只记录答复中的政策结论，不保存工单截图、账号信息、原始会话内容或本机路径。

| 主题 | 官方回复确认的事实 | M3 解释与约束 |
|---|---|---|
| 服务日志留存 | 各种日志保留一个月 | 云端不是零留存。屏幕帧、摄像头帧、真实麦克风音频和 completed text 的用户告知与授权必须按“服务日志可能留存一个月”设计；不能用断连行为覆盖该披露 |
| 数据用途 | 不用于训练、改进、评估或人工审阅 | 可作为 no-training/no-review 政策证据；不改变最小上传、逐 modality 授权、raw payload 不进入 AIRI 日志/持久化和 strict objective parser 等本地约束 |
| 地域 | 中国内地 Endpoint 位于中国内地，不跨地域或跨境 | 中国内地 Profile 继续只允许已冻结的中国内地 Endpoint；任何 Endpoint、Workspace 或区域变化都必须重新走用户决策门 |
| 模型会话上下文 | 连接断开后立即清除模型会话上下文 | 只描述模型会话内上下文生命周期，不代表服务日志同时删除，也不改变日志一个月留存事实。AIRI 仍应在 stop/revoke/switch 时立即关闭 socket、释放本地 PCM/JPEG 引用并撤回旧 generation |
| Flash/Plus 差异 | 推理能力、响应能力和上下文记录轮数存在差异 | 不据此扩大输入、授权或保留范围。售后回复未给出更细的量化值，公开 session/turn/media limits 仍按上方 2026-07-17 时间点基线记录；也不得推导两模型具有不同的数据用途或日志留存政策 |

政策结论：此前“具体保留期限未知”的问题已关闭，已知答案为一个月服务日志留存；“断连立即清除模型会话上下文”是另一条独立生命周期事实。任何 UI、配置、验收记录或发布说明都必须同时呈现这两点，不得使用“断连即删除数据”“零留存”或等价表述。

仍未回答、不得自行推断的问题：

- “各种日志”具体包含哪些请求、响应、媒体载荷或派生字段，尤其是否及如何包含 Realtime 音频、图片、completed text、转写和元数据。
- 一个月日志留存能否通过 Workspace、企业协议或官方配置缩短，是否存在更短或零日志留存方案。

在这两个问题得到进一步书面答复前，M3 采用保守披露：所有发往 Qwen Realtime 的获授权媒体和响应均按“可能进入留存一个月的服务日志”向用户说明；不得据此扩大 AIRI 自己的本地留存，AIRI 侧仍保持 raw payload memory-only、处理后立即释放且不写日志/遥测/导出。

用户批准策略：屏幕帧显式启用时允许；摄像头帧与云麦克风按会话分别授权；Screen 常驻 Flash、六条件临时 Plus；Camera 固定 Flash；预算 5 元/次、10 元/日、50 元/月；失败停止云感知，不切模型、不循环重试；本地不保存图片、音频或完整响应；主动 reaction 关闭。

## 本地 runtime 决策门

Camera local 的完整比较、固定边界、制品 hash 与真实设备结果见 [M3.8 Camera Local OpenCV / YOLO 选型门](./camera-local-selection.md)。授权仍为逐会话、默认关闭，且不包含麦克风或云上传。

### 2026-07-16 M3.6 无下载复核

官方复核：

- 语义模型仍固定为 `Qwen/Qwen3-VL-4B-Instruct`（Instruct，不是 Thinking）。Hugging Face 官方权重页标记 Apache-2.0；Qwen 官方仓库当前要求 `transformers >= 4.57.0`，部署路径仍列出 `vllm >= 0.11.0`。
- Ollama 官方库提供 `qwen3-vl:4b-instruct-q4_K_M`，当前公开制品约 3.3GB，完整 manifest digest 为 `ee4b975b58c17ce268cd19d40db35d5edc64603035d2ffc1fee1968eb0947f7b`，主模型层 SHA-256 为 `16b83be682148a4d8201dbf720ea7eace5de98b69f63f05e0c908b4d7977ecb5`，支持 Text/Image。该 Ollama tag 是量化运行制品，产品 profile 仍必须记录上游语义模型 ID，不能把 tag 当成另一个模型。
- Ollama 本地 `/api/chat` 当前支持 `images`、JSON Schema `format`、`think: false`、`stream` 和 `keep_alive`；`keep_alive: 0` 可作为立即卸载门。structured output 仍需对 completed content 再做本地 strict JSON/schema 校验。
- 官方来源：`https://github.com/QwenLM/Qwen3-VL`、`https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct`、`https://ollama.com/library/qwen3-vl/tags`、`https://docs.ollama.com/capabilities/structured-outputs`、`https://docs.ollama.com/capabilities/vision`、`https://docs.ollama.com/api/chat`。

本机只读基线：

- GPU：NVIDIA GeForce RTX 5060 Laptop GPU，8,151MiB VRAM；复核时约 5,927MiB 空闲。
- Ollama client：0.30.11，已安装但服务未运行；未找到 `qwen3-vl:4b-instruct` 本地 manifest。
- WSL2 Ubuntu 可用但处于 stopped；D 盘约 118.7GB 可用。
- 现有 `vision-ollama` 能发送单图和内部 timeout，但输出是自由文本，外部 generation cancellation、严格 Objective Event parser、模型 digest/license 校验、lazy-start/idle-unload 与资源峰值证据均缺失，不能直接进入生产 M3。

已批准并执行：优先用已安装的 Windows Ollama 做 loopback-only spike，下载 `qwen3-vl:4b-instruct-q4_K_M`（约 3.3GB），固定 digest 后验证 1280×720 单图/多图、JSON Schema、Abort、`keep_alive: 0`、首帧/稳态延迟、VRAM/RAM 峰值与错误模型拒绝。若任何硬门失败，再提交 WSL2/vLLM 或 Transformers service 对比，不自动安装第二 runtime。

### 2026-07-16 Windows Ollama 真实验收

下载、制品与隔离：

- 4 路、8MB 有界 Range 下载完成；主模型层为 3,295,612,928 bytes，独立 SHA-256 复核为 `16b83be682148a4d8201dbf720ea7eace5de98b69f63f05e0c908b4d7977ecb5`，随后由 `ollama pull` 写入正式 manifest。
- `/api/tags` 与 `/api/show` 验证模型名、完整 manifest digest、4.4B、`Q4_K_M`、GGUF、`qwen3vl` 与 Apache-2.0。服务只监听 `127.0.0.1:11434`；测试结束后模型通过 `keep_alive: 0` 卸载。
- 所有下载分片、失败残留与合成测试图片已删除；正式、已验证模型制品保留。应用没有新增开机或随应用自动加载行为。

真实 RTX 5060 Laptop 8GB 结果：

| 验收项 | 结果 | 证据 |
|---|---|---|
| 单图活动分类 | 通过 | 合成代码页返回 `code`/0.92；合成浏览页返回 `browser`/0.95 |
| strict completed JSON | 通过 | discriminated JSON Schema 后由本地严格 parser 二次校验；不传 tools、不接聊天 |
| 取消、单 in-flight、卸载 | 通过 | Abort 返回稳定 `screen-inference-cancelled`；`/api/ps` 确认卸载 |
| 冷/暖延迟 | 有条件通过 | 冷请求约 18–43 秒，load 约 9.8–18.3 秒；暖请求约 2.6–6.8 秒 |
| GPU 资源 | 高风险 | 峰值总显存约 7,714–7,726MiB，已接近 8GB 上限 |
| 多图时序 | **失败** | `[code,browser]` 返回 `code`；`[browser,code]` 返回 `browser`，始终采用第一张，未按冻结策略采用最后一张当前帧 |

结论：该 Ollama 0.30.11 + 固定 GGUF 组合不能通过 M3.6 多图时序发布门。runtime profile 已改为 `degraded`，移除 `multi-image` capability，并设置 `runtime-multi-image-unsupported`；生产 controller 会拒绝把 degraded/缺 capability 的 profile 标为 ready。它仍可作为单图对照制品，但不得作为 production-ready 本地桌面观察模型。

### Ollama 失败后的 runtime 对比与决策门

2026-07-16 重新核对的官方事实：

- Qwen 官方仍推荐 `vllm >= 0.11.0` 做快速部署，也提供 Transformers 的原生多图路径，并特别建议多图/视频启用 FlashAttention 以节省显存：`https://github.com/QwenLM/Qwen3-VL`、`https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct`。
- vLLM 当前模型表明确列出 `Qwen3VLForConditionalGeneration` 和 `Qwen/Qwen3-VL-4B-Instruct`；`I E+` 中的 `+` 表示单个 Prompt 可输入多张图片：`https://docs.vllm.ai/en/latest/models/supported_models/`。
- vLLM 只原生支持 Linux，Python 要求 3.10–3.13；本机需在 WSL 新建隔离 Python 3.12 环境。当前官方 wheel 使用 CUDA 12.9，Blackwell 至少需要 CUDA 12.8：`https://docs.vllm.ai/en/latest/getting_started/installation/gpu/index.html`。
- vLLM 的 GGUF 路径当前被官方标记为 highly experimental、under-optimized，并迁移到额外插件，可能与其他能力不兼容，因此不能复用现有 GGUF 作为 production spike 的首选：`https://docs.vllm.ai/en/latest/features/quantization/gguf/`。
- 官方 BF16 safetensors 两个分片合计 8,875,719,344 bytes；官方 FP8 两个分片合计 6,021,235,456 bytes。8GB 显存还需容纳视觉编码器、激活和 KV cache，不能只按权重大小宣布可运行。
- Transformers + bitsandbytes 的 4-bit on-load 量化适用于包含 `torch.nn.Linear` 且支持 Accelerate 的任意 modality，可作为受限显存的正确性 spike：`https://huggingface.co/docs/transformers/quantization/bitsandbytes`。

| 候选 | 优点 | 当前风险/成本 | 决策 |
|---|---|---|---|
| WSL2/vLLM + 官方权重 | Qwen 官方推荐；原生 OpenAI server、structured output、多图、调度能力成熟 | 需新建 Python 3.12 runtime；BF16 明确超 8GB，FP8 加运行开销仍可能 OOM；现有 GGUF 路径不满足稳定性门 | 保留为第二顺位性能 spike |
| 独立 Transformers service + 官方 BF16 权重按加载时 4-bit 量化 | 官方原生多图代码路径；最容易写出窄、loopback-only、可取消/卸载的正确性服务；更适合 8GB 首次验证 | 仍需下载约 8.88GB 原始 safetensors 和新 Python/CUDA 依赖；首帧/吞吐未知；必须实测 strict JSON、显存和卸载 | **推荐下一步** |

### 2026-07-16 Transformers NF4 真实验收

用户批准后已在 WSL2 建立隔离 Python 3.12 runtime，模型缓存位于 WSL 用户缓存而非项目目录。固定运行时与制品信息写入 `services/perception-qwen3-vl-transformers/runtime-profile.json`：

- `torch 2.12.0+cu130`、`torchvision 0.27.0+cu130`、`transformers 5.14.0`、`accelerate 1.14.0`、`bitsandbytes 0.49.2`。
- 官方模型 revision 固定为 `ebb281ec70b05090aa6165b016eac8ec08e71b17`；两个 safetensors 分片分别为 4,967,229,296 与 3,908,490,048 bytes，并完成独立 SHA-256 全量复核。
- 加载方式固定为 bitsandbytes NF4、double quant、BF16 compute；CUDA 13.0 在 RTX 5060 Laptop（compute capability 12.0）上通过真实 tensor kernel 自检。

真实模型正确性与资源结果：

| 验收项 | 结果 | 证据 |
|---|---|---|
| 单图活动分类 | 通过 | 1280×720 合成代码页返回 `code`/0.98；浏览页返回 `browser`/0.90 |
| 多图当前帧语义 | 通过 | `[code,browser]` 返回 `browser`；`[browser,code]` 返回 `code`，修复了 Ollama 始终采用第一张的问题 |
| strict completed JSON | 通过 | Python 服务只生成 bounded objective JSON；TypeScript facade 再做精确 key、大小、模型身份和既有 strict parser 校验 |
| 取消 | 通过 | 真实生成期间 Abort 触发停止，TypeScript facade 返回稳定 `screen-inference-cancelled` |
| loopback 与鉴权 | 通过 | 服务仅绑定 `127.0.0.1:39273`，使用每次启动的 memory-only token；无 CORS、无请求日志 |
| 卸载 | 通过 | `/v1/stop` 后 worker 进程退出；端口监听为 0，NVIDIA compute process 为 0 |
| 延迟 | 通过受限门 | 最终直接 spike load 约 21.9 秒；真实 service E2E load 约 14.5 秒，单/多图约 3.9–4.6 秒 |
| GPU 资源 | 通过受限门 | 峰值总显存约 7,506MiB；必须保持单 in-flight、latest-frame 和进程退出卸载 |

最小 `services/perception-qwen3-vl-transformers` 服务和 `LocalTransformersScreenRuntime` 已实现。原始 JPEG/base64 只存在于调用临时边界，服务不接收聊天历史、Prompt、麦克风、工具或角色数据；TypeScript controller 的唯一事实写入口仍是 `PerceptionStateManager`。完整 M3 perception tests 111/111、Desktop Eventa/manager/facade targeted tests 15/15 通过。

随后完成 Desktop main 与 Eventa gateway：

- main manager 保持冷启动，只有通过 gateway grant 检查后的 validate 才生成 memory-only token 并启动 WSL worker；token 只经进程环境传入，不出现在命令行、renderer、状态、日志或响应。
- generation 替换先停止旧 runtime；stop 先调用 worker `/v1/stop`，等待进程正常退出，超时才终止 AIRI 自己持有的子进程；app-exit hook 复用同一幂等路径。
- renderer → main JPEG 使用 `defineInvokeEventa<Response, ReadableStream<Message>>` 的定向 client stream；open/frame/complete、授权、correlation、严格顺序、最多 4 帧、单帧 1MiB 和 1280×720 均在 main 边界验证，返回事件在 renderer 再次验证 schema 与 session/generation/observation correlation。
- 真实 Desktop main manager 启动结果：load 12,441ms，`[code,browser]` 推理 5,612ms，返回 `browser`，provenance 为 `transformers-service / screen:transformers-local`；stop 后端口、WSL worker 和 Python/WSL GPU client 均为 0。
- 真实 Electron Eventa adapter 传输 4×190KiB JPEG 共 778,240 bytes，保持 open → 4 frame → complete 顺序，成功路径 7.9ms；AbortSignal 实测返回 `AbortError`。

状态：**Transformers 4-bit runtime、Desktop main worker manager、定向 Eventa gateway/facade、可信 consent registry、持续指示、single-owner session/generation、生产 UI 与有界 context projection 均已通过真实硬门，Local Screen 本地切片为 `ready / device-verified`。这不代表整个 M3 complete；真实付费 Qwen Provider 与真实 PCL/Fabric Provider 验收仍未完成。Ollama profile 继续保持 `degraded`，不会静默 fallback。**
