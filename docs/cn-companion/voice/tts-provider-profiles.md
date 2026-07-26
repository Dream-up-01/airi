# M2 TTS 输出配置：本地文字对话与云端语音通话

更新时间：2026-07-14

本页记录当前 M2 的 TTS 配置方式、真实能力边界和验证状态。它不改变 M1 的聊天、安全或角色卡边界：语音只是助手文本回复的输出通道。

## 输出路由

| 场景 | 输出配置 | 预期 Provider | 预期模型 | 状态 |
| --- | --- | --- | --- | --- |
| 文字输入对话 | `text-chat` | `gpt-sovits-local` | `airi-firefly-v4` | 本机实际合成已验证 |
| 麦克风语音通话 | `voice-conversation` | `minimax-speech` | `speech-2.8-turbo` | 中国区配置已验证；账号音色 `AiriFireflyCN20260710_2011R7` 已激活并完成真实合成与播放 |

`SpeechOutputProfile` 只保存 `providerId`、`modelId` 和 `voiceId`。API key、参考音频绝对路径、权重路径、参考文本、完整回复文本都不在这个 profile、角色卡导出或 M2 时间线中出现。

当用户已经明确配置了任一新 profile 时，另一个场景若尚未配置，AIRI 会停止该场景的语音输出，而不是把另一个场景的 Provider 静默复用。这避免文字对话中的本机音色被误用于云端通话，也避免未配置的通话意外走任意旧 Provider。

尚未迁移到 profile 的既有安装会暂时继续使用旧的全局 TTS 选择，直到用户保存第一项 profile。

## 本地 GPT-SoVITS

### 组件与边界

`services/tts/gpt-sovits-airi/server.py` 是只监听 `127.0.0.1:9888` 的 OpenAI 风格桥接：

```text
AIRI renderer
  -> http://127.0.0.1:9888/v1/audio/speech
  -> GPT-SoVITS native API (127.0.0.1:9880)
  -> WAV response
```

桥接从本地 `bridge-config.json` 读取以下已确认的资源：

- GPT 权重：`GPT-SoVITS/GPT_weights_v4/firefly-e50.ckpt`
- SoVITS 权重：`GPT-SoVITS/SoVITS_weights_v4/firefly_e10_s4420_l32.pth`
- 参考音频：`datasets/airi_voice_v1/wavs/firefly_0001.wav`
- 匹配参考文本：`木须色拉还有经典苏乐达,你随便挑吧.`

这些路径和参考文本只在本地桥接进程中解析；HTTP 健康检查与错误返回不会泄露它们。桥接不落盘原始请求文本或音频。

启动方式：运行 `services/tts/start-gpt-sovits-airi.bat`。它启动原生 GPT-SoVITS API（如尚未运行）以及 AIRI 回环桥接。

在 AIRI 设置中打开 `GPT-SoVITS（本地）`，点击“验证并设为文字对话语音”。Provider 会校验本机健康端点后写入 `text-chat` profile。

### 已验证

2026-07-10 在本机完成：

- `GET /health` 返回 `{ "ok": true, "local": true }`。
- 对短句 `你好，AIRI。` 的 `/v1/audio/speech` 请求返回 `200`、`audio/wav`、`RIFF` 音频头和 180,524 字节音频。

### 当前限制

- 当前桥接以完整 WAV 响应接入既有 REST/分段播放路径，不是 GPT-SoVITS 原生逐块播放模式。
- 用户取消会立即停止 AIRI 的 TTS intent 和已排队播放；第三方原生推理 API 没有单请求取消协议，因此已经开始的本地 GPU 推理可能继续到该片段完成，但结果不会再被调度播放。
- GPT-SoVITS 与本地 SenseVoice 都会占用本机 GPU。建议在资源不足时保留通话 TTS 为云端 MiniMax，避免同一时刻运行两个本地模型。

## MiniMax 语音通话

`minimax-speech` 的默认模型已设为 `speech-2.8-turbo`。新配置默认使用 MiniMax 文档标注为低首音频延迟的全球 HTTP endpoint `https://api-uw.minimax.io`；当前验收配置使用用户已选择的中国区 endpoint `https://api.minimaxi.com`。地区不会静默切换。设置页会明确提示：语音通话的助手文本会发送至云端生成语音。

使用步骤：

1. 在 AIRI 的 `MiniMax Speech` Provider 页面中，在本机设置界面填写 API key；不要把 key 发到聊天中或写入角色卡。
2. 选择通话音色（默认不会擅自选择一个角色声线）。
3. 点击“验证并设为语音通话语音”。这会保存 `voice-conversation` profile。

### 自定义音色克隆

`MiniMax Speech` 设置页现在包含“克隆自定义通话音色”面板。它遵循 MiniMax 的两文件流程：

1. 上传一个 `10` 秒至 `5` 分钟、最大 `20 MB` 的 WAV/MP3/M4A 克隆源；
2. 上传一个小于 `8` 秒的提示音频，并填写逐字对应的文本；
3. 填写符合 MiniMax 规则的新 `voice_id`，勾选“拥有授权并同意上传”，再由用户点击创建。

克隆源与提示音频只保存在当前表单内，并仅在最终按钮被点击后发送给 `https://api.minimax.io/v1/files/upload` 与 `https://api.minimax.io/v1/voice_clone`。AIRI 不会把原始音频、逐字文本、本地路径、预览 URL 或 API key 写入角色卡、语音输出 profile 或遥测。创建成功后只保存安全的 `voiceId`，并设为通话输出的候选音色。

为当前 Firefly 素材准备了可复现的本地克隆源：

- `services/tts/datasets/airi_voice_v1/minimax/airi_firefly_clone_source.wav`：由 40 段有转写依据的素材合并而成，实测 `188.58` 秒、约 `11.5 MiB`，符合主克隆源限制；
- `services/tts/datasets/airi_voice_v1/wavs/firefly_0001.wav`：`4.78` 秒，可作短提示音频；其逐字文本为 `木须色拉还有经典苏乐达,你随便挑吧.`。

可选“创建时同时生成付费试听”默认关闭；启用后才会把试听文本发送给 MiniMax，并按其 TTS 字符额度计费。克隆音色若长期不实际调用，MiniMax 文档说明可能在 `7` 天后清理，因此创建后应在 AIRI 的语音测试区完成一次自己确认的合成调用。

流程和文件限制依据 [MiniMax Voice Clone API](https://platform.minimax.io/docs/api-reference/voice-cloning-clone) 与 [MiniMax Upload API](https://platform.minimax.io/docs/api-reference/file-management-upload)。

### 2026-07-14 真实配置检查

- 当前 profile：`minimax-speech / speech-2.8-turbo / AiriFireflyCN20260710_2011R7`，中国区 endpoint。
- MiniMax 官方 Get Voice 查询成功；设置页只允许激活账号目录中存在的音色。旧 ID `AiriFirefly20260712` 不再被接受为可用通话音色。
- 一次真实短句请求在 `633 ms` 使 fetch 响应可用，`665 ms` 将完整返回音频挂到播放器，`715 ms` 达到可播放状态，`760 ms` 触发播放，音频时长 `1,103 ms` 并正常结束。该结果通过 REST `<2500 ms` 目标，但不构成真流式证据。
- 设置页真实验证了 `speech-2.8-turbo -> speech-2.8-hd -> speech-2.8-turbo` 切换，独立 `voice-conversation` profile 的模型 ID 与用户选择一致；最终恢复声明矩阵的 Turbo 配置。
- 云端隐私确认进入生产门控。未确认时不能启动 MiniMax 语音；运行中撤销会停止播放/收音并使 Qwen 本地流式会话从 `1` 清理到 `0`。

### 当前限制与下个实现门槛

MiniMax 官方的真实 T2A WebSocket 使用握手 `Authorization: Bearer ...` 头，而浏览器渲染层 WebSocket API 无法安全地附加这个头。当前 `minimax-speech` REST 适配器使用其 HTTP/SSE 端点，但会等待一个片段的音频聚合完成后才交给现有播放队列；它不是“边收边播”的 WebSocket 实现。

因此，当前 MiniMax 路径只声明通过 M2 允许的 REST 首音频目标，不声明通过 streaming-TTS 目标。仓库审计确认现有 crossws 客户端不能为握手附加官方要求的 `Authorization` header，且现有 Stage 播放入口先解码完整 `ArrayBuffer`。真正实时通话仍需要桌面主进程 WebSocket、定向 Eventa 音频合同和渐进播放路径；这不再阻塞已达标的 M2 REST profile，但属于未来需单独决策的能力扩展。

MiniMax WebSocket 协议、`speech-2.8-turbo` 和 HTTP 低 TTFA endpoint 的依据见 [MiniMax WebSocket 文档](https://platform.minimax.io/docs/api-reference/speech-t2a-websocket) 与 [MiniMax HTTP 文档](https://platform.minimax.io/docs/api-reference/speech-t2a-http)。
