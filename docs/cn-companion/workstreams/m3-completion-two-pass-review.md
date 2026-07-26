# m3-completion-two-pass-review

- Owner: Integration Owner (Codex root)
- Status: local-complete / external-acceptance-pending
- Scope: Complete remaining M3 cloud media gateway/orchestration, reaction/actuation policy, Minecraft acceptance, release gates, and two review/fix rounds.
- Files: New perception-specific shared/main/renderer/domain modules and tests; minimal registration, settings UI, i18n, and acceptance documentation wiring.
- Depends on: M3 v0.3 contracts, state manager, local screen/camera vertical slices, cloud protocol/control, and Minecraft adapter already present in the worktree.
- Contract version/commit: `perception/v0.3` and `perception-media/v0.3`; dirty worktree baseline, no commit creation authorized.
- Verification: 2026-07-18 targeted Vitest（Stage UI 178、Desktop 84、Chromium 6、Minecraft M3 bridge 6、M1 context 28、voice/chat 53、CCC 4），以及完整 Minecraft service 30 files/236 tests；Minecraft package typecheck、root typecheck（52 workspace projects）、root lint（0 errors）、`git diff --check`、Desktop production build 与启动脚本 DryRun 均通过。
- Handoff notes: Preserve the frozen M0/M1, character import, canonical transcript, chat, and speech-output paths. Raw media remains memory-only and Qwen transcript/deltas never enter chat or TTS.

## 第一轮：架构、安全与隐私

已修复：Qwen Provider ID 导致合法事实被抑制；Screen/Camera grant registry 冲突；Minecraft 日志 secret 泄漏；跨 renderer grant 误清理；Devtools 持久化完整模型响应；成本账本重启清零、控制面/网关账本分裂及跨预算漏记账；Camera encode/stop 竞态；Screen Plus 缺失有界历史与 accepted evidence 检查；state manager 长会话集合无界。静态 raw/base64/PCM/full-response/secret 审计通过，无未解决 P0/P1。

## 第二轮：运行、配置、资源与 UI

已修复：语音会话与本地 VLM/YOLO WebGPU 争用；300px 主窗口状态逐字换行；感知 BroadcastChannel HMR 后复用 closed channel；主舞台在模型状态频道已关闭后才发送 `owner-gone` 的卸载异常；browser Vitest 缠绕 `~build/time`/`~build/git` 告警；Minecraft map/Levenshtein 二维数组共享行、`vec3` 类型版本冲突、LLM timeout 契约漂移、乱序 detector 审计缺失及并行测试计时抖动；M3 import/style 与 CRLF diff gate。真实 Electron Settings 的配置验证按钮可响应并显示 retention-blocked/零上传；一键启动脚本与快捷方式目标正确。production build 只有仓库既有的 Rolldown/UnoCSS/duckdb warning。

## 外部验收门

1. 阿里云控制台未提供保留开关；用户需通过官方支持/工单取得 Realtime 音频、图片与响应保留期限的书面确认。确认满足最短可用保留且不用于训练后，再设置 `AIRI_QWEN_RETENTION_VERIFIED=true` 并执行一次有界真实 Qwen session。
2. 用户启动 PCL/Minecraft 服务端与 AIRI channel，执行真实 authenticated structured event、disconnect/TTL/revoke 验收。

在这两项完成前，M3 保持 external-acceptance-pending，不声明 complete。
