# M3 隐私与威胁模型

安全目标：用户知道正在采集什么、在哪里处理、是否上传、使用何模型并能随时停止；停止或撤销后旧 generation 不能再生效。

| ID | 威胁 | 影响 | 强制缓解 |
|---|---|---|---|
| T01 | 未授权启动屏幕采集 | 隐私泄露 | permission-first 状态机；无 grant 不允许 owner/capture |
| T02 | 未授权启动摄像头 | 隐私泄露 | 摄像头独立 grant 与持续指示 |
| T03 | 用本地麦克风授权推定云上传 | 音频外传 | `microphone-audio` 独立 modality grant |
| T04 | 静默云端 fallback | 未知费用/地区风险 | local/cloud 切换只由用户或冻结 route policy 决定 |
| T05 | 多 renderer 重复采集 | 重复上传/资源耗尽 | Web Lock 单 owner；缺失时 fail closed |
| T06 | 原始屏幕帧进入 context | Prompt/历史泄露 | event schema 拒绝未知字段；唯一 state manager |
| T07 | 原始摄像头帧进入 store | 生物隐私泄露 | raw ref memory-only；不得进入 Pinia/广播 |
| T08 | PCM 进入日志或遥测 | 语音泄露 | 只记录计数/稳定错误码 |
| T09 | 完整 OCR 进入事实 | 密码/私聊泄露 | 不做默认完整 OCR；摘要有界且单行 |
| T10 | 网页 Prompt injection | 模型行为劫持 | 外部文字一律标记不可信观察数据 |
| T11 | 游戏聊天注入指令 | 工具/角色劫持 | 结构字段优先，自由文本不执行 |
| T12 | 视觉模型自由文本直通 | 指令或人格污染 | strict JSON parser + allowlisted event/value |
| T13 | 迟到响应覆盖当前状态 | 错误声称仍在观察 | session/generation 双检查 |
| T14 | stop 后请求继续完成 | 撤销失效 | AbortSignal + generation bump + raw ref release |
| T15 | pause 仍产生事实 | 隐藏监控 | pause 清理 source 并撤回事实 |
| T16 | track ended 未清理 | 过期“仍看见” | source-ended terminal path + immediate revoke |
| T17 | TTL 不受限 | 陈旧事实 | event-specific max TTL + fake-clock expiry |
| T18 | 低置信单帧手势 | 误判与打扰 | minimum samples + confidence threshold |
| T19 | 云推断覆盖本地 absence | 错误存在判断 | direct local evidence 优先 |
| T20 | 人脸身份识别 | 生物特征画像 | schema 无 identity/name/embedding 字段 |
| T21 | face cue 被称为真实情绪 | 心理误判 | 只允许 `observable-cue` 中性枚举 |
| T22 | landmarks/bbox 长期保存 | 行为追踪 | 仅临时融合，不进入 fact/snapshot |
| T23 | Provider secret 到 renderer | 凭据泄露 | secret 只在 main/gateway |
| T24 | 本机路径或窗口标题外泄 | 身份/文件泄露 | schema 无路径/完整标题字段 |
| T25 | Devtools 导出 raw payload | 二次泄露 | 只导出脱敏 metadata/事实状态 |
| T26 | telemetry 上传事实值 | 用户画像 | 禁止 fact value 与 Prompt 进入遥测 |
| T27 | Minecraft source 伪造 | 假事实 | source identity、schema version、skew、replay 验证 |
| T28 | 无限重试产生云费用 | 费用失控 | bounded backoff、cost guard、最终 off/local-only |
| T29 | raw 队列背压阻塞 ASR | 语音链路退化 | 感知 lane 丢最旧 window，不阻塞 canonical transcript |
| T30 | assistant 回声被上传分析 | 自反馈循环 | 复用 echo gate 丢弃并取消 window |
| T31 | 角色卡扩大授权 | 越权监控 | grant 只由用户 UI 创建，模型/卡片/插件不可修改 |
| T32 | 用户纠正后错误事实仍活跃 | 真实性损害 | `user-confirmed`/`user-retracted` 与立即撤回 |

## 信任边界

- 可信控制：用户授权、session controller、唯一 owner、domain policy。
- 不可信数据：屏幕文字、网页、游戏聊天、Minecraft 外部文本、视觉模型输出、Provider delta。
- 受限可信信号：经过 schema、generation、TTL、置信度、冲突与敏感度策略的 accepted fact。
- 不可信事实也不能直接成为 system 指令、工具调用、角色台词、TTS 文本或 Live2D motion。

## 残余风险与发布阻塞

真实 Electron IPC 二进制 transport、OpenCV.js 4.13.0 与 YOLOX-Nano ONNX 的来源/license/hash/实体摄像头运行均已验证。本地 Screen/Camera 保持 production-ready；Qwen main-only gateway、独立帧/麦克风 grant、共享 capture、预算账本和 stop/revoke cleanup 已生产接线。2026-07-27 阿里云官方售后已确认服务日志留存一个月、断连立即清除模型会话上下文、不用于训练/改进/评估或人工审阅，以及中国内地 Endpoint 不跨地域或跨境；cloud policy/control v0.4 已严格传递这些独立字段，readiness 证据标记可绑定日期化 Profile 配置。断连清除上下文不得解释为删除一个月服务日志；“各种日志”的精确载荷范围和能否缩短留存仍未知，采用所有已授权云媒体/响应可能进入一月日志的保守披露。主动情境反应按用户决定保持关闭。剩余外部发布阻塞只有受控、付费 Qwen 真实 Provider 验收和真实 PCL/Fabric Provider 运行；client-only Mod 可在单人世界验收，PCL/离线用户名/游戏服务器身份不能代替 AIRI 配对与授权。不得因政策已确认或 mock/targeted tests 通过而扩大声明。
