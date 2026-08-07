# M3 感知验收矩阵 v0.3

整体状态：`production-integrated / external-acceptance-pending`。状态值：`pass-domain` 仅代表框架无关合同测试通过；`pass-targeted` 代表对应生产边界的定向集成测试通过；`pass-device` 代表真实设备用户路径通过；`planned` 需要后续集成、浏览器或真实设备证据。矩阵核心版本仍为 v0.3；云 policy/control 已更新为 v0.4。任何 `planned` 存在时不得声明 M3 complete。

| ID | 场景 | 层级 | 当前状态 | 证据要求 |
|---|---|---|---|---|
| P01 | strict event schema 接受合法最小事件 | domain | pass-domain | Vitest |
| P02 | raw image/base64 字段被拒绝 | domain | pass-domain | Vitest |
| P03 | raw audio/Prompt/未知字段被拒绝 | domain | pass-domain | Vitest |
| P04 | 超长/多行/control summary 被拒绝 | domain | pass-domain | Vitest |
| P05 | 未知 event type 被拒绝 | domain | pass-domain | Vitest |
| P06 | confidence 限定 0..1 | domain | pass-domain | Vitest |
| P07 | TTL 非正或超过来源上限被拒绝 | domain | pass-domain | Vitest |
| P08 | 缺少 consent 抑制 | domain | pass-domain | Vitest |
| P09 | source/grant 不匹配抑制 | domain | pass-domain | Vitest |
| P10 | source unhealthy 抑制 | domain | pass-domain | Vitest |
| P11 | prohibited 永不接受 | domain | pass-domain | Vitest |
| P12 | sensitive 默认不进入 Context Projection | integration | pass-targeted | `context-projection` stale/revoked/prohibited/sensitive policy tests |
| P13 | 低置信事实抑制 | domain | pass-domain | Vitest |
| P14 | stale generation 抑制 | domain | pass-domain | Vitest |
| P15 | generation switch 撤回旧事实 | domain | pass-domain | Vitest |
| P16 | 重复 event ID 去重 | domain | pass-domain | Vitest |
| P17 | noisy source rate limit | domain | pass-domain | Vitest |
| P18 | 单帧 gesture 不 accepted | domain | pass-domain | Vitest fake clock |
| P19 | 多帧一致 gesture accepted | domain | pass-domain | Vitest fake clock |
| P20 | direct local 优先于冲突 cloud | domain | pass-domain | Vitest |
| P21 | 新鲜同值 update 替换旧事实 | domain | pass-domain | Vitest |
| P22 | TTL 到期从 snapshot 消失 | domain | pass-domain | Vitest fake clock |
| P23 | source revoke 立即撤回事实 | domain | pass-domain | Vitest |
| P24 | user confirm 标记 verification | domain | pass-domain | Vitest |
| P25 | user correction 立即撤回 | domain | pass-domain | Vitest |
| P26 | snapshot bounded 且无 raw evidence | domain | pass-domain | Vitest |
| P27 | permission 前不能 acquire/capture | domain | pass-domain | Vitest |
| P28 | permission deny 稳定错误码 | domain | pass-domain | Vitest |
| P29 | grant source 必须匹配请求 | domain | pass-domain | Vitest |
| P30 | camera/audio 云授权相互独立 | domain | pass-domain | mixed session 的 local grant 保持 `local-only`；云 `camera-frames` 与 `microphone-audio` 各自要求独立 `mixed` grant；Vitest |
| P31 | pause 停止 source 且不自动恢复 | domain | pass-domain | Vitest |
| P32 | stop 幂等 | domain | pass-domain | Vitest |
| P33 | dispose/unmount 幂等 | domain | pass-domain | Vitest |
| P34 | track ended 进入失败并撤回 | domain | pass-domain | Vitest |
| P35 | cleanup deadline <500ms | domain | pass-domain | Vitest fake timers |
| P36 | 单进程 owner 互斥 | domain | pass-domain | Vitest |
| P37 | Web Locks 缺失时 fail closed | domain | pass-domain | Vitest |
| P38 | Web Lock 持有至显式 release | domain | pass-domain | Vitest |
| P39 | Electron 多窗口只能一个 production owner | browser | pass-device | Settings owner + 主窗口真实双 renderer；Web Lock 1 held/0 pending，非 owner 只读，stop 后 0 held |
| P40 | 屏幕授权与持续指示 | browser/manual | pass-device | Windows 用户路径、持久指示、明确本地授权与外部窗口选择 |
| P41 | 屏幕 pause/stop 释放 track | browser/manual | pass-device | privacy pause/stop 撤回 context/facts，capture stop，loopback worker/端口清零 |
| P42 | screen source switch 撤回旧 generation | integration | pass-targeted | coordinator 覆盖 stop/revoke、旧 projection 清空、新 session/source 建立，以及迟到旧帧以 `generation-switched` 释放且不进入 analyzer |
| P43 | 本地屏幕 stable ≤0.2 FPS | performance | pass-targeted | 600,000ms/500ms signal deterministic trace：静止桌面仅 initial frame，1/600 FPS（约 0.00167 FPS） |
| P44 | 本地屏幕 active ≤1 FPS 且单 in-flight | performance | pass-targeted | 600,000ms 连续变化 trace 精确 600 次/1 FPS；60-frame 压力 trace 最大并发 1、仅 1 个 latest slot、58 个旧 pending frame 被替换 |
| P45 | raw screen frame 不进 context/Pinia/log/telemetry/export | security | pass-targeted | strict domain fixtures/snapshot tests、生产状态合同 exact-key tests、production perception 路径静态审计；旧 Devtools vision 已移除 `context:update` 依赖，raw data URL 仅作当前页内推理输入且测试确认不进入 Pinia |
| P46 | camera permission/indicator/stop | browser/manual | pass-device | Electron 用户路径、持续指示、暂停/停止清理；Local Camera teardown 穷尽 cleanup，单个 timer/analyzer/callback 失败不阻止其余资源释放、事实撤回或 projection 清空；拒绝/track-ended capture tests |
| P47 | MediaPipe presence/pose/gesture schema valid | device | pass-device | 实体摄像头 ready + narrowing/fusion schema tests |
| P48 | face cue 不声称真实情绪/健康 | safety | pass-targeted | observable-cue allowlist、禁止字段 schema 与固定 projection tests |
| P49 | OpenCV quality/motion profile | device | pass-device | 4.13.0 固定 hash、Worker 实测；低光/模糊/遮挡/运动 fixtures |
| P50 | YOLO allowlist/unknown label suppression | device | pass-device | Nano 固定 hash、WebGPU 实测；NMS/人数/unknown label/no bbox tests |
| P51 | camera cloud change gate 与 JPEG 限额 | integration | pass-targeted | 640×360/960×540 exact resolution、190KiB JPEG/256KiB Base64、privacy/background/no-person/unchanged/busy gate 与 ≤1 FPS trace；Cloud Camera 使用独立于 local frame generation 的单调 cloud generation，stop/restart 不回退；未上传真实帧 |
| P52 | cloud audio 不第二次打开麦克风 | integration | pass-targeted | shared microphone owner/store tests：canonical + cloud 只调用一次物理 start，独立 grant/lease/release，最后 subscriber 才停 track |
| P53 | echo gate 取消 cloud window | integration | pass-targeted | voice playback echo fixture + window controller：`echo-blocked` Abort，PCM/JPEG refs 一次性释放，canonical lane 不受影响 |
| P54 | 感知背压不阻塞 canonical transcript | performance | pass-targeted | cloud queue capacity=2/drop-oldest 压力下 canonical 1–5 全量顺序交付、0 drop；subscriber controller 相互独立 |
| P55 | Qwen completed JSON strict parsing/stale isolation | integration | pass-targeted | production gateway + completed-only fake Provider：exact correlation/model/generation、strict JSON/allowlist/schema；拒绝 Markdown、partial、extra instruction、跨 source event；尚未创建真实 Provider session |
| P56 | Flash→Plus 仅六种 reason 且完成后回落 | integration | pass-targeted | 六 reason route decisions、0.65 confidence、consent/cost/evidence、单 Plus in-flight、finish 回落 Flash 与 cooldown tests |
| P57 | Provider/network/rate/cost failure 无无限重试 | integration | pass-targeted | network/provider/rate 最多 3 次 1/2/4s bounded backoff；cost/permission/invalid-response 立即 terminal，无模型或 provider silent fallback |
| P58 | Minecraft identity/version/skew/replay 验证 | integration | pass-targeted | strict adapter fixtures、runtime identity/replay tests、暂停/恢复 generation isolation；插件 `perception.minecraft.structured` grant-ceiling test |
| P59 | Minecraft disconnect/unhealthy/stale 撤回事实 | integration | pass-targeted | fake channel、generation replacement、source-health、expiry clock、事实确认/纠正/清除 tests；真实 PCL/Fabric 客户端中已配对 Mod 的端到端门保持 `planned / external-acceptance-pending` |
| P60 | projection 仅含 fresh bounded 不可信陈述 | integration | pass-targeted | fixed projection + context provider TTL/prompt boundary tests |
| P61 | reaction/actuation 按用户决定关闭并保持 context-only | domain/integration | pass-targeted | 默认仅产生 context-only candidate；无 actuation、台词、TTS、工具或任意 motion/expression；quiet/cooldown/stop/cancel 与敏感事实拒绝 tests |
| P62 | 云 policy/readiness exact schema 且状态不含 secret | domain/integration | pass-targeted | cloud policy/control v0.4 固定日期化 privacy profile、中国内地、一个月服务日志、断连立即清除模型会话上下文、no-training/no-improvement/no-evaluation/no-human-review、逐会话独立授权、Flash/Plus、Camera Flash-only、failure/reaction；Eventa 双边校验，状态只含非敏感配置 ID、布尔 readiness/code/cost |
| P63 | 5/10/50 CNY 费用边界 | domain | pass-domain | 整数微元、Asia/Shanghai 日/月 bucket、session/day/month 超限前拒绝；导出只有 session/model/time/cost profile 元数据 |
| P64 | Qwen text-only Manual 协议与音频前置 | main integration | pass-targeted | fake socket 验证北京 URL/Bearer main-only、`modalities:[text]`、`turn_detection:null`、audio→image→commit→response.create；生产 `ws` factory 拒绝非 TLS/外域/额外 query/header/未知模型，关闭 redirect 并限制 64KiB 入站消息 |
| P65 | camera Plus、音频输出与 partial response 被拒绝 | main integration | pass-targeted | Camera 构造 Plus 失败；`response.audio.*` terminal；缺 `response.text.done` 的 `response.done` 整轮拒绝；Abort 关闭 socket |
| P66 | 云生产设置显示真实 readiness、政策与零上传状态 | browser/Electron | pass-device | 2026-07-28 production Electron，隔离 userData + 原生 CDP；444×592 无页面级横向溢出且可滚动到底；分别显示服务日志一个月、断连清除模型会话上下文、不用于训练/改进/评估或人工审阅、中国内地 Endpoint 不跨地域或跨境四项政策；独立 `camera-frame`/`microphone-audio` 授权可见；Workspace/API key/model 未配置时 fail-closed；点击验证后 idle / 0 facts / 无上传，未观察到 Qwen/DashScope socket；Camera 30 Hz 与 Screen 5 Hz 在本地/云面板同步且云上传上限 1 FPS。Browser Vitest 在 Chromium 启动前被环境 `spawn EPERM` 阻塞，不计为自动 browser pass |
| P67 | 真实 Qwen Provider 与逐会话 screen/camera/audio 授权 | real provider/device | planned / external-acceptance-pending | 日期化官方 policy evidence/readiness、准确的一月日志披露、真实付费 socket、费用、stop/revoke、generation、frame/audio stream 和 context end-to-end 证据；不得把断连清除上下文当作零日志留存 |
| P68 | Screen/Camera 云媒体生产接线与 owner-isolated revoke | integration | pass-targeted | renderer owner 独立 grant registry；Settings 关闭只撤销所属 grant；PCM/JPEG 定向 gateway、correlation、generation、stop/revoke tests；active stop、runner failure、Camera encoder error 与 Screen sample error 均进入先同步登记的 run/epoch-scoped retirement，替代会话等待旧 timer/frame subscription/encoder/PCM/microphone/capture/local lease 清理，同步状态回调重入和迟到错误不能越过屏障或覆盖替代状态 |
| P69 | 费用账本跨重启、跨预算与异常 fail-closed | main integration | pass-targeted | main-only 中国时区月账本；跨线已发生费用照常入账；损坏账本拒绝授权；仅保存模型/时间/session/金额元数据 |
| P70 | sparse keyframe 与长会话内存有界 | domain/integration | pass-targeted | Screen 最多 24 张、硬 TTL 4 分钟、stop/echo/failure/route complete 清零；facts 256、seen event IDs 1024、temporal keys 256 |
| P71 | 语音资源优先与云音频隔离 | integration | pass-targeted | listening/speaking 暂停 Local Screen VLM 和 Camera YOLO WebGPU，保留低成本 camera lane；Qwen delta/transcript 不进入 chat/TTS |
| P72 | 一键启动、根级门与 Desktop build | release | pass-device | `启动-AIRI.ps1 -DryRun`、快捷方式目标、root typecheck/lint、diff check、Desktop production build 通过 |

## 发布门

除 P01–P72 外，还必须通过 targeted tests、integration、component/browser、真实设备或真实 Provider 证据、根级 `pnpm typecheck` 和 `pnpm lint`；不得有未解决 P0/P1。P2 必须记录 owner、影响和后续计划。

2026-07-28 fresh evidence：Cloud lifecycle 4 files / 45 tests、Stage UI perception/Minecraft 36 / 206、Desktop perception 34 / 158、Core context 2 / 19、冻结 voice/chat 49 / 362、Minecraft service 37 / 324 全部通过；Desktop 与 Minecraft typecheck、Minecraft lint、根级 typecheck（52 workspace projects）、根级 lint（0 errors）、`git diff --check`、Desktop production build、`启动-AIRI.ps1 -DryRun` 均通过。Browser Vitest 在 Chromium 启动前被环境 `spawn EPERM` 阻塞；P66 由上述真实 production Electron 设备证据验收为 `pass-device`，不把未运行的 Chromium 测试计为通过。P67 真实付费 Qwen Provider 与真实 PCL/Fabric Provider 验收仍为 `planned / external-acceptance-pending`，因此整个 M3 不得标记 complete。Fabric Mod 为 client-only，可在单人世界验收；PCL/离线用户名/游戏服务器身份不构成 AIRI 授权。Cloud Camera 本地绑定代次与云 generation 已解耦，Screen/Camera 的四类生产终态均在同步外部回调前登记 retirement，替代会话等待旧资源清理并隔离迟到错误。官方尚未回答“各种日志”的精确载荷范围及能否缩短一个月留存，两项均为残余风险。
