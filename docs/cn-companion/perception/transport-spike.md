# M3.4 Eventa 与媒体传输 Spike

执行日期：2026-07-16；设备：当前 Windows 开发机；输入全部是内存生成的假 PCM/JPEG，没有打开麦克风、摄像头、屏幕或网络。

## 合同结果

- Eventa 合同：`eventa:stream:electron:perception:media:v0.3`。
- 泛型顺序：`defineInvokeEventa<Response, ReadableStream<Request>>`。
- 数据面只允许 directed bidirectional stream；status/cancel 使用独立 invoke 控制面。
- 每条消息携带 `sessionId`、`generation`、`windowId`；首条 open 另带 observation、grant、Provider/model 配置 ID。
- PCM 固定 `16-bit/16kHz/mono`，单块不超过 64KiB。
- JPEG 单帧不超过 190KiB；schema 上限 4096×4096，产品 profile 仍需使用 640×360、960×540 或 1280×720。
- 边界拒绝未知字段、secret 字段、超限 payload、错误顺序、重复 sequence、stale generation 与无效 consent。
- validator 只累计字节和状态，不保存 PCM/JPEG。

Fake Eventa 双向 stream 已验证 open → audio → image → complete acknowledgement，以及客户端 AbortSignal 向 handler 的传播。

## 生产共享采集接线

- 现有 canonical transcript 继续使用原有 `useAudioDevice` 语音链路，但物理流的打开/关闭现在由 `SharedMicrophoneCaptureOwner` 引用计数。
- 首个获授权的 cloud perception lane 只能通过严格解析后的独立 `microphone-audio` cloud grant 获取同一条 `MediaStream`；不允许第二次调用 `getUserMedia`。
- 停止 canonical transcript 不影响 cloud lease，停止 cloud lease 也不影响 canonical transcript；最后一个 lease 释放后才关闭轨道。
- 系统权限撤销、全局停止和物理 track ended 会清空全部 lease；尚未完成的旧启动由 epoch 隔离，不能在停止后复活。
- PCM 格式化和 Provider gateway 仍属于 M3.9；该后续只能接 `AudioFanoutHub`，不能改变本工作包冻结的采集所有权。

## 真实 Electron IPC 基准

复现命令：

```text
cd apps/stage-tamagotchi
pnpm exec electron scripts/perception-transport-spike/electron-main.mjs
```

一次 burst 结果：

| 指标 | 结果 |
|---|---:|
| accepted messages | 1,024 |
| accepted bytes | 7,869,440 |
| duration | 53.30ms |
| throughput | 140.80MiB/s |
| one-way latency p95 | 36.113ms |
| one-way latency max | 37.601ms |
| main heap delta peak | 1,649,436 bytes |
| cancel 后主动丢弃 | 90/90 messages |
| transport | Electron IPC structured clone |
| transfer list | 未使用 |

该测试故意一次发送 1,115 条消息，观察到 `maxOutstanding=1115`。这证明裸 IPC 不提供产品需要的应用层背压，生产代码必须保留 `AudioFanoutHub` 的 bounded queue、cloud drop-oldest 和 screen/camera latest-frame slot，禁止 burst 直发。

## 结论

当前 Electron IPC 的吞吐和延迟足以支撑受限实时 PCM 与最多 1 FPS、190KiB JPEG，因此本阶段不需要引入另一套二进制 transport。这个判断依赖以下硬条件：

1. Eventa directed stream，不使用广播/BroadcastChannel。
2. 每个 lane 单独 AbortController 和 bounded queue。
3. cloud 音频 overflow 丢最旧，不阻塞 canonical transcript。
4. 每个 window/generation 严格关联，stop/revoke/echo/unmount 立即 abort。
5. Provider gateway 不保留 raw bytes，renderer 不持有 secret。

后续真实 Provider 压测若出现持续 p95、内存或 stop latency 超标，应先提交 MessagePort/受控 transferable 方案供用户决策，不能静默绕开 Eventa 合同。

## Local Screen 定向 Eventa 实测

Transformers runtime 通过后，补充了与生产本地屏幕 gateway 同型的 Electron adapter client-streaming 实测：

```text
cd apps/stage-tamagotchi
pnpm exec electron scripts/perception-transport-spike/eventa-local-screen-main.mjs
```

结果：4 张 190KiB JPEG（共 778,240 bytes）按 `open → frame ×4 → complete` 顺序抵达 main，成功路径 7.9ms；第二条保持打开的流在 renderer Abort 后返回 `AbortError`，main 收到同一 invoke 的取消信号。该证据与 TypeScript contract/gateway 测试共同确认本地 screen 数据面无需退回普通 invoke 或 raw IPC channel。
