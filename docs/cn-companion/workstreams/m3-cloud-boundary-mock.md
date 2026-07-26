# M3.7 / M3.9 Cloud Perception Safety Boundary

- Owner: Qwen Cloud Owner / Integration Owner
- Status: production-integrated / provider-blocked — 生产逐会话 grant、renderer PCM/JPEG orchestrator、定向 Eventa stream、main-owned Qwen WebSocket gateway、持久化费用账本和 context-only downstream 已接通；控制台保留策略未确认，真实 Provider session 按设计保持关闭
- Scope: Camera JPEG/change/cadence gate，shared microphone/fanout/echo cancellation，strict Qwen completed JSON parser，Screen Flash→Plus domain routing，bounded fault policy，cloud configuration/readiness/cost ledger，main-only Realtime protocol，inert production control UI
- Files: `apps/stage-tamagotchi/src/shared/eventa/perception*`、`apps/stage-tamagotchi/src/main/services/airi/perception/qwen-*`、`apps/stage-tamagotchi/src/renderer/{components,composables}/perception/*Cloud*`、`packages/stage-ui/src/services/perception/*cloud*`、`packages/stage-ui/src/domains/perception/{cloud-policy,screen-cloud-routing}*`
- Depends on: frozen `perception/v0.3` contracts and explicit cloud decision gates in `AGENTS.md`
- Safety boundary: Electron main 只检查 Workspace/API Key 是否存在，不回传值；status/validate 不创建连接。媒体 session 只有在 readiness、source-specific frame grant、独立 cloud-audio grant、generation、费用和 echo/privacy gate 全部通过后才可打开。当前 retention gate 为 false，所以不打开 cloud subscriber、不上传帧/PCM、不建立连接、不产生费用；这些证据只支持 production-integrated，不支持 provider-verified
- Verification: policy exact schema 固定中国内地、分别逐会话授权、Screen Flash/Plus、Camera Flash-only、失败 stop-no-fallback、本地 retention none 和 reaction off。费用以整数微元按中国标准时间执行 5/10/50 边界。协议只发 text-only、Manual commit/create、真实音频先于 JPEG，拒绝 camera Plus、Provider 音频输出、partial-only 和不完整 `response.done`。Eventa 状态只含布尔 readiness、稳定 code 和费用摘要，不含 Workspace/API Key/raw/full response。既有 frame/audio/echo/backpressure/route/failure tests 继续通过
- Handoff notes: Workspace、API Key 和模型可用性配置已存在。2026-07-18 控制台复核未发现保留/训练开关；需由阿里云官方支持书面确认 Realtime 媒体与响应保留期限，确认满足策略后再将 `AIRI_QWEN_RETENTION_VERIFIED=true` 并执行一次有界真实 session；凭据不得通过聊天传递
