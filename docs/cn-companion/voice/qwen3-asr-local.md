# Qwen3-ASR 本地流式接入

## 运行方式

- Provider ID：`qwen3-asr-local`
- 模型：`Qwen/Qwen3-ASR-0.6B`
- 模型运行环境：本机 Ubuntu WSL2
- Windows 回环地址：`http://127.0.0.1:8001/`
- 输入：16 kHz、单声道、Float32LE 音频块
- 云端音频上传：无

一键启动脚本 `启动-AIRI.ps1` 会检查 `/health` 是否明确返回 `streaming: true`。服务未启动时，它通过 `services/stt/Qwen3-asr/start-qwen3-asr.cmd` 启动 WSL2 模型；端口被非流式旧服务占用时会给出错误，而不会把旧接口误判为可用。

## AIRI 回合语义

Qwen3-ASR 接收连续音频块，但最终文本需要由客户端调用 `finish` 结算。因此 provider capability 声明 `finalizesOnVadEnd: true`：

1. 语音模式开启后建立流式 ASR 会话。
2. 增量结果只更新字幕，不创建聊天消息。
3. VAD 判定本轮说话结束后，AIRI 干净关闭输入流并调用 `finish`。
4. 权威最终文本经过统一规范化、短语气词/静音幻觉过滤和去重后，才进入现有 M1 聊天与安全链路。
5. 有效回合等待助手响应；被过滤的空回合会自动建立下一条流式监听。
6. 用户停止、页面卸载、provider 切换或播放回声门控触发时使用 `cancel`，并清理服务端会话。

模型服务可以常驻以避免约一分钟的冷启动；单条识别会话只在 AIRI 正在监听时存在。`stop-qwen3-asr.cmd` 用于完全卸载模型并释放 WSL/GPU 资源。

## 2026-07-11 本机验证

- `/health`：`ok=true`、`streaming=true`、`active_sessions=0`。
- 独立流协议：4.20 秒、16 kHz 中文样本按 0.5 秒块上传，得到多个增量结果，最终文本为“甚至出现交易几乎停滞的情况。”。
- Desktop 生产态：静音虚拟麦克风开启后会话为 `streaming-asr/listening`，服务端 `active_sessions` 从 0 变为 1；优雅结算或关闭语音后回到 0。
- 静音结算曾产生“嗯。”，现由 provider-neutral 的非语音过滤器丢弃，不进入聊天。

本验证证明接入和生命周期可用，不等同于完成全部主观中文自然度、噪声环境和 M2 15 项 provider matrix 验收。
