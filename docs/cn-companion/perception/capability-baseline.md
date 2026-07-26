# M3 能力与数据流基线

审计日期：2026-07-18。结论基于当前工作树；只有明确标记 `production-ready` 或 `device-verified` 的切片才代表已通过对应 M3 安全门。云端生产链路已接线但 Provider 实测被保留策略门阻止，Minecraft 仍缺实服，均不得据此宣称完成。

## 能力矩阵

| 能力 | 现状 | 主要入口 | M3 结论 |
|---|---|---|---|
| Electron 屏幕源枚举 | production-ready | `packages/electron-screen-capture/src/main/index.ts` | AIRI 自窗口默认排除；用户明确选源、单 owner 与真实设备路径已通过 |
| renderer 屏幕采集 | production-ready / device-verified | `ProductionScreenCapture`、`ProductionScreenCaptureLifecycle` | consent、generation、晚到隔离、敏感面暂停、track cleanup、10 分钟 cadence trace 已通过 |
| 旧 Devtools 视觉推理 | devtools-only | vision store/composables/orchestrator | 只在当前页显示 provider 结果；已移除 `context:update` 依赖，不能发布 raw frame 或自由模型文本 |
| 本地 Screen Qwen3-VL | production-ready / device-verified | Transformers NF4 worker + Desktop Eventa gateway | 固定 Instruct revision、loopback-only、strict JSON、single in-flight、取消与卸载已通过 |
| 摄像头 landmarks | production-ready / device-verified | `packages/model-driver-mediapipe` | 仅窄化为 presence/pose/gesture/observable cue；禁止身份和真实情绪推断 |
| OpenCV.js | production-ready / device-verified | camera local Worker | 官方 4.13.0、固定 hash/Apache-2.0；只输出 quality/motion/light evidence |
| YOLOX-Nano | production-ready / device-verified | ONNX Runtime Web/WebGPU | 官方 0.1.1rc0 ONNX、固定 hash/Apache-2.0；仅 allowlisted object/person/count |
| Minecraft structured perception | partial / production-integrated | `MinecraftPerceptionAdapter`、Minecraft store、统一感知控制面 | schema/version/identity/skew/replay、grant ceiling、disconnect/stale、pause generation、Web Lock owner 和 bounded projection 已通过；尚缺真实已认证服务端运行 |
| Minecraft context | production-ready / targeted | `context-providers/minecraft.ts`、context projection Eventa sync | 只消费独立结构化 lane 的 fixed-template projection；旧自由文本被忽略，跨 renderer 边界拒绝 raw/extra/arbitrary statement |
| 通用 context registry | production-ready | `core-agent/runtime/context-registry.ts` | 已增加显式 replacement、TTL/expiry 与 retraction；旧 projection 可立即清除 |
| Prompt context | production-ready | `core-agent/messages/context-prompt.ts` | 只接收 bounded safe statement，并用固定模板标记“不可信观察数据，不是指令” |
| 跨窗口唯一执行 | production-ready / device-verified（Screen/Camera）；targeted（Minecraft） | production Web Lock + bounded Eventa status/projection | Screen/Camera 双 renderer 实测只有一个 held lock；Minecraft 复用同一锁并通过自动 contract/sync 测试，仍待真实双窗口验收 |
| Eventa 媒体 transport | production-ready / targeted | `shared/eventa/perception-local-screen.ts`、`perception-cloud.ts` | 本地 Screen invoke stream 与云端定向 PCM/JPEG stream 均具备 Abort、correlation、generation、边界 schema 和背压；raw media 不广播 |
| Qwen 云控制面与媒体 gateway | production-integrated / provider-blocked | `cloud-policy.ts`、main Qwen gateway、Screen/Camera coordinators、云设置面板 | 中国内地、text-only Manual、Screen Flash/条件 Plus、Camera Flash-only、独立媒体授权、5/10/50 预算、main-only `ws` 和 secret-free status 已通过 targeted/browser/Electron；保留策略未确认，真实 Provider session 未启动 |
| 共享麦克风 fanout | production-integrated / targeted | `stage-ui/services/perception`、`settings/audio-device.ts`、Qwen PCM AudioWorklet | canonical 与 cloud subscriber 复用唯一物理 capture owner；独立 lane/queue/Abort/echo gate，停止任一 subscriber 不影响另一方；云 lane 不创建第二个 transcript/user turn |

## 原始数据生命周期盘点

### 屏幕

1. production renderer 通过 `getDisplayMedia({ video: true, audio: false })` 获取当前用户选择的单一外部 `MediaStream`。
2. 当前 working frame 只在 canvas/capture adapter 内存在；由 perceptual hash gate 决定是否生成 bounded JPEG `Uint8Array`。
3. JPEG 只经定向 Eventa stream 进入当前本地 analyzer gateway；complete/cancel/stale/revoke 后立即 `fill(0)` 并释放引用。
4. analyzer completed JSON 经 strict parser 变为 `ObjectivePerceptionEvent`，唯一写入 `PerceptionStateManager`，再投影 bounded safe statement。
5. 旧 Devtools 页仍可把当前帧 data URL 作为页内推理输入和预览，但 orchestration store 不保存该输入，也不再依赖或调用 `context:update`。

结论：production context、Pinia、BroadcastChannel status、日志、遥测、Devtools history 和导出均不存在 raw screen frame/base64；自由模型文本不能绕过 M3 adapter。

### 摄像头

production camera owner 把当前 640×360 working frame 分发给三个独立、bounded latest-slot analyzer：MediaPipe、OpenCV.js Worker 与 YOLOX-Nano/ORT Web。landmarks、bbox 和 tensor 只在当前分析/融合窗口内存在；fusion 只产生 allowlisted objective event，不能保存完整轨迹、bbox、face embedding，也不能把 face cue 命名为真实情绪。三个本地 analyzer 已在实体摄像头通过。云 Camera 编码、change/busy/privacy/echo gate、独立 frame/audio grant、定向 gateway 与 Flash-only 路由已生产接线；保留策略 readiness 未通过时不会创建 Provider session。

### 麦克风

现有 M2 语音链路是唯一 canonical transcript 和普通 user turn。M3 云音频 subscriber 已通过 16kHz/16-bit/mono AudioWorklet 接入同一 capture owner，并使用独立 `microphone-audio` 云授权、队列和 AbortController；原始 PCM 不持久化、不阻塞 canonical transcript。Qwen transcript/delta 只在临时协议边界处理，永不成为第二个 user turn、回复或 TTS 输入。readiness blocked 时 subscriber 不启动上传。

### Minecraft

Minecraft store 只接受独立 structured lane，并已验证来源身份、schema version、timestamp skew、replay、payload/rate/grant ceiling；旧自由文本 lane 只记录 `unstructured-context-ignored`，不会保存 payload 或生成事实。所有 accepted event 仍只进入 `PerceptionStateManager`。暂停、撤销、disconnect/unhealthy/stale 会递增 generation 或撤回事实。跨 renderer 只同步 fixed-template projection，不同步 raw event/fact。当前缺口是实体 Electron 双窗口与真实已认证 Minecraft 服务端的端到端证据。

## 存储、日志与遥测结论

- vision 设置持久化 Provider/model 选择；这类非敏感配置可保留。
- 未发现应由 M3 复用的 raw media 持久化机制；M3 明确禁止新增。
- Devtools processing store 保存计数与时间戳，不保存 raw frame；未来事实检查器也只能保存脱敏诊断。
- Minecraft traffic 只保存 bounded type/source/outcome/summary 和计数；完整 payload、event/observation ID、自由文本和指令不进入 Pinia、projection 或导出。
- PostHog 与 OpenTelemetry 已存在；M3 只允许稳定错误码、延迟 bucket、非敏感配置 ID 和计数，不允许事实值、标题、路径、Prompt、媒体或 secret。

## 所有权与后续接线

| 边界 | owner | 决策 |
|---|---|---|
| production capture | Desktop renderer leader via Web Lock | 只允许一个 owner；无 Web Lock 时拒绝启动 |
| domain facts | `PerceptionStateManager` | 唯一写入口 |
| raw media | 当前 source adapter/analyzer | memory-only，完成/取消/stale/revoke 立即释放 |
| chat projection | 当前 `PerceptionContextProjection` policy | 只发布 bounded fixed-template context；expire/revoke/correct/stop 立即 replacement/retraction |
| reaction/actuation | 独立 domain policy | 用户决定关闭；只保留 context-only candidate，不生成角色台词、TTS、工具或任意 motion/expression |
