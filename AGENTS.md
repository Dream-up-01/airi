# Project AIRI Agent Guide

本文件是 `D:\Projects\airi` 下一阶段的唯一工作指导。当前阶段只包含：

- **M3：可信感知上下文（Trusted Perception Context）**

M0/M1、角色卡、非结构化角色设定导入，以及当前已经可用的语音与文本聊天链路，均视为冻结的上游基线。不得重新实现平行人格、聊天、语音、上下文历史或长期记忆系统；不得削弱 M1 的安全、真实性、关系边界、Prompt 优先级、角色卡导入导出和隐私保证。

M3 的交付目标不是“让模型看截图”，而是建立一条可解释、可过期、可撤销、可审计且默认隐私安全的感知数据平面。任何来源只有通过本文件规定的合同、状态管理、策略门和发布门，才能进入生产聊天上下文或触发可选反应。

---

## 1. 阶段目标、完成声明与工作原则

### 1.1 M3 产品目标

在用户明确授权时，AIRI 可以获得带来源、置信度、TTL、敏感级别和验证方式的当前情境事实，从而：

1. 区分用户大致在刷视频、玩游戏、写文档、写代码、浏览网页、聊天、会议或空闲。
2. 通过摄像头获得是否有人、粗粒度姿态/动作、可观察表情线索、白名单物体和环境线索。
3. 把 Minecraft 的结构化连接、状态、任务和危险信息转成可信游戏事实。
4. 在下一次正常对话中讨论仍然新鲜的事实。
5. 仅在用户单独 opt-in 后，对高显著变化给出低频、可取消、符合人设且通过现有安全链路的反应。
6. 在感知关闭、暂停、过期、低置信或来源异常时，不声称仍然看见用户、屏幕或游戏。
7. 让用户随时知道哪个来源正在采集、在哪里处理、是否上传云端、使用哪个模型以及如何停止。

### 1.2 非目标

M3 不实现：

- 人脸身份识别、用户身份追踪、生物特征模板或人物重识别。
- 从面部或姿态确定真实情绪、心理状态、健康状况、疲劳或欺骗。
- 摄像头/屏幕录制、回放、默认截图存档或长期行为画像。
- 默认完整 OCR、密码/验证码/支付/私聊内容提取。
- computer-use、自动点击、键鼠控制或屏幕操作代理。
- Minecraft 自主控制、路径规划、战斗策略或技能学习。
- 高级 Live2D/Spine/VRM 动画导演、精确 viseme 或全身动作映射。
- 长期记忆、跨设备画像、主动消息调度。
- 未经授权的后台监控、隐藏采集指示或静默云端 fallback。

### 1.3 完成声明规则

满足以下条件前不得标记 M3 complete：

- 所有 production-ready 来源通过合同、集成、组件/浏览器和真实设备或真实 Provider 验收。
- 屏幕、摄像头、Minecraft 均能产生 schema-valid、带 TTL/confidence/provenance 的事实；未接通的来源必须明确标记 planned/partial。
- 权限、持续指示、暂停、停止、撤销、generation 隔离和资源释放均有生产证据。
- 原始帧、原始音频、完整 OCR、自由模型输出和外部指令不进入 context、Pinia 持久化、日志、遥测或导出。
- 所有视觉分析器只能向 `PerceptionStateManager` 提交 `ObjectivePerceptionEvent`，不能直连聊天、LLM、TTS、Live2D、工具或记忆。
- 无未解决 P0/P1；P2 有 owner、影响和后续计划。
- targeted tests、integration、component/browser、人工证据、根级 `pnpm typecheck` 和 `pnpm lint` 全部通过。

---

## 2. 仓库基线与必须复用的实现

### 2.1 主要应用

- Desktop：`apps/stage-tamagotchi`，Electron、Vue 3、Vite、TypeScript、Pinia、VueUse、Eventa、UnoCSS、Vitest。
- Web：`apps/stage-web`，Vue 3、Vue Router、Vite、TypeScript、Pinia、VueUse、UnoCSS。
- Mobile：`apps/stage-pocket`，Vue 3、Capacitor、Kotlin、Swift。

### 2.2 主要共享包

- `packages/stage-ui`：stores、composables、chat/context、vision、voice、companion/card domains。
- `packages/stage-pages`：Desktop/Web 共用设置页和 Devtools 页面。
- `packages/stage-layouts`：共享布局、聊天和转写界面。
- `packages/model-driver-mediapipe`：现有本地 pose/hand/face landmarks 能力。
- `packages/electron-screen-capture`：Electron 屏幕/窗口源枚举和捕获。
- `packages/plugin-protocol`、`packages/server-sdk*`、`packages/server-shared`：跨模块事件和 `context:update` 等协议。
- `packages/i18n`：所有用户可见文本。
- `packages/ccc`：AIRI/CCv3 角色卡 schema、导入和导出。

### 2.3 必须复用的感知与上下文实现

- `packages/electron-screen-capture/`
- `apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts`
- `apps/stage-tamagotchi/src/renderer/pages/devtools/screen-capture.vue`
- `apps/stage-tamagotchi/src/renderer/pages/devtools/vision.vue`
- `packages/stage-ui/src/composables/vision/`
- `packages/stage-ui/src/stores/modules/vision/`
- `packages/model-driver-mediapipe/`
- `packages/stage-ui/src/stores/modules/gaming-minecraft.ts`
- `packages/stage-ui/src/stores/chat/context-providers/minecraft.ts`
- `packages/stage-ui/src/stores/chat/context-store.ts`
- `packages/stage-ui/src/stores/devtools/context-observability.ts`
- `packages/stage-pages/src/pages/devtools/context-flow/`
- `packages/core-agent/src/runtime/context-registry.ts`
- `packages/core-agent/src/messages/context-prompt.ts`

现有语音链路继续提供唯一 canonical transcript 与普通 user turn。云端多模态感知可以订阅同一个本地麦克风源，但只能输出客观感知事件，不能成为第二路转写、回复或音频生成链路。

### 2.4 已有能力与已知缺口

已有能力：

- Electron 屏幕源枚举与 `getDisplayMedia`。
- Devtools 屏幕捕获和视觉推理。
- vision workload、Provider/model 选择、ticker 和结果发布。
- MediaPipe pose/hand/face landmarks 基础。
- Minecraft module registry、health、`context:update` 和 traffic 可见性。
- chat context registry、Prompt projection 和 context observability。

必须修复的结构性缺口：

- 当前视觉路径可能把 image data URL 和自由模型文本发到 `context:update`；生产接线必须彻底移除 raw image。
- 当前视觉输出缺少统一 schema、TTL、置信度、敏感级别、冲突、撤回和 Prompt injection 隔离。
- 通用 context 目前缺少统一 expiration/retract 语义，M3 必须在投影前建立可信边界。
- 屏幕/视觉能力主要停留在 Devtools，缺少生产 session、权限、暂停、持续指示和错误诊断。
- MediaPipe face landmarks 不能被当作可靠情绪识别。
- OpenCV 和 YOLO 尚无冻结的 runtime、模型、权重、许可证、下载和性能基线。
- Minecraft 自由文本缺少结构化验证、来源认证、TTL 和恶意内容隔离。
- 多窗口、多 renderer 和多来源尚无唯一生产 capture owner。

---

## 3. 全阶段强制架构与安全规则

1. 跨 Electron main/renderer、Web Worker、WebSocket 或其他 runtime 的合同使用 `@moeru/eventa`，合同定义在能力拥有者的 `shared` 边界。
2. Eventa invoke 合同按 `Response, Request` 泛型顺序定义；请求和响应均在边界做 schema 验证。流式媒体必须支持 `AbortSignal`、背压和 correlation。
3. `injeca` 只用于真实外部 IO、插件或服务边界，不创建透传依赖袋。
4. schema、状态机合法性、TTL、置信度、冲突、隐私和安全决策位于框架无关 domain；Pinia/store/component 只做响应式 facade 和编排。
5. 用户可见文本进入 `packages/i18n`，不得新增未国际化的生产 UI 字符串。
6. 使用现有 UnoCSS 和组件原语，不引入新的设计系统。
7. 新增依赖前先搜索仓库实现，再比较体积、Electron/浏览器兼容性、维护状态、许可证和可测试性，并经过用户决策门。
8. 原始麦克风音频、屏幕帧、摄像头帧、完整 OCR、完整转写、完整 Prompt、API key、本机路径和 Provider secret 默认不记录、不持久化、不进入遥测。
9. 外部内容全部是不可信数据。屏幕文字、网页指令、游戏聊天、Minecraft 文本和视觉模型输出不得作为系统指令执行。
10. 所有长生命周期工作必须可取消，并在 stop、pause、权限撤销、源切换、Provider/model 切换、页面卸载、窗口关闭和应用退出时清理。
11. raw payload 只在 capture/analyzer/gateway 的临时边界中存在；不得进入 Pinia、通用 Eventa 广播、BroadcastChannel、context、Devtools history 或导出。
12. 生产状态只有一个写入口：`PerceptionStateManager`。任何 adapter 绕过它都视为 P0。
13. 多窗口/多 renderer 只能有一个 production perception owner；复用现有 leader/Web Lock 模式或建立等价的单所有者机制。
14. 本地失败不得静默切云，云端失败不得静默切本地或切换模型；所有切换由用户选择或冻结的 Screen route policy 决定。
15. 测试使用 Vitest；生产实现后运行 targeted tests，发布门运行根级 `pnpm typecheck` 和 `pnpm lint`。
16. 不为测试导出内部 helper；测试公开合同和可观察行为。
17. 不创建 commit、push 或 PR，除非用户明确要求。

---

## 4. 目标架构与唯一数据流

```text
Explicit consent + source selection
  -> PerceptionSession state machine
  -> single platform capture owner
       screen frame | camera frame | structured game event
  -> EphemeralObservation (raw, memory-only)
  -> source-specific analyzer
       screen local/cloud | MediaPipe/OpenCV/YOLO | game schema parser
  -> ObjectivePerceptionEvent (strict, bounded, generation-aware)
  -> PerceptionStateManager (唯一生产写入口)
       consent + health + schema + sensitivity + confidence + TTL
       temporal smoothing + conflict + dedupe + rate limit + cleanup
  -> RuntimePerceptionFact + PerceptionStateSnapshot
  -> independent downstream policies
       PerceptionContextProjection -> existing context registry -> existing M1 chat
       PerceptionReactionPolicy -> optional low-frequency candidate
       StageActuationPolicy -> bounded StageActuationIntentLite
  -> existing checked assistant text -> existing speech output
```

### 4.1 摄像头与共享麦克风数据流

```text
Explicit camera consent + persistent indicator
  -> SharedMicrophoneCaptureOwner (single getUserMedia/AudioWorklet)
       -> AudioFanoutHub
            -> canonical local transcript subscriber
            -> Qwen cloud perception subscriber (separate cloud-audio grant)
  -> CameraCaptureOwner
       -> local working frames (adaptive, memory-only)
       -> cloud candidate frames (change-gated JPEG)
  -> Local lane
       MediaPipe + OpenCV + YOLO
  -> optional Cloud lane
       bounded real PCM + selected JPEG frames
       -> directed Eventa stream
       -> Electron main/provider gateway
       -> Qwen Realtime WebSocket, text-only response
  -> strict completed-response parser
  -> ObjectivePerceptionEvent[]
  -> PerceptionStateManager
```

### 4.2 分层与建议目录

| 层 | 建议位置 | 责任 | 明确禁止 |
|---|---|---|---|
| Domain | `packages/stage-ui/src/domains/perception/` | 合同、状态机、TTL、冲突、策略、registry、snapshot | Vue、Electron、网络、媒体 IO |
| Wire contract | `apps/stage-tamagotchi/src/shared/eventa/` 或能力拥有者共享包 | Eventa request/response/stream 合同与 wire-safe schema | Provider secret、Vue state、raw media 广播 |
| Application | `packages/stage-ui/src/stores/perception*`、orchestrator | session 编排、domain facade、来源协调、下游接线 | 重新定义 domain 语义 |
| Platform | Desktop main/renderer、capture composables | 权限、MediaStream、窗口源、生命周期、单 owner | Prompt、事实判断、人格决策 |
| Provider | screen/camera/game adapters、Qwen gateway | 外部协议、推理、窄化解析、脱敏错误 | 直写 context、说话、工具、记忆 |
| Presentation | `packages/stage-pages`、`packages/stage-ui` 组件 | 设置、指示、事实检查器、诊断 | 保存 raw 内容、决定安全语义 |

共享 wire schema 如果也供插件或外部模块使用，放入 `packages/plugin-protocol`；不得在应用和协议包复制两套语义。domain 对 wire schema 的转换必须显式且可测试。

---

## 5. 领域合同冻结清单

合同必须先于生产来源接线完成。名称可按仓库风格微调，但以下语义不得删除。

### 5.1 `PerceptionSession`

- `sessionId`
- `state`: `idle | requesting-permission | running | paused | stopping | failed | stopped`
- `enabledSources`: `screen | camera | minecraft`
- `activeSourceIds`
- `processingMode`: `local-only | cloud-approved | mixed`
- `generation`
- `startedAt`、`updatedAt`
- `lastErrorCode`

非法迁移返回稳定错误码。stop、revoke、source/model switch 必须递增 generation，使所有旧 observation、request、response、fact 和 candidate 失效。

### 5.2 `PerceptionConsentGrant`

- `grantId`
- `sourceKind`、`sourceId`
- `processingMode`
- `allowedModalities`
- `allowedFactCategories`
- `cloudProviderId`、`cloudModelId`，仅配置 ID
- `regionId`、费用边界的非敏感配置 ID
- `grantedAt`、`revokedAt`
- `showPersistentIndicator`

屏幕、摄像头和麦克风分别授权。`camera-frames`、`screen-frames`、`microphone-audio` 必须分别列出。角色卡、模型输出、网页内容和插件不能开启或扩张授权。

### 5.3 `EphemeralObservation`

- `observationId`、`sessionId`、`generation`
- `sourceKind`、`sourceId`
- `capturedAt`、monotonic timestamp
- `payloadKind`: `screen-frame | camera-frame | microphone-audio-chunk | multimodal-window | game-event`
- 仅运行时 raw payload reference

处理完成、取消、timeout、generation stale 或授权撤销后立即释放引用。

### 5.4 `ObjectivePerceptionEvent`

- `eventId`、`observationId`、`sessionId`、`generation`
- `sourceKind`: `screen-local | screen-cloud | camera-local | camera-cloud | minecraft`
- `analyzers`: 受控配置 ID 列表
- `eventType`: allowlisted enum
- `phase`: `started | updated | ended | observed`
- `subject`: `primary-user | other-person | environment | allowlisted-object | game-session`
- `value`: allowlisted enum、boolean、有界数字或有界客观摘要
- `confidence`: `0..1`
- `observedAt`、`expiresAt`
- `verification`: `direct-signal | multi-frame-inferred | cloud-inferred`
- `sensitivity`、`provenance`

第一版事件类型至少包括：

- `screen.activity.observed`
- `screen.app-class.observed`
- `screen.task-summary.observed`
- `screen.window-relation.observed`
- `screen.capture-health.changed`
- `person.presence.changed`
- `person.count.observed`
- `person.pose.observed`
- `person.gesture.observed`
- `person.observable-cue.observed`
- `person.activity-like.observed`
- `environment.lighting.observed`
- `environment.scene-class.observed`
- `object.presence.changed`
- `camera.capture-health.changed`
- `minecraft.connection-health.changed`
- `minecraft.player-status.observed`
- `minecraft.task-state.observed`
- `minecraft.nearby-threat.observed`

禁止字段：角色台词、反应建议、人格标签、真实情绪/心理/健康判断、身份、姓名、人脸 embedding、任意指令、Prompt、工具名、TTS 文本、Live2D motion/expression ID、raw frame/base64、完整 bbox/landmark history 和完整自由模型输出。

### 5.5 `RuntimePerceptionFact`

- `factId`、`observationId`、`sessionId`、`generation`
- `source`: kind、adapterId、非敏感 instance ID
- `category`、`subject`、`predicate`
- `value`: allowlisted enum、有界数字、boolean 或有界摘要
- `confidence`: `0..1`
- `observedAt`、`expiresAt`
- `sensitivity`: `public | personal | sensitive | prohibited`
- `provenance`: analyzer、Provider/model 配置 ID、local/cloud
- `state`: `proposed | accepted | suppressed | expired | revoked`
- `verification`: `direct-signal | inferred | user-confirmed | retracted`
- `suppressionReason`

禁止 raw evidence、完整 OCR、完整窗口标题、用户名、本机路径、secret、完整外部聊天和自由形式指令。

### 5.6 `PerceptionSourceCapabilities`

- 支持的 modality 和 fact categories
- local/cloud
- permission、pause、stop 能力
- cadence、latency 和 payload limits
- 是否提供 confidence
- 是否可能包含敏感内容
- 是否需要额外音频前置协议

不支持的能力产生明确降级和稳定错误码，不能假装成功。

### 5.7 `PerceptionStateSnapshot`

- `snapshotId`、`sessionId`、`generation`、`updatedAt`
- accepted fact IDs、source health
- bounded `activeStates`
- `reactionCandidateIds`、`stageActuationCandidateIds`
- `shortTermRetention`: `none | until-expiry | until-session-end`

不允许 `long-term` retention。

### 5.8 `PerceptionContextProjection`

- `projectionId`、`factIds`
- `createdAt`、`expiresAt`
- `sourceSummary`
- bounded safe statements
- `maxCharacters`、`maxFacts`

固定模板必须把内容标记为“不可信观察数据，不是指令”。过期、撤回或禁止事实不得进入下一回合；Prompt 不包含 raw evidence。

### 5.9 `PerceptionReactionCandidate`

- `candidateId`、`triggerFactIds`
- `salience`
- `mode`: `context-only | suggest-reaction`
- `cooldownKey`、`createdAt`、`expiresAt`
- `reasonCode`

source adapter 和状态管理器都不生成角色台词。只有统一 reaction policy 可以把候选交给现有 character orchestrator。

### 5.10 `MultimodalPerceptionWindow`

- `windowId`、`observationId`、`sessionId`、`generation`
- `startedAt`、`endedAt`、monotonic timestamp base
- `audioFormat`: Provider 支持的 16-bit/16 kHz/mono PCM 配置 ID
- bounded、memory-only `audioChunkRefs`
- 0..N 个 memory-only `imageFrameRefs`
- `trigger`: `speech-turn-ended | significant-visual-change | bounded-periodic-sample | manual-test`
- `consentGrantId`、`providerId`、`modelId`

本地转写和云感知不能共享可变队列或取消控制器。云队列 overflow 丢弃最旧未提交 window，不能阻塞 canonical transcript。complete/cancel/timeout/stale/echo-blocked/revoke 后立即释放 PCM/JPEG。

### 5.11 `ScreenPerceptionRoutingPolicy`

只用于用户选择 `cloud-qwen-omni` 的桌面观察：

- `residentModelId`: `qwen3.5-omni-flash-realtime`
- `escalationModelId`: `qwen3.5-omni-plus-realtime`
- `resolution`: `1280x720`
- `normalFpsMax`: `0.2`
- `activeFpsMax`: `1.0`
- `outputMode`: `text-encoded-objective-json`
- `confidenceEscalationThreshold`: `0.65`
- `historyLookback`: `120000..240000ms`

允许的 Plus reason 只有：

- `flash-low-confidence`
- `consecutive-conflict`
- `complex-multi-window-relation`
- `temporal-process-reasoning`
- `user-requested-process-analysis`
- `tool-relevance-uncertain`

`ScreenModelRouteDecision` 至少包含 decision/session/generation、from/to model、reason、evidence fact IDs、created/expires、consent grant 和脱敏费用计数。模型只能输出证据，不能自行切换；domain policy 在 consent、schema、generation、cooldown 和 cost guard 通过后才创建 decision。

Plus 不是常驻第二连接。升级时暂停新 Flash request，只允许一个 Plus in-flight；完成、失败、取消或超时后回落 Flash。最近 2–4 分钟只保留结构化状态和最多 24 张 memory-only sparse keyframes，raw keyframe TTL 不超过 4 分钟。

### 5.12 `LocalScreenAnalyzerProfile`

- `profileId`、`adapterId`、`generation`
- `modelId`: `Qwen/Qwen3-VL-4B-Instruct`
- `runtimeKind`: `ollama | vllm | transformers-service`
- 非敏感 revision、quantizationId、deviceClass
- `targetResolution`: `1280x720`
- `normalFpsMax`: `0.2`、`activeFpsMax`: `1.0`
- `state`: `unconfigured | stopped | starting | validating | ready | degraded | failed | stopping`
- capabilities、lastErrorCode、脱敏 latency/resource summary

`ScreenAnalyzerSelection.mode` 只允许 `off | local-qwen3-vl | cloud-qwen-omni`，三者互斥。切换必须先 stop/cancel 旧 generation、释放 raw frames/请求并撤回旧 source facts。

---

## 6. 状态管理与策略算法

### 6.1 唯一写入顺序

所有来源统一执行：

```text
consent
-> source health
-> session/generation
-> schema and bounds
-> event allowlist
-> sensitivity
-> confidence threshold
-> TTL
-> temporal smoothing
-> conflict/dedupe
-> rate limit
-> fact registry
-> snapshot/publication
```

任何一步失败都产生稳定、脱敏的 `suppressionReason`，但不得记录 raw value 或模型自由文本。

### 6.2 时间平滑与 started/updated/ended

- 每个有状态 predicate 使用集中配置的进入阈值、退出阈值、最小持续时间和最大缺失窗口。
- 单帧证据默认不能产生 gesture/activity 的 `started`；要求多帧或多 analyzer 支持。
- `updated` 只在 value、confidence bucket 或关键 provenance 变化时发布。
- `ended` 由明确反信号、持续缺失、track ended、source stop 或 TTL 到期产生。
- 迟到结果先检查 generation，再检查 observation timestamp；旧结果不得覆盖当前状态。
- 使用 fake clock 验证抖动、TTL、pause、stop 和 stale isolation。

### 6.3 冲突优先级

硬撤销、权限撤销、track ended 和用户明确纠正优先级最高。其余冲突按以下证据组合做确定性评分：

1. direct local signal 高于 cloud inference。
2. 新鲜证据高于接近过期的证据。
3. 多帧一致高于单次推断。
4. 高置信且已校准的 analyzer 高于低置信来源。
5. 环境/活动语义可以由云端补充，但不能覆盖明确的 local absence 或 capture failure。

冲突不能把两个自由文本拼进 Prompt；失去胜出的事实保留脱敏 suppression reason。

### 6.4 TTL 默认值

| 来源 | 允许事实 | 默认 TTL |
|---|---|---|
| Screen local/cloud | activity、app class、bounded task summary、capture health | 15–30 秒 |
| Camera MediaPipe | presence、head/pose/hand action、observable cue | 2–5 秒 |
| Camera OpenCV | motion/change、frame quality、lighting、capture health | 1–5 秒 |
| Camera YOLO | allowlisted person/object presence、person count | 2–10 秒 |
| Camera cloud | activity-like、scene class、bounded object relation | 3–10 秒 |
| Minecraft | connection、player/task state、nearby threat、location class | 5–30 秒 |

具体阈值集中在 domain 配置中，不散落在组件。`smile-like cue`、`eyes-closed cue`、`head-down pose` 仅是可观察描述，不等同真实情绪或健康判断。

### 6.5 Context projection

- `prohibited` 永不投影。
- `sensitive` 默认不投影；只有用户当前明确询问且策略允许时，才可投影本地处理的有界事实。
- 按 relevance、freshness、salience 排序，并限制 fact 数量和总字符数。
- 使用固定句式，不透传网页、游戏聊天或模型指令。
- source disconnect、用户纠正、fact expire/revoke 后立即替换或撤回通用 context registry 中的旧 projection。
- 没有 fresh fact 时，现有真实性策略必须阻止“我看到你正在……”一类陈述。

### 6.6 Reaction 与 Stage actuation

- 默认 `context-only`。
- 主动反应单独 opt-in，按来源和事实类别设置 cooldown、quiet mode 和每小时上限。
- 只有 fresh、accepted、高置信、高显著且非敏感事实可创建 candidate。
- 状态管理器只发布 candidate；reaction policy 决定是否交给现有角色编排，现有安全链路决定最终台词。
- Live2D 只消费独立 actuation policy 生成的有界 `StageActuationIntentLite`。
- Qwen JSON、YOLO label、MediaPipe gesture 不能直接映射任意 motion/expression ID。
- stop、quiet mode、用户说“别看了”时立即取消 candidate、未开始输出和 actuation intent。

---

## 7. Provider、模型与来源固定方案

### 7.1 Screen 本地方案

- 产品显示名：`Qwen3-VL-4B（本地）`。
- 语义模型 ID：`Qwen/Qwen3-VL-4B-Instruct`；Thinking 版或同名文本模型不能替代。
- 先验证仓库现有 `vision-ollama` 的多图、尺寸、取消和 strict structured-output 能力。
- 验证失败后再比较 WSL2/vLLM 与独立 Transformers service；任何新增 runtime、依赖、权重下载或量化选择先过用户决策门。
- 服务只绑定 loopback，默认不随应用启动；只有用户点击“验证并设为桌面观察模型”后 lazy-start/load。
- 只接收 memory-only screen frame 和固定客观 schema；不接收麦克风、角色 Prompt、聊天历史或工具 schema。
- 单 in-flight + latest-frame slot，busy 时覆盖旧帧，不排队追赶。
- stop、切换、验证失败、空闲卸载和 app exit 时取消请求并释放模型资源。
- profile 记录 revision、hash、license、quantization、runtime/version、device class、显存/内存峰值、首帧和稳态延迟；UI 不显示绝对路径或设备序列号。

### 7.2 Screen 云端方案

- 常驻 `qwen3.5-omni-flash-realtime`，仅按六个 allowlisted reason 临时升级 `qwen3.5-omni-plus-realtime`。
- 分辨率固定 `1280x720`。
- 桌面稳定时每 5–10 秒至多一次，即 `normal <= 0.2 FPS`。
- 窗口切换或显著变化时短时 `active <= 1 FPS`；稳定后回落。
- 完全静止时 0 FPS；不得以心跳名义持续上传图片。
- 用户明确询问当前屏幕或过程时可绕过 cadence 等待，但仍需通过敏感页、授权、busy 和费用检查。
- 只请求 text-only objective JSON；禁用模型音频、WebSearch 和有副作用的 Function Calling。
- Flash/Plus completed text 都经过大小限制、完整 JSON、strict schema 和 generation 检查；delta 只临时组装。
- Plus 单 in-flight，Flash 暂停新请求；失败不循环重试，不把旧 Flash 结论冒充 Plus。
- Screen 授权必须覆盖屏幕帧、协议要求的真实云麦克风音频、地区、模型、Plus 条件升级和费用边界。

### 7.3 Camera 本地方案

- MediaPipe：presence、pose、hands、head/face observable cue。
- OpenCV：resize/color、模糊/遮挡/低光质量、motion/change、optical-flow region、稳定化和云帧 JPEG 预处理。
- YOLO：allowlisted person/object class、person count 和临时 detection evidence。
- 三个 analyzer 分别单 in-flight、bounded latest-frame slot 和 timeout；不得复制长期 frame buffer。
- 输出先做时间窗口融合，不保存 landmark/bbox/轨迹历史。
- 第一版禁止人脸识别、person re-identification、身份 tracking 和未知标签直通。
- OpenCV runtime、YOLO 模型家族/权重/runtime/license/hash/下载体积必须先做选型报告并由用户批准。

### 7.4 Camera 云端方案

- allowlist：`qwen3.5-omni-flash-realtime | qwen3.5-omni-plus-realtime`。
- 默认 Flash，Plus 只能由用户显式选择；Camera 不使用自动升级或故障 failover。
- 默认 `640x360`，用户可选 `960x540`。
- change gate 后最多 `1 FPS`；无人、静止、后台、quiet/privacy mode 或 busy 时跳帧。
- JPEG 编码前建议不超过 190KB，Base64 后必须不超过 256KB；超限时降质量、降分辨率或丢弃。
- 必须分别确认摄像头帧和真实麦克风音频上传、地区、Workspace/model 配置、费用和保留策略。
- 只请求 text output，固定指令只允许返回 Objective Event JSON。
- 不启用模型音频、人格扮演、联网搜索、工具执行或第二路对话。

### 7.5 Qwen Realtime 协议边界

- 实现前重新核对官方文档、模型 ID、地区、会话限制、限流、价格和数据策略，时间点事实不得永久硬编码。
- 协议要求图像前已有真实音频输入；不得发送伪静音，不得第二次打开麦克风，不得沿用本地麦克风授权推定云上传授权。
- 使用 Manual response control，由 orchestrator 在显著变化或受控窗口结束时请求 text-only response。
- Qwen transcript/delta 不进入 chat/history，不创建 user message，不回答用户，不生成音频。
- assistant 播放、echo tail 和系统回放期间，云音频 subscriber 复用现有 echo gate 丢弃音频并取消未提交 window。
- 共享采集不等于共享生命周期：停止一个 subscriber 不影响另一个；最后一个 subscriber 停止后才结束 track。
- 网络背压只能丢弃感知 lane 的旧 window，不能阻塞 canonical transcript。
- 会话在当前模型时长/轮次限制前主动轮换；rate limit、网络故障或费用 guard 时 bounded backoff，最终降为 local-only/off，不形成无限费用循环。

### 7.6 Minecraft 方案

- 从 module registry、health 和 schema-valid game event 生成事实。
- 结构化字段优先；自由文本仅作为 untrusted bounded summary。
- 验证 source identity、schema version、timestamp skew 和 replay；拒绝伪造来源。
- disconnect、unhealthy、stale 时立即过期相关 facts。
- 上层合同与 Mineflayer/Fabric 等具体 runtime 解耦。
- 只观察和讨论，不增加自主控制；现有命令和工具继续走原有权限。

### 7.7 实现前 Provider 基线复核

以下内容是 2026-07-13 已核对的时间点基线，只用于指导 spike 和验收设计；开始真实实现、下载权重或产生云费用前，必须重新核对官方文档和用户控制台，不能永久硬编码：

- Qwen Realtime allowlist 为 `qwen3.5-omni-flash-realtime | qwen3.5-omni-plus-realtime`，两者支持文本、音频、图片和视频输入；M3 只启用 text output。
- WebSocket 图片使用 `input_image_buffer.append`；官方基线建议 480P/720P、约 1 张/秒、Base64 后单张不超过 256KB，并要求图片前至少发送过一次真实音频。
- 当前公开单会话最长 120 分钟。Flash Realtime 基线包含 80 音频轮、50 视频轮、480 秒音频和 120 秒视频；Plus Realtime 包含 100 音频轮、50 视频轮、600 秒音频和 240 秒视频。实现应在限制前主动轮换，而不是等待服务端断开。
- 中国内地公开限流基线为 60 RPM / 100,000 TPM；实际限制、价格、地区和数据策略以用户 Workspace 控制台为准。
- Qwen Realtime 官方参考：`https://help.aliyun.com/zh/model-studio/realtime`、`https://help.aliyun.com/zh/model-studio/omni/`、`https://help.aliyun.com/en/model-studio/rate-limit`。
- 本地语义模型固定为 `Qwen/Qwen3-VL-4B-Instruct`。官方基线提供 Transformers、vLLM 和 SGLang 路径；2026-07-13 文档基线为 `transformers >= 4.57.0`、vLLM 部署 `vllm >= 0.11.0`，实际实现时重新确认。
- Qwen3-VL 官方参考：`https://github.com/QwenLM/Qwen3-VL`、`https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct`。

复核输出写入 `provider-profiles.md`，至少记录文档核对日期、模型 ID、地区、协议版本、session/rate limits、价格来源、数据保留、runtime 版本和与冻结产品策略的差异。发现差异时先停止真实接线并提交决策，不通过猜测或 silent fallback 兼容。

---

## 8. Eventa 跨运行时实现指南

### 8.1 合同位置与方向

- session start/stop/pause/status、permission result 和小型结构化事件定义在能力拥有者的 `shared/eventa` 边界。
- Electron main 和 renderer 从同一合同模块导入，禁止复制字符串事件名和 payload 类型。
- invoke 合同使用 `defineInvokeEventa<Response, Request>` 的响应优先泛型顺序。
- 只在 renderer 发起、main 消费的操作使用定向合同，减少错误监听面。

### 8.2 控制面与数据面分离

- 控制面：session、grant、source selection、health、cancel、generation；允许通过常规 Eventa invoke/event。
- 数据面：PCM/JPEG 只允许定向 client-streaming 或 bidirectional streaming 进入当前 gateway。
- 高频原始帧不得广播到通用 Eventa、WebSocket topic、BroadcastChannel 或 Devtools。
- gateway 返回 audio/image acknowledgement、objective completed text、error、complete 和 cancel；renderer 不接触 API key 或 Workspace secret。

### 8.3 取消、背压和关联

- stream request 带 `sessionId`、`generation`、`observationId/windowId` 和 monotonic timestamp base。
- producer、main consumer、Provider WebSocket 和结果 parser 共享取消传播，但各 subscriber 使用独立 `AbortController`。
- stop、revoke、switch、echo gate、unmount 和 exit 必须同时取消 producer/consumer/socket/pending response。
- IPC 二进制复制和背压必须先做 spike，记录吞吐、复制次数、峰值内存和 stop latency。
- 若 Electron IPC 不满足指标，先提交受控二进制 transport 方案供用户批准，不能绕开共享合同和权限语义。

### 8.4 边界验证与错误

- renderer 入站、main 入站、Provider completed text 和插件事件分别做 strict schema 验证。
- partial/delta 不得修改状态。
- 解析失败整批抑制，不用宽松正则猜测，不从 Markdown/代码块中“抢救”JSON。
- 错误仅保留稳定 code、phase、provider/model 配置 ID、duration 和 correlation ID；删除 secret、路径、原文和 raw payload。

---

## 9. 实施路线与依赖图

```text
M3.0 audit/threat/data inventory
  -> M3.1 contracts + fixtures freeze
      -> M3.2 state manager + policy gate
      -> M3.3 session/consent/single-owner lifecycle
          -> M3.4 Eventa/media transport spike + AudioFanoutHub
          -> M3.5 Screen capture/change scheduler
               -> M3.6 Screen local Qwen3-VL
               -> M3.7 Screen cloud Flash/Plus
          -> M3.8 Camera local MediaPipe/OpenCV/YOLO
               -> M3.9 Camera cloud Qwen
          -> M3.10 Minecraft + plugin adapters
      -> M3.11 context/reaction/actuation integration
      -> M3.12 settings/indicator/observability
  -> M3.13 integration, real-device acceptance, docs, release gate
```

M3.0 和无生产写入的协议 spike 可以并行；任何生产 adapter 必须等待 M3.1 合同冻结。所有来源最终由同一个 state/policy owner 集成，避免三套冲突和 TTL 语义。

---

## 10. 详细工作包

### M3.0 基线、威胁模型与数据清单

创建或更新：

- `docs/cn-companion/perception/README.md`
- `docs/cn-companion/perception/capability-baseline.md`
- `docs/cn-companion/perception/privacy-threat-model.md`
- `docs/cn-companion/perception/fact-catalog.md`
- `docs/cn-companion/perception/provider-profiles.md`
- `docs/cn-companion/tests/perception-acceptance-v0.3.md`

实施方式：

1. 枚举 screen/camera/microphone/Minecraft 每种 raw 数据从创建到释放的所有位置。
2. 标记 production/devtools/test/planned，不把 Devtools 演示当生产能力。
3. 搜索 `data:image`、base64、`context:update`、日志、Pinia persist 和 telemetry，记录潜在泄漏路径。
4. 列出权限、Provider、地区、模型、预算、依赖和许可证的未决项。
5. 记录当前 capture、context registry、vision workload 和 leader/single-owner 可复用点。

退出条件：数据流图、威胁清单、事实目录、现状矩阵和未决决策均有 owner；没有未分类 raw 数据路径。

### M3.1 合同、状态机与测试夹具冻结

实施位置：`packages/stage-ui/src/domains/perception/`，必要 wire-safe schema 放共享协议边界。

实施方式：

1. 实现第 5 节全部合同、稳定 ID/error/suppression reason 和 schema parser。
2. 实现 session 合法迁移与 generation helper。
3. 建立 fake clock、fake source、fake analyzer、malicious payload 和 stale response fixtures。
4. 为 event/value/summary 设置大小、枚举、时间和置信度边界。
5. 生成合同版本号；消费者显式依赖该版本。

测试：合法/非法迁移、边界数值、未知字段、恶意文本、过大 payload、时间倒退、旧 generation、序列化 round-trip。

退出条件：纯 domain tests 通过，合同无 Vue/Electron/Provider 依赖，Integration Owner 宣布 contract freeze。

### M3.2 `PerceptionStateManager` 与策略门

实施方式：

1. 实现 proposed → accepted/suppressed → expired/revoked 生命周期。
2. 实现 upsert、dedupe、conflict、temporal smoothing、expire、revoke、source cleanup 和 snapshot。
3. 集中 event thresholds、TTL、source reliability 和 sensitivity policy。
4. 用 fake clock 驱动 deterministic expiration，不依赖组件 timer 语义。
5. 对用户确认/纠正提供公开命令，但不训练身份画像。

测试：多来源冲突、single-frame 抖动、started/updated/ended、TTL、撤销、用户纠正、source failure、同 ID 重放、迟到结果和 bounded snapshot。

退出条件：所有 accepted fact 都能追溯到 schema-valid objective event；所有拒绝都有稳定 reason；不存在绕过 manager 的测试入口。

### M3.3 Consent、session、单 owner 与全局停止

实施方式：

1. 屏幕、摄像头、Minecraft 分别启用和撤销。
2. 摄像头、屏幕默认不在应用重启后自动恢复；只持久化安全枚举和非敏感配置 ID。
3. 建立 production owner election；非 owner renderer 只读状态，不打开 track。
4. 严格顺序：request permission → grant/deny → start capture；禁止先采集后补授权状态。
5. pause 后停止创建 observation，并立即撤回/过期相关事实。
6. permission denied/revoked、track ended、source disappeared、window close、app exit 统一走 idempotent cleanup。

测试：拒绝、撤销、重复 start/stop、owner 切换、窗口关闭、应用退出、pause/resume、source ended 和 `<500ms` 停止新捕获目标。

退出条件：持续指示与真实 capture 状态一致；最后一个 owner/subscriber 退出后无 track、timer、request 或 fact 残留。

### M3.4 Eventa transport spike 与 `AudioFanoutHub`

实施方式：

1. 先用 fake PCM/JPEG 验证 renderer → main 定向 streaming、AbortSignal 和 correlation。
2. 实测 Electron IPC 二进制复制、队列峰值、背压、丢帧和取消延迟。
3. 实现唯一 `SharedMicrophoneCaptureOwner` 与引用计数 `AudioFanoutHub`。
4. canonical transcript subscriber 和 cloud perception subscriber 使用独立队列、格式化、backpressure 和 controller。
5. 接入现有 playback echo gate，阻止 assistant/system audio 进入云 observation。
6. Provider secret 只在 main/gateway；renderer 只持有配置 ID。

测试：单次 `getUserMedia`、双 subscriber 时间轴、停止任一 lane 不影响另一 lane、最后一个停止结束 track、云背压不影响本地处理、echo gate、revoke/switch/unmount 全链取消。

退出条件：transport spike 有量化报告；无 raw media 广播；失败不阻塞现有语音与聊天链路。

### M3.5 Screen capture、change gate 与生产基础

实施方式：

1. 复用 Electron screen source enumeration/capture，让用户明确选择窗口或屏幕。
2. 默认排除 AIRI 自窗口，检测自反馈并抑制。
3. 建立本地 change detector、敏感页 gate、busy/latest-frame scheduler。
4. activity enum 固定为 `video | game | document | code | browser | chat | meeting | idle | unknown`。
5. active app/page 只保留类别，默认删除窗口标题、用户名和完整 OCR。
6. 提供互斥 `off | local-qwen3-vl | cloud-qwen-omni` 选择；切换递增 generation 并撤回旧 facts。

测试：多屏/窗口、AIRI 自反馈、快速切换、静止、最小化、敏感页、source ended、busy drop 和 analyzer switch。

退出条件：不接任何模型时，capture 生命周期、change gate、单 owner、调度和 cleanup 已独立通过。

### M3.6 Screen 本地 Qwen3-VL vertical slice

实施方式：

1. 做 hardware/runtime spike，优先验证现有 Ollama 路径。
2. 按用户批准的 revision/quantization/runtime 下载并校验 hash/license。
3. 实现 loopback-only health、准确 model/revision 验证、lazy start、idle unload 和 crash guard。
4. 固定 prompt 只描述客观事件 schema；strict JSON parser 禁止 thinking trace、GUI action、点击坐标、tool call 和 Markdown。
5. 使用 `1280x720`、normal/active 上限、单 in-flight/latest-frame；资源竞争时降频或暂停。
6. completed event 标记 `sourceKind=screen-local` 和本地 provenance。

测试：断网 local-only、无麦克风、无云连接、模型身份校验、错误模型拒绝、取消、timeout、低配 degraded、资源释放、恶意输出整批抑制。

退出条件：真实硬件通过前只标 planned；通过后 UI 才显示 ready/production-ready。

### M3.7 Screen 云端 Flash/Plus vertical slice

实施方式：

1. 实现 Flash resident session 和第 5.11 节确定性 routing policy。
2. normal、active、static 和 user-request cadence 分支全部由 domain scheduler 决定。
3. 实现 consent/cost/cooldown/single-flight/route-generation guard。
4. 维护 bounded structured state + 最多 24 张 sparse keyframes；TTL 到期或 route 结束立即释放。
5. Plus 启动时暂停 Flash 新请求；完成或失败后关闭 Plus 并回落 Flash。
6. 只将 completed strict JSON 转成 `screen-cloud` objective event。

测试：六个 reason 逐一触发、非 allowlist 不触发、恶意“升级”文本无效、费用 guard、cooldown 合并、Plus 单 in-flight、Flash/Plus 迟到响应、static 0 FPS、route cleanup。

退出条件：Flash 和 Plus 均通过 mock/contract；真实 Provider 按模型记录地区、授权、费用、延迟和结果，未实测不能标 ready。

### M3.8 Camera 本地 MediaPipe/OpenCV/YOLO vertical slice

实施方式：

1. 先完成 OpenCV/YOLO dependency、权重、license、hash 和性能选型并获用户批准。
2. 建立唯一 `CameraCaptureOwner`、自适应内部 cadence 和 analyzer scheduler。
3. MediaPipe、OpenCV、YOLO 各自输出受控 intermediate evidence，再由 local fusion 转为 objective event。
4. gesture/pose 使用多帧时间窗口、hysteresis 和 confidence threshold。
5. 环境只保留 lighting、indoor/outdoor-like、workspace-like、person count 和有限物体关系。
6. 禁止保存 frame、landmark、bbox 和轨迹历史。

测试：无人/进入/离开、挥手、低头、静止、多人无身份、unknown label、低光、模糊、遮挡、剧烈运动、analyzer unavailable/degraded、busy/drop/timeout。

退出条件：三段本地栈均有真实设备证据；缺任一段只能标 partial。

### M3.9 Camera 云端 Qwen vertical slice

实施方式：

1. 模型由用户显式选择 Flash 或 Plus；切换关闭旧 socket、递增 generation 并丢弃旧结果。
2. 复用第 M3.4 工作包的 cloud audio subscriber，不新增麦克风采集。
3. change gate 后生成 `640x360` 或 `960x540` JPEG，执行 byte-size 和 1 FPS hard cap。
4. 构建 bounded `MultimodalPerceptionWindow`，按 observation/source 保持音画时间关联。
5. Manual control 请求 text-only completed response；strict parser 转成 `camera-cloud` event。
6. modality 缺失、grant revoke、费用 guard 或协议错误时关闭 cloud lane，保留可用本地 lane。

测试：两模型合同、分辨率、大小限制、drop-oldest、partial/delta、invalid JSON、恶意字段、模型切换、网络慢/断线/rate-limit、无授权零上传、echo gate 和全链取消。

退出条件：两个模型 mock/contract 通过；逐模型真实验收未完成时明确 unverified，不显示 production-ready。

### M3.10 Minecraft 与插件外部来源

实施方式：

1. Minecraft adapter 只消费 schema-valid 结构化事件和认证 source identity。
2. 插件通过现有 protocol 声明 `context-source`/perception capability 和 grant lifecycle。
3. host 强制 schema version、payload size、rate、timestamp skew、replay protection 和 permission ceiling。
4. revoke/disconnect 后停止接收并撤回全部 source facts。
5. adapter 只能生成 objective event，不能直写 Prompt 或调用工具/TTS。

测试：伪造 identity、恶意文本、超大 payload、时间穿越、重复 event、grant escalation、disconnect/stale 和 runtime 替换。

退出条件：上层合同不依赖具体 Minecraft runtime；恶意来源无法越过 host ceiling。

### M3.11 Context、reaction 与 actuation 集成

实施方式：

1. 用 bounded `PerceptionContextProjection` 接入现有 context registry。
2. 为 expire/revoke/correct 实现显式 replacement/retraction，消除旧 `[Context]` 残留。
3. 默认仅 context-only；主动反应设置单独 consent、cooldown、quiet mode 和 cancel。
4. candidate 经现有 character/M1 链路生成文本，不增加平行人格/安全系统。
5. actuation policy 只产生有限状态与 emotion hint，不接受 provider motion ID。

测试：fresh fact 下一回合可用、过期后不可用、Prompt injection、敏感事实、用户纠正、重复 activity、quiet mode、停止取消和不存在 direct analyzer side effect。

退出条件：关闭全部感知后不能再产生 perception projection、reaction 或 actuation；文本仍通过现有安全策略。

### M3.12 设置、持续指示与可观测性

设置页至少显示：

- 每个来源 `off/requesting/running/paused/error`。
- 当前源、local/cloud、Provider/model、分辨率和实际/目标 cadence。
- Screen 互斥选择、Local revision/runtime/quantization/ready/degraded、Flash/Plus route reason/cooldown/keyframe count/分项费用。
- Camera MediaPipe/OpenCV/YOLO readiness、in-flight/drop/latency；云模型、地区、分辨率、JPEG 大小和上传上限。
- 麦克风状态明确区分 local transcript subscriber 与 Qwen cloud subscriber，并显示唯一 capture owner。
- 持续采集指示、一键暂停全部、单源停止、云上传说明、授权撤销。
- accepted facts、confidence、age、TTL、source 和 suppression reason；不显示 raw frame 或自由模型输出。
- 用户确认、纠正、清除事实和清除本次 session。
- 最近脱敏错误、capture/inference/fact/suppression 数量和延迟摘要。

所有文本进入 i18n。Devtools 可以显示更详细的脱敏 provenance，但不能默认显示截图、OCR、PCM、完整响应、路径或 secret。

退出条件：UI 状态来自真实 session/capture/provider 状态而非按钮本地状态；刷新、切页和错误后仍一致。

### M3.13 集成、真实验收、文档与发布门

实施方式：

1. 建立 Screen、Camera、Minecraft、跨源融合、projection 和 reaction fake integration harness。
2. 建立设置、指示、pause/stop、纠正、隐私和错误 component/browser tests。
3. 按第 12 节验收矩阵执行真实屏幕、摄像头、Provider 和 Minecraft 测试。
4. 记录日期、branch/commit、配置 ID、处理模式、非敏感 timings、费用、expected/forbidden、fact evidence 和人工判断。
5. 更新 capability baseline，严格区分 production/devtools/test/planned。
6. 完成 root typecheck/lint、隐私复审和 P0/P1 清零。

退出条件：第 15 节完成标准全部满足，最终审查清单逐项有证据。

---

## 11. 资源、降级与清理指标

- Screen/camera inference 不无界重叠；busy 时 drop/replace old frame。
- Local VLM 至多一个 in-flight 和一个 latest-frame slot。
- Camera 每个 analyzer 至多一个 in-flight，不复制长期 frame buffer。
- Cloud sampler 最多保留一个待发送 JPEG；网络慢覆盖旧帧。
- Screen Flash/Plus 同一时刻只有允许的单 route；Plus active 时不发新 Flash request。
- 本地推理复用 vision workload/资源压力信号；与现有 ASR/TTS/GPU 冲突时降 cadence 或暂停，不能造成饥饿、OOM 或设备重置。
- Provider timeout、GPU/CPU 压力、窗口最小化、source ended、rate limit 和费用 guard 都有稳定降级状态。
- stop 后目标 `<500ms` 停止新 capture；所有 track、timer、request、window、socket、frame ref 和 fact cleanup 均需实测。
- 本地不可用保持 off/degraded/unknown，不静默切云。
- 云端不可用回到仍获授权且真实可用的 local-only，或明确 off；不伪报成功。
- 自动重连 bounded，stop/revoke 永远优先；不得形成无限请求或费用循环。

---

## 12. 验收矩阵

`docs/cn-companion/tests/perception-acceptance-v0.3.md` 至少记录以下项目。每项必须包含 setup、source、Provider/model、processing mode、expected、forbidden、fact/timeline evidence、latency、result 和 manual notes；截图只能作为辅助，不能代替合同证据。

### A. Session、授权与生命周期

1. 屏幕、摄像头权限同意、拒绝、撤销。
2. 单源 start/pause/resume/stop 与 pause-all。
3. track ended、source 消失、窗口关闭、app exit 的资源清理。
4. 多 renderer 只产生一个 production owner。
5. stop 后 `<500ms` 不再创建 observation。
6. grant revoke 后 Eventa stream、WebSocket、raw refs 和 facts 全部终止/撤回。
7. 应用重启不自动恢复屏幕/摄像头采集。
8. 持续指示与真实 capture/cloud-upload 状态一致。

### B. Screen 基础、本地与云端

9. 视频、游戏、文档、代码、浏览器、聊天、会议、空闲分类。
10. 快速切换应用的去抖和 TTL。
11. AIRI 自窗口反馈抑制。
12. Prompt injection 网页不能改变 schema、路由或下游行为。
13. 密码、验证码、支付和私聊敏感页抑制。
14. Local 准确加载 `Qwen/Qwen3-VL-4B-Instruct` 并校验 revision/hash/license/runtime/quantization。
15. Local 断网运行、不打开麦克风、不连接非 loopback endpoint。
16. Local `1280x720`、单 in-flight/latest-frame、timeout/drop/degraded cadence 和资源释放。
17. Local 对 thinking trace、GUI action、点击坐标、tool call、Markdown、超长输出整批抑制。
18. Cloud Flash `1280x720`、稳定 5–10 秒最多一次、显著变化最多 1 FPS、静止 0 FPS、用户询问立即提交。
19. 六个 Plus reason 分别触发，所有非 allowlist reason 不触发。
20. Plus consent/cost/cooldown/single-flight、Flash pause、完成/失败/超时后回落。
21. 最多 24 张 sparse keyframes、2–4 分钟 TTL、stop/revoke/route complete 全清理且无持久化副本。
22. Flash/Plus generation 隔离，迟到响应不能覆盖当前状态。
23. `tool-relevance-uncertain` 只复核客观事实，不能调用或授权工具。
24. local/cloud/off 切换取消旧请求、撤回旧 facts、释放资源且不 fallback。

### C. Camera 本地与云端

25. 无人在场、进入/离开、多人但无身份追踪。
26. 挥手、低头、静止的 started/updated/ended 去抖。
27. `smile-like cue` 等可观察描述不变成真实情绪判断。
28. OpenCV 低光、模糊、遮挡、剧烈运动和无变化 gate。
29. YOLO allowlisted person/object、未知标签抑制、无 re-identification。
30. MediaPipe/OpenCV/YOLO 任一 unavailable/degraded 的明确状态和融合行为。
31. 云端 `640x360`/`960x540`、JPEG 大小、1 FPS hard cap、busy drop-oldest。
32. Flash/Plus 手动切换关闭旧 WebSocket、递增 generation、无自动升级/failover。
33. completed JSON 正常解析；partial、Markdown、额外字段、错误 enum、低置信、恶意指令整批抑制。
34. local-only 断网持续工作，cloud failure/timeout/rate-limit/cost guard 不破坏本地 lane。

### D. 共享麦克风与 Qwen 协议

35. 只创建一个 MediaStream/AudioWorklet，两个 subscriber 收到同一时间轴数据。
36. 停止任一 subscriber 不影响另一 subscriber；最后一个停止才结束 track。
37. 未获 cloud-audio 和对应 frame grant 时零上传，不发送伪静音。
38. 云感知 transcript/delta 不进入 chat/history/LLM/TTS；completed JSON 只产生 objective event。
39. 网络背压、断线和 bounded reconnect 不影响 canonical transcript 延迟与完整性。
40. assistant 播放、echo tail 和系统回放被 gate，不产生用户行为事实。
41. 模型/Provider 切换后旧音频、图片、response 和 generation 不混入新会话。
42. 关闭本地语音交互但保留云感知时，云麦克风指示持续可见；关闭云感知不误停仍在使用的本地 subscriber。

### E. Minecraft、插件与恶意来源

43. Minecraft fresh structured status 和 TTL。
44. disconnect/unhealthy/stale 后撤回事实。
45. 恶意文本、伪造 identity、重复 event、时间 skew 和 replay 被拒绝。
46. 插件 payload size/rate/schema/grant ceiling 和 revoke cleanup。
47. runtime 替换不改变上层 fact 合同。

### F. State、context、reaction 与安全隔离

48. objective event 只能进入 `PerceptionStateManager`，analyzer 无法直连任何下游副作用。
49. 多来源冲突按 direct/fresh/confidence/reliability 确定性解决。
50. fresh fact 在下一回合可用；expire/revoke/correct 后不再出现。
51. 感知关闭后不再声称“看见”。
52. Prompt projection 不执行屏幕、游戏或模型文本中的指令。
53. 主动反应 opt-in、cooldown、quiet mode、取消和重复抑制。
54. Stage actuation 有界，Provider 不能指定任意 motion/expression。
55. 敏感/prohibited 事实的投影与反应限制。
56. facts、events、candidates 均不写入角色卡或长期记忆。

### G. 性能、隐私与发布回归

57. raw frame/base64/PCM/OCR/完整响应不存在于 context、Pinia、logs、telemetry、Devtools history 和导出。
58. Screen/camera workload 与现有本地 ASR/TTS 并行时无语音饥饿、OOM、设备重置或无界队列。
59. capture/inference/drop/suppression/latency/费用诊断与真实行为一致且无敏感内容。
60. M1 companion/prompt/safety、角色导入、文本聊天和现有语音链路回归通过。
61. targeted、integration、component/browser、真实设备/Provider、root typecheck/lint 全部有证据。

---

## 13. 安全与隐私威胁清单

实现和验收必须覆盖：

1. 屏幕 Prompt injection 和网页/游戏聊天伪造系统指令。
2. VLM 幻觉、低置信事实被说成确定事实。
3. stale fact、迟到 generation 和来源断连后的 false perception。
4. AIRI 捕获自身造成反馈循环。
5. 密码、验证码、支付、私聊、API key、本机路径泄漏。
6. 摄像头隐蔽采集或权限撤销后继续工作。
7. identity/biometric 数据意外创建或持久化。
8. Minecraft/插件来源伪造、重放和恶意自由文本。
9. 高频 capture/上传/升级造成资源、隐私或费用失控。
10. 高频主动反应打扰用户。
11. raw image/audio/base64 进入 context、logs、telemetry 或导出。
12. 共享麦克风授权被误解为云上传授权。
13. 二次打开麦克风、设备争用或采集指示不一致。
14. 云 transcript/delta 成为第二个 user turn 或回复。
15. 网络背压、重连或模型切换阻塞 canonical transcript。
16. assistant audio/echo 被解释为用户事件。
17. 云音频仍上传但 UI 指示消失。
18. 模型 JSON 夹带台词、人格、工具、TTS 或 Live2D 指令。
19. OpenCV/YOLO 权重来源、hash、版本或许可证不可追踪。
20. 多 analyzer 推理堆积和旧帧覆盖新状态。
21. 1 FPS 被误实现为强制持续上传。
22. objective summary 被下游当成控制指令。
23. 恶意文本诱导无限 Flash→Plus 升级。
24. Flash/Plus 并行或 route generation 错误覆盖状态。
25. sparse keyframe ring 被实现为录屏或持久化截图历史。
26. `tool-relevance-uncertain` 被当作工具授权。
27. change detection 抖动长期维持高 cadence。
28. 本地服务绑定非 loopback 或向远程 endpoint 发送帧。
29. 权重路径、设备信息、缓存位置和错误栈进入日志/遥测。
30. 本地失败静默切云。
31. 本地视觉模型与现有模型争用导致 OOM/驱动重置。
32. Visual Agent/GUI action 输出被误当可执行动作。

---

## 14. 验证分层与证据格式

### 14.1 每个工作包

1. 新增/修改 domain 的 targeted Vitest。
2. 相关 package typecheck。
3. 目标文件 ESLint。
4. `git diff --check`。
5. 明确记录未运行的真实 Provider/人工测试。

### 14.2 集成门

- perception contracts/state/policy tests。
- source adapter/provider contract tests。
- context prompt、M1 safety 和 character import 回归。
- 现有文本聊天、语音与播放回归。
- component/browser tests。
- Electron CDP 或人工证据。
- root `pnpm typecheck`。
- root `pnpm lint`。

### 14.3 真实验收记录

每条记录必须包含：

- 日期、branch/commit 和构建方式。
- source、处理模式、Provider/model/revision 的非敏感配置 ID。
- consent、region、费用上限和实际费用。
- 输入场景的脱敏描述。
- expected 与 forbidden。
- objective event/fact/snapshot/timeline 证据。
- capture、first-result、steady-state、stop latency 和 drop count。
- 结果、人工 notes 和已知限制。

不得记录 secret、raw content、完整窗口标题、截图历史、本机路径或完整模型响应。

---

## 15. 用户决策门

以下事项必须先取得用户批准：

1. 屏幕或摄像头帧发送到云端。
2. 真实麦克风音频发送到 Qwen Realtime；本地麦克风权限不等于云上传授权。
3. 云 Provider、地区、Workspace、API key 配置、模型、数据保留和费用上限。
4. Screen 的 Flash 常驻、六类 Plus 条件升级和整体费用边界；超出 reason、预算、地区、模型或上传内容时重新确认。
5. Screen 本地 runtime、revision、量化、权重来源/license/hash、下载体积、安装位置、资源上限和新增依赖。
6. OpenCV runtime、YOLO 模型家族、权重、推理 runtime、许可证、hash 和下载体积。
7. Camera 选择 Flash 或 Plus；模型变化重新展示能力、费用和数据边界。
8. 是否启用主动情境反应；默认 context-only。
9. 任何 OCR、敏感页面识别、截图保存、长期事实持久化；默认禁止。
10. 任何新依赖、模型下载、新云来源、上传内容扩大或预算提高。

用户已经批准的范围不需要在每个内部调用重复询问，但任何权限扩大都必须重新确认。

---

## 16. 多人/多 Agent 协作协议

### 16.1 总体原则

- 一个文件同一时间只有一个写入者。
- 共享合同先冻结，消费者后接线。
- 高频冲突文件由 Integration Owner 单点修改。
- Review Agent 默认只读，收到明确 fix assignment 才写文件。
- 禁止 `git reset --hard`、`git checkout --`、`git clean`、删除或覆盖他人修改。
- 未经用户明确要求，禁止暂存、切分支、创建 commit、push、PR 或改写历史。
- 禁止整仓格式化和与任务无关的批量 rewrite。
- 不得因为测试失败而回退不属于自己 scope 的文件。

### 16.2 角色与文件所有权

| 角色 | 责任 | 默认独占区域 |
|---|---|---|
| Integration Owner | 依赖裁决、热文件接线、最终验证 | `AGENTS.md`、主页面、Provider 注册表、共享 i18n 合并 |
| Contract Owner | 合同、状态机、fixture、版本冻结 | `domains/perception`、必要 wire contract |
| State/Policy Owner | state manager、gate、projection、reaction | registry/policy/context 专属模块 |
| Screen Owner | capture、change scheduler、local/cloud routing | Screen 专属模块与测试 |
| Local VLM Owner | Qwen3-VL runtime、validation、resource guard | Local VLM adapter 与测试 |
| Camera Local Owner | capture、MediaPipe/OpenCV/YOLO、fusion | Camera local 模块与测试 |
| Qwen Cloud Owner | Eventa gateway、AudioFanout、Realtime protocol | shared/main gateway、cloud adapter 与测试 |
| Game/Plugin Owner | Minecraft 与 plugin capability | adapter/protocol 专属模块与测试 |
| UI Owner | 设置、指示、事实检查器 | 新增 Vue 组件；i18n 由 Integration Owner 合并 |
| QA/Privacy Owner | fixtures、威胁测试、真实验收、只读审计 | tests/docs |

高冲突热文件包括：

- `apps/stage-tamagotchi/src/renderer/pages/index.vue`
- `packages/stage-ui/src/components/scenes/Stage.vue`
- `packages/stage-ui/src/stores/providers.ts`
- `packages/stage-ui/src/stores/chat.ts`
- `packages/stage-ui/src/stores/chat/context-store.ts`
- `packages/stage-ui/src/stores/modules/vision/orchestrator.ts`
- `packages/plugin-protocol/src/types/events.ts`
- `packages/i18n/src/locales/en/*.yaml`
- `packages/i18n/src/locales/zh-Hans/*.yaml`
- 根和 workspace `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`

只有 Integration Owner 或当前登记的唯一 owner 修改热文件；其他实现者在新模块中完成并提交最小接线说明。

### 16.3 任务认领

开始前：

1. 运行 `git status --short`，识别既有修改。
2. 声明 task ID、scope、预计文件、依赖和禁止触碰区域。
3. 没有实时协作工具时，在 `docs/cn-companion/workstreams/<task-id>.md` 创建独立 claim。
4. 等合同 freeze 或 owner 确认后再消费。
5. 必须修改热文件时暂停写入，向 Integration Owner 提交最小接线请求。

claim 格式：

```md
# <task-id>
- Owner:
- Status: claimed | active | review | complete | blocked
- Scope:
- Files:
- Depends on:
- Contract version/commit:
- Verification:
- Handoff notes:
```

### 16.4 交接与审查

交接必须包含结果、修改文件、合同变化、验证命令、未运行测试、隐私/费用/权限影响和最小接线步骤。

Review 分级：

- P0：敏感数据泄漏、未授权采集、绕过 M1、工具副作用、analyzer 直连下游、破坏主链。
- P1：stale fact、停止不生效、资源泄漏、错误 Provider 上传、generation 混入、关键状态不可达。
- P2：非阻塞体验、性能、可诊断性或文档缺陷。

P0/P1 修复后必须由不同 reviewer 或 Integration Owner 复审，不能由作者自行关闭。

---

## 17. 下一阶段推荐执行顺序

严格按以下顺序启动；每一步只有满足退出条件才进入依赖它的生产接线：

1. 完成 M3.0 数据清单、现状审计和威胁模型。
2. 完成 M3.1 合同/fixture，冻结 v0.3 contract。
3. 完成 M3.2 state manager、TTL、冲突、撤销和 snapshot。
4. 完成 M3.3 consent/session/single-owner，先用 fake source 验证完整生命周期。
5. 完成 M3.4 Eventa transport 与 AudioFanout spike，形成是否可直接复用 Electron IPC 的结论。
6. 完成 M3.5 Screen capture/change gate，不接模型先验收调度和清理。
7. 并行推进 M3.6 Local Screen runtime spike 与 M3.7 Cloud Screen contract/gateway；先 mock 后真实 Provider。
8. 提交 OpenCV/YOLO 选型报告并等待用户批准，再实施 M3.8 Camera local。
9. 在共享麦克风和 camera local 稳定后实施 M3.9 Camera cloud。
10. 独立实施 M3.10 Minecraft/plugin adapter，并只通过冻结合同集成。
11. 在至少一个 source vertical slice 通过后接 M3.11 context；reaction/actuation 最后开启且默认 off。
12. 完成 M3.12 生产设置、持续指示和 observability。
13. 执行 M3.13 全矩阵验收、隐私复审、root typecheck/lint 和发布审查。

第一批实际编码范围应限制为 M3.0–M3.3：它们不需要新增模型依赖或真实云费用，却为所有后续来源建立共同可信边界。不得从 UI 或 Provider demo 倒推 domain 合同。

---

## 18. 最终审查清单

- 用户是否明确知道哪个来源正在采集、在哪里处理、是否上传云端？
- raw frame/audio/OCR/外部文本是否始终留在临时边界？
- 每个 fact 是否有 source、confidence、TTL、sensitivity、verification 和 provenance？
- stale、low-confidence、conflicting、revoked fact 是否被抑制或撤回？
- 屏幕、游戏和模型文本能否注入 Prompt 或诱导模型升级？
- Screen Cloud 是否满足 Flash 常驻、固定 cadence、静止零上传、用户询问即时 observation 和六类 Plus reason？
- Plus 是否 consent/cost/cooldown/single-flight/generation 安全并在结束后回落？
- sparse keyframes 是否 bounded、memory-only、TTL 后彻底释放？
- Screen Local 是否准确使用指定 Instruct 模型、loopback-only、验证后 lazy-start、无麦克风/云上传？
- local/cloud/off 是否互斥、切换后旧 request/fact/resource 清理且不 fallback？
- Camera Local 是否真实经过 MediaPipe + OpenCV + YOLO，并避免身份和心理推断？
- Camera Cloud 是否只在帧与音频分别授权后上传，并满足模型、分辨率、大小、FPS 和 change gate？
- 是否只有一个麦克风 capture owner，subscriber 独立停止/背压，云模型永不创建第二个 transcript/user turn/回复？
- assistant audio、旧 generation、partial/invalid JSON 是否被正确 gate？
- 所有 analyzer 是否只能输出 objective event 到 state manager？
- 感知关闭、暂停、过期后是否不再声称“看见”？
- 主动反应是否 opt-in、低频、可取消并通过现有安全链路？
- source/provider/unmount/exit 后是否无 track、timer、request、socket、raw ref、fact 和 candidate 残留？
- UI、文档和 capability matrix 是否描述真实生产能力，而不是目标或 Devtools 能力？
- 第 12 节验收、P0/P1 清零、root typecheck/lint 和真实证据是否全部完成？

只有本清单和对应证据全部通过，才能标记 M3 complete。
