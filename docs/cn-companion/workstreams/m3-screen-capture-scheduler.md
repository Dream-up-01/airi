# m3-screen-capture-scheduler

- Owner: Screen Owner / Integration Owner
- Status: complete — model-free M3.5、生产设置 UI、真实设备生命周期与 M3.13 cadence/背压 trace 均已通过
- Scope: M3.5 explicit screen/window selection, AIRI-owned source exclusion, source lifecycle isolation, derived-hash change gate, sensitive/minimized/source-ended suppression, mutually exclusive analyzer generation and bounded latest-frame scheduling without any model
- Files: `packages/electron-screen-capture/src/**`, `apps/stage-tamagotchi/src/renderer/composables/use-vision-screen-capture.ts`, new screen-only domain/service modules and tests under `packages/stage-ui/src/**`, perception docs
- Depends on: frozen `perception/v0.3`, M3.3 single-owner/session lifecycle, completed M3.4 transport boundary
- Contract version/commit: `perception/v0.3`; no commit requested
- Safety boundary: no model inference, cloud upload, Provider secret, OCR, window-title persistence, context/chat/TTS/Live2D wiring or new dependency
- Verification: 25 M3.5 tests cover fixed activity enums, initial/active/normal/static cadence, AIRI/sensitive/minimized/ended/stale suppression, generation switches, perceptual hash bounds, single in-flight/latest replacement, consent ordering, denial, late-start cancellation and source-ended cleanup。新增 M3.13 deterministic performance trace 以 500ms signal 步长覆盖完整 10 分钟：静止桌面只接受 initial frame（约 0.00167 FPS），持续显著变化精确限制为 1 FPS；60-frame 压力 trace 最大并发为 1，仅保留 1 个 latest slot。stage-ui、desktop 和 electron-screen-capture typechecks、scoped ESLint 与 screen-capture build 均通过
- Handoff notes: M3.6/M3.7 只能消费当前 selection generation 的 accepted ephemeral latest frame；不得绕过 screen gate 或保留 raw frame。`ProductionScreenCaptureLifecycle` 是必需的 consent/owner/platform ordering boundary；M3.12/M3.13 的生产 UI、持续指示、双窗口唯一 owner、pause/stop 资源释放与真实设备证据已完成
