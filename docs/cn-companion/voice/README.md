# M2 中文语音对话陪伴闭环

本目录记录 AIRI 中文情感陪伴方向的 M2 语音阶段基线、指标和验收集。M2 以上游 M0/M1 文本陪伴、安全策略、角色卡与非结构化角色导入能力为前提，不重新实现角色系统，也不绕过现有聊天与安全链路。

## M2 目标

让 Desktop 主舞台具备可验证的中文语音对话闭环：

```text
麦克风
  -> VAD / push-to-talk / 音量 fallback
  -> ASR 转写
  -> 现有 chat ingest
  -> M1 中文陪伴与安全策略
  -> LLM streaming
  -> TTS session
  -> playback / captions / stage state
```

M2 的完成标准不是“设置页能测试语音”，而是主聊天生产路径能稳定完成语音输入、文本安全处理、语音输出、停止、打断和可观测记录。

## 当前文档

- `capability-baseline.md`：现有语音链路和能力边界。
- `latency-metrics.md`：M2 需要记录的非敏感时间线和延迟指标。
- `tts-provider-profiles.md`：文字对话本地 GPT-SoVITS 与语音通话 MiniMax 的配置、验证和能力边界。
- `qwen3-asr-local.md`：WSL2 本地 Qwen3-ASR 流式接入、生命周期与已验证边界。
- `../tests/voice-acceptance-v0.2.md`：语音验收用例。

## 重要边界

- ASR 结果必须作为普通用户输入进入 M1 安全链路。
- TTS/Live2D/Stage 只能消费明确状态和表现事件，不能修改人格 prompt 或安全策略。
- 默认不记录原始音频、完整用户转写、完整 prompt、API key、本机路径或 provider secret。
- M2 不实现摄像头、屏幕感知、Minecraft 控制、长期记忆、主动消息、声音克隆或精确 viseme 级动画导演。
