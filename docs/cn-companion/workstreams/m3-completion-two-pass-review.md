# m3-completion-two-pass-review

- Owner: Integration Owner (Codex root)
- Status: production-integrated / external-acceptance-pending
- Scope: Complete remaining M3 cloud media gateway/orchestration, reaction/actuation policy, Minecraft acceptance, release gates, and two review/fix rounds.
- Files: New perception-specific shared/main/renderer/domain modules and tests; minimal registration, settings UI, i18n, and acceptance documentation wiring.
- Depends on: M3 v0.3 fact/grant contracts, state manager, local screen/camera vertical slices, cloud policy/control v0.4, and Minecraft adapter already present in the worktree.
- Contract version/commit: `perception/v0.3`、`perception-media/v0.3`、`perception-cloud-policy/v0.4` and `perception-cloud-control/v0.4`; dirty worktree baseline, no commit creation authorized.
- Verification: 2026-07-28 fresh evidence：Cloud lifecycle 4 files / 45 tests、Stage UI perception/Minecraft 36 / 206、Desktop perception 34 / 158、Core context 2 / 19、冻结 voice/chat 49 / 362、Minecraft service 37 / 324 全部通过；Desktop 与 Minecraft typecheck、Minecraft lint、root typecheck（52 workspace projects）、root lint（0 errors）、`git diff --check`、Desktop production build 与 `启动-AIRI.ps1 -DryRun` 均通过。Browser Vitest 在 Chromium 启动前被环境 `spawn EPERM` 阻塞。
- Handoff notes: Preserve the frozen M0/M1, character import, canonical transcript, chat, and speech-output paths. Raw media remains memory-only and Qwen transcript/deltas never enter chat or TTS.

## 第一轮：架构、安全与隐私

已修复：Qwen Provider ID 导致合法事实被抑制；Screen/Camera grant registry 冲突；Minecraft 日志 secret 泄漏；跨 renderer grant 误清理；Devtools 持久化完整模型响应；成本账本重启清零、控制面/网关账本分裂及跨预算漏记账；Camera encode/stop 竞态；Screen Plus 缺失有界历史与 accepted evidence 检查；state manager 长会话集合无界。静态 raw/base64/PCM/full-response/secret 审计通过，无未解决 P0/P1。

## 第二轮：运行、配置、资源与 UI

已修复：语音会话与本地 VLM/YOLO WebGPU 争用；300px 主窗口状态逐字换行；感知 BroadcastChannel HMR 后复用 closed channel；主舞台在模型状态频道已关闭后才发送 `owner-gone` 的卸载异常；browser Vitest 缠绕 `~build/time`/`~build/git` 告警；Minecraft map/Levenshtein 二维数组共享行、`vec3` 类型版本冲突、LLM timeout 契约漂移、乱序 detector 审计缺失及并行测试计时抖动；M3 import/style 与 CRLF diff gate。Cloud Camera 的单调 cloud generation 已与 local frame generation 分离，composable 改为核对显式 local binding；Screen/Camera active stop、runner failure、Camera encoder error 与 Screen sample error 均进入先同步登记的 run/epoch-scoped retirement，替代会话等待旧 timer、frame subscription、encoder、PCM、麦克风、capture/local lease 清理；同步状态回调重入和迟到错误不能越过屏障或覆盖替代状态；Local Camera active teardown 已改为穷尽 cleanup；mixed session 的 local grant 保持 `local-only`，云 `camera-frames` 与 `microphone-audio` 分别使用独立 `mixed` grant。2026-07-27 官方答复到达后，UI 与 wire policy 更新至 v0.4，分别显示一个月服务日志与断连立即清除模型会话上下文，并保持 readiness 与上传状态分离。一键启动脚本与快捷方式目标正确。production build 只有仓库既有的 Rolldown/UnoCSS/duckdb warning。

2026-07-28 P66 真实设备证据：production Electron 使用隔离 userData 和原生 CDP；444×592 设置窗口无页面级横向溢出并可滚动到底；四项阿里云政策文案及独立 `camera-frame`/`microphone-audio` 授权可见；Workspace/API key/model 未配置时 fail-closed，点击验证后保持 idle / 0 facts / 无上传，未观察到 Qwen/DashScope socket；Camera 30 Hz 与 Screen 5 Hz 在本地/云面板同步，云上传上限为 1 FPS。因此 P66 为 `pass-device`。Browser Vitest 的 Chromium 自动路径仍在启动前被环境 `spawn EPERM` 阻塞，未记为通过。

## 外部验收门

1. P67 保持 `planned / external-acceptance-pending`。2026-07-27 阿里云官方售后书面回复已确认服务日志留存一个月、断连清除模型会话上下文、不用于训练/改进/评估或人工审阅，以及中国内地 Endpoint 不跨地域或跨境。可将 `AIRI_QWEN_RETENTION_VERIFIED=true` 绑定日期化 Profile 后执行一次有界真实付费 Qwen session；该真实 Provider/费用/stop-revoke-generation 证据尚缺。日志具体包含哪些载荷及能否缩短一个月留存仍是残余问题，不得声称零留存。
2. Minecraft PCL/Fabric Provider 保持 `planned / external-acceptance-pending`。用户启动 AIRI channel 与 PCL/Fabric 1.21.1 客户端，在单人或多人世界中执行已配对 Mod 的 authenticated structured event、disconnect/TTL/revoke 验收。Mod 为 client-only，不要求开放局域网；PCL、离线用户名或游戏服务器身份不得充当配对、consent 或 approval authority。

在这两项完成前，M3 保持 external-acceptance-pending，不声明 complete。
