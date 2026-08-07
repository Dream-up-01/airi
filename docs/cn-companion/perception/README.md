# M3 可信感知上下文

状态：`production-integrated / external-acceptance-pending`。M3 基础合同、生命周期、本地 Screen Qwen3-VL、本地 Camera MediaPipe/OpenCV.js/YOLOX-Nano、云端 Qwen Realtime 生产媒体链路、bounded context projection，以及 Minecraft 结构化 adapter/生产控制面已经接通。Screen/Camera 已通过真实设备门；云链路已通过 main/renderer/Eventa、组件和真实 Electron UI 的无费用验收。2026-07-27 阿里云官方售后已书面确认：服务日志留存一个月、断连立即清除模型会话上下文、数据不用于训练/改进/评估或人工审阅、中国内地 Endpoint 不跨地域或跨境；这些事实已进入 cloud policy/control v0.4，readiness 证据标记可以按该日期化 Profile 配置，但真实付费 Provider 验收仍未执行。Minecraft 真实 PCL/Fabric Provider 验收仍为 `planned / external-acceptance-pending`。主动 reaction/actuation 按用户决定保持关闭和 context-only。外部门未通过前不得把局部通过扩大为整个 M3 complete。

合同版本：核心事实/授权合同 `perception/v0.3`；云 policy/control `perception-cloud-policy/v0.4`、`perception-cloud-control/v0.4`；云 grant 仍为 `perception-cloud-grant/v0.3`。

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
- `services/perception`：独立 PCM fanout lane、echo gate、单物理流的共享麦克风 lease、Screen/Camera window runner，以及 main-only Qwen text-only/Manual WebSocket gateway。生产 socket factory 已注入；screen-frame、camera-frame、microphone-audio 分别授权，所有 readiness 与逐会话 grant 未通过时零上传。mixed session 中 local grant 仍保持 `local-only`，云 `camera-frames` 与 `microphone-audio` 各自使用独立 `mixed` grant，不能互相扩张授权。云 v0.4 状态明确区分一个月服务日志留存与断连清除模型会话上下文。Screen/Camera 启动链路贯通 `AbortSignal`；Cloud Camera 把单调云 generation 与本地 frame generation 分离，stop/restart 不会回退；Local Camera active teardown 使用穷尽式 cleanup，单个 timer/analyzer/callback 失败不会阻止其余资源释放、事实撤回和 projection 清空。
- Screen production：固定活动枚举、不可逆变化哈希、静止 0 FPS gate、敏感/自窗口抑制、单 in-flight/latest-frame，以及 Transformers NF4 Qwen3-VL 定向 Eventa gateway。
- Camera production：MediaPipe/OpenCV.js/YOLOX-Nano 三个独立 bounded analyzer，经时间融合后只提交 `ObjectivePerceptionEvent`。
- Minecraft production：已认证 module identity、strict schema/version/skew/replay/rate/grant ceiling、TTL/disconnect 撤回、暂停/恢复 generation 隔离。
- Context：Screen、Camera、Minecraft 只发布固定模板 `PerceptionContextProjection`；跨 renderer 仅同步 strict projection，raw fact、payload 和自由文本被 Eventa 边界拒绝。
- Presentation：统一 Screen/Camera/Minecraft 控制面、一键暂停、单源停止/撤销、持续指示、事实确认/纠正/清除和脱敏诊断。
- `owner.ts`：Web Lock 单 owner；不支持 Web Locks 时 fail closed。

## 当前发布边界

M3 只通过现有 M1 context registry 影响下一次普通对话；没有新增第二套聊天、TTS、记忆或工具链。Reaction/actuation 按用户决定关闭。2026-07-28 fresh verification：Cloud lifecycle 4 files / 45 tests、Stage UI perception/Minecraft 36 / 206、Desktop perception 34 / 158、Core context 2 / 19、冻结 voice/chat 49 / 362、Minecraft service 37 / 324 全部通过；Desktop 与 Minecraft typecheck、Minecraft lint、根级 typecheck（52 workspace projects）、根级 lint（0 errors）、`git diff --check`、Desktop production build 和 `启动-AIRI.ps1 -DryRun` 均通过。Browser Vitest 在 Chromium 启动前被本机 `spawn EPERM` 阻塞；其缺口由真实 production Electron 的隔离 userData + 原生 CDP 设备验收覆盖 UI 路径，但不冒充 Chromium 自动测试通过。444×592 设置窗口无页面级横向溢出且可滚动到底；四项阿里云政策文案、独立 `camera-frame`/`microphone-audio` 授权均可见；Workspace/API key/model 未配置时 fail-closed，点击验证后仍为 idle / 0 facts / 无上传，且未观察到 Qwen/DashScope socket；Camera 30 Hz 与 Screen 5 Hz 在本地/云面板同步显示，云上传上限为 1 FPS。Cloud Camera 的本地绑定代次与单调云 generation 已显式解耦；Screen/Camera active stop、runner failure、Camera encoder error 与 Screen sample error 均进入先同步登记的 run/epoch-scoped retirement，替代会话必须等待旧 timer、frame subscription、encoder、PCM、麦克风、capture/local lease 清理；同步状态回调重入与迟到错误不能越过屏障或覆盖替代状态。当前发布阻塞项只剩真实外部门：P67 保持 `planned / external-acceptance-pending`，需要使用准确的一月服务日志披露和逐 modality 授权执行一次有界、付费 Qwen Provider 验收；Minecraft 也保持 `planned / external-acceptance-pending`，需启动 AIRI channel 与 PCL/Fabric 1.21.1 客户端，在单人或多人世界中完成已配对 Mod 的 structured fact、disconnect/TTL/revoke 验收。Fabric Mod 为 client-only，不要求开放局域网；PCL、离线用户名或游戏服务器身份都不得替代 AIRI 配对与逐会话授权。官方尚未回答“各种日志”的精确载荷范围及能否缩短一个月留存，这两项必须作为残余风险保留，不得猜测为零留存。

## 文档索引

- [能力基线](./capability-baseline.md)
- [隐私威胁模型](./privacy-threat-model.md)
- [事实目录](./fact-catalog.md)
- [Provider 基线](./provider-profiles.md)
- [Camera Local OpenCV / YOLO 选型门](./camera-local-selection.md)
- [Eventa 与 Electron 媒体传输 Spike](./transport-spike.md)
- [验收矩阵](../tests/perception-acceptance-v0.3.md)
