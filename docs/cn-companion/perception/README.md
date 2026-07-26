# M3 可信感知上下文

状态：M3 基础合同、生命周期、本地 Screen Qwen3-VL、本地 Camera MediaPipe/OpenCV.js/YOLOX-Nano、云端 Qwen Realtime 生产媒体链路、bounded context projection，以及 Minecraft 结构化 adapter/生产控制面已经接通。Screen/Camera 已通过真实设备门；云链路已通过 main/renderer/Eventa、组件和真实 Electron UI 的无费用验收，但因阿里云控制台最短保留/不训练选项尚未由用户确认而保持 fail-closed；Minecraft 仍缺真实已认证服务端验收。主动 reaction/actuation 按用户决定保持关闭和 context-only。外部门未通过前不得把局部通过扩大为整个 M3 complete。

合同版本：`perception/v0.3`。

## 生产数据边界

```text
显式授权
  -> PerceptionSession + 单 production owner
  -> 内存中的 EphemeralObservation
  -> 来源分析器
  -> ObjectivePerceptionEvent（严格 schema）
  -> PerceptionStateManager（唯一生产写入口）
  -> RuntimePerceptionFact / PerceptionStateSnapshot
  -> 后续独立的 context / reaction / stage policy
```

原始屏幕帧、摄像头帧、麦克风音频、完整 OCR、模型自由文本与 Minecraft 自由文本不得越过 analyzer/gateway 临时边界。现有 vision Devtools 路径不是生产 M3 路径。

## 当前实现

- `packages/stage-ui/src/domains/perception/contracts.ts`：冻结的运行时合同。
- `schemas.ts`：严格 Valibot 边界解析，拒绝未知字段。
- `policy.ts`：TTL、置信度、时间平滑、枚举值与来源可靠度的集中配置。
- `state-manager.ts`：事实接受、抑制、冲突、去重、过期、撤回和 snapshot。
- `session.ts`：授权顺序、generation 隔离、暂停/停止/撤销与幂等清理。
- `services/perception`：独立 PCM fanout lane、echo gate、单物理流的共享麦克风 lease、Screen/Camera window runner，以及 main-only Qwen text-only/Manual WebSocket gateway。生产 socket factory 已注入；screen-frame、camera-frame、microphone-audio 分别授权，readiness 未通过时零上传。
- Screen production：固定活动枚举、不可逆变化哈希、静止 0 FPS gate、敏感/自窗口抑制、单 in-flight/latest-frame，以及 Transformers NF4 Qwen3-VL 定向 Eventa gateway。
- Camera production：MediaPipe/OpenCV.js/YOLOX-Nano 三个独立 bounded analyzer，经时间融合后只提交 `ObjectivePerceptionEvent`。
- Minecraft production：已认证 module identity、strict schema/version/skew/replay/rate/grant ceiling、TTL/disconnect 撤回、暂停/恢复 generation 隔离。
- Context：Screen、Camera、Minecraft 只发布固定模板 `PerceptionContextProjection`；跨 renderer 仅同步 strict projection，raw fact、payload 和自由文本被 Eventa 边界拒绝。
- Presentation：统一 Screen/Camera/Minecraft 控制面、一键暂停、单源停止/撤销、持续指示、事实确认/纠正/清除和脱敏诊断。
- `owner.ts`：Web Lock 单 owner；不支持 Web Locks 时 fail closed。

## 当前发布边界

M3 只通过现有 M1 context registry 影响下一次普通对话；没有新增第二套聊天、TTS、记忆或工具链。Reaction/actuation 按用户决定关闭。2026-07-18 本地 targeted、component/browser、根级 typecheck/lint、diff check、Desktop build 和一键启动 DryRun 均通过。当前发布阻塞项只剩真实外部门：阿里云控制台没有保留开关，需官方支持书面确认 Realtime 媒体/响应保留期限后进行一次受控 Qwen Provider 验收；另需启动 PCL 世界并开放局域网后完成真实已认证 Minecraft 服务验收。

## 文档索引

- [能力基线](./capability-baseline.md)
- [隐私威胁模型](./privacy-threat-model.md)
- [事实目录](./fact-catalog.md)
- [Provider 基线](./provider-profiles.md)
- [Camera Local OpenCV / YOLO 选型门](./camera-local-selection.md)
- [Eventa 与 Electron 媒体传输 Spike](./transport-spike.md)
- [验收矩阵](../tests/perception-acceptance-v0.3.md)
