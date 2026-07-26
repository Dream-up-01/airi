# M3.8 Camera Local OpenCV / YOLO 选型门

核对日期：2026-07-16
状态：**用户已批准；固定制品已校验，生产本地链路与真实摄像头三分析器验收通过**

## 推荐组合

| 层 | 推荐制品 | 固定版本/来源 | 许可证 | 新增下载 | 选择理由 |
|---|---|---|---|---:|---|
| OpenCV | 官方 OpenCV.js 完整构建 | `4.13.0`，`https://docs.opencv.org/4.13.0/opencv.js` | Apache-2.0 | 10,964,323 bytes | 直接来自 OpenCV 官方文档站；覆盖 resize/color、亮度、模糊、motion/change 和 optical flow；放在独立 Worker，避免阻塞 renderer |
| YOLO | YOLOX-Nano 官方 ONNX | `0.1.1rc0/yolox_nano.onnx`，Megvii 官方 GitHub Release | Apache-2.0 | 3,659,407 bytes | 416×416、0.91M 参数、1.08 GFLOPs；满足低频白名单物体/人数证据，包体与算力明显低于 Tiny |
| YOLO runtime | 仓库现有 `onnxruntime-web` | `1.24.3` | MIT | 0 | Desktop 已直接依赖，无需再安装 Python、原生 Node addon 或第二套推理服务；Electron 官方支持 Web frontend 路径 |
| MediaPipe | 仓库现有 Tasks Vision | `@mediapipe/tasks-vision 0.10.34` + 已缓存 task assets | Apache-2.0 | 0 | 复用现有 pose/hand/face landmark 基础，仅向生产 fusion 提交受控 intermediate evidence |

固定制品合计 **14,623,730 bytes（约 13.95 MiB）**。下载先进入 AIRI 本机缓存并完成大小、SHA-256 与来源验证；验证后的生产副本随 renderer 资源提供，但只有用户明确点击开始本地摄像头感知后才加载。停止、暂停或应用退出会释放 Worker、ORT session、MediaPipe task 和 frame 引用。

## 为什么不选其他方案

- `YOLOX-Tiny` 官方 ONNX 为 20,219,662 bytes，5.06M 参数、6.45 GFLOPs、COCO mAP 32.8，准确率高于 Nano，但计算量约为 Nano 的 6 倍。第一版只需要低频、白名单、粗粒度存在性证据，先用 Nano 更符合持续运行与低热量目标；真实设备基准不达标时再单独提交 Tiny 升级门。
- 当前 Ultralytics YOLO 软件/模型采用 AGPL-3.0 或商业 Enterprise 许可。AIRI 不能在未完成法律与分发影响决策时把它作为默认可再分发依赖，所以本阶段不选 YOLO11/YOLOv8。
- 不新增 `opencv-python`、Ultralytics Python 或 native OpenCV Node addon：这些路径会引入第二运行时、显著扩大磁盘与安装成本，并增加 Electron ABI/进程生命周期风险。
- 不采用自动 WebGPU→WASM fallback。首个 YOLO profile 固定 `onnxruntime-web/webgpu`；WebGPU 不可用时显示 `degraded/yolo-webgpu-unavailable`。若需要 CPU/WASM profile，必须经过一次明确验证和用户选择，不能静默切换执行后端。

## 固定生产边界

- 摄像头默认关闭；授权只覆盖 `camera-frames` 本地处理，不包含麦克风或云上传，应用重启不自动恢复。
- 唯一 `CameraCaptureOwner` 打开一个 `getUserMedia({ video, audio: false })` track；非 owner renderer 只读状态。
- 默认工作帧 `640×360`，内存中只保留当前 frame 与每 analyzer 一个 latest-frame slot；不保存截图、视频、landmark、bbox、轨迹或身份模板。
- MediaPipe 建议 cadence：pose 10 Hz、hands 8 Hz、face cue 5 Hz；OpenCV 10 Hz；YOLO 2 Hz。三个 analyzer 分别单 in-flight、timeout、drop-latest 统计和幂等 dispose。
- YOLO 只允许 `person`、`cup`、`bottle`、`book`、`laptop`、`keyboard`、`mouse`、`cell-phone`、`chair`、`cat`、`dog`；未知 label 丢弃。bbox 仅作为当前窗口融合证据，不能进入 fact/context/Pinia/日志。
- face landmarks 只支持 `face-present` 与几何上可观察 cue；禁止身份、人脸 embedding、真实情绪、心理、健康、疲劳或欺骗判断。
- analyzer 只返回 intermediate evidence；只有 local fusion 可以生成 `ObjectivePerceptionEvent`，之后仍必须通过唯一 `PerceptionStateManager`。

## 已完成实施与验收

1. 下载两个固定制品，记录 SHA-256、实际大小、响应来源、OpenCV/YOLOX/ONNX Runtime license notice；任何不匹配立即删除临时文件并失败关闭。
2. 先做无摄像头 fixture benchmark：OpenCV Worker、YOLOX-Nano WebGPU、严格 label allowlist、timeout、单 in-flight、latest-frame 和 dispose。
3. 建立 camera consent/session/generation、Web Lock production owner、权限拒绝/撤销、pause/resume、track-ended 与 `<500ms` 停止新 observation。
4. 把现有 MediaPipe backend 窄化为 production evidence，并补齐 task close/dispose；不得把现有 Devtools `PerceptionState` 或 landmarks 直接发布到 context。
5. 接入 OpenCV quality/motion 和 YOLOX detection，再做多帧 hysteresis/fusion，输出有 TTL/confidence/provenance 的客观事件。
6. 在真实 RTX 5060 Laptop + 实体摄像头上记录 cold start、first result、steady latency、drop、CPU/GPU/RAM 与 stop latency；任一 analyzer 未过真实设备门时 Camera Local 只标 `partial`。

### 2026-07-16 固定制品

| 制品 | 实际大小 | SHA-256 | 结果 |
|---|---:|---|---|
| OpenCV.js 4.13.0 | 10,964,323 bytes | `63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0` | 通过 |
| YOLOX-Nano ONNX 0.1.1rc0 | 3,659,407 bytes | `c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d` | 通过 |

第三方来源、版权和许可证随制品记录在 `THIRD_PARTY_NOTICES.md`。未新增 OpenCV/Python/native addon 依赖；YOLO 使用仓库既有 ORT Web 1.24.3 WebGPU。

### 2026-07-16 真实设备结果

- 构建：`@proj-airi/stage-tamagotchi` production Electron build；Windows 实体摄像头；RTX 5060 Laptop GPU。
- 用户路径：展开主控制岛 → 可信桌面观察 → 摄像头 → 勾选本次会话本地授权 → 开始。
- 结果：MediaPipe、OpenCV.js 4.13.0、YOLOX-Nano 三路均显示 `ready`；15 秒观察窗口内工作帧 101、丢弃 36、新鲜事实 5，之后持续运行至 404+ 工作帧且无分析器降级。
- 生命周期：暂停会终止 OpenCV Worker，停止/暂停撤回 projection 与全部 accepted facts；自动化测得清理调用小于 500ms，CDP 外部轮询包含 CLI 启动开销约 542ms。旧 analyzer 回调由 active-run/generation 门丢弃。
- 隐私：`getUserMedia` 固定 `audio:false`；UI 明确显示“仅本地摄像头”；生产状态不包含 frame、landmark、bbox、轨迹、身份或自由模型文本。
- 证据：`qa-camera-three-analyzers-ready.png`；camera domain/analyzer/coordinator/capture targeted tests；production build 和目标类型检查。

当前结论：M3.8 的三段本地栈已通过真实设备硬门。扩大场景矩阵（多人进出、真实低光/遮挡/挥手组合）仍在 M3.13 最终矩阵中继续执行，不影响本地栈 ready 状态。

## 官方核对来源

- OpenCV 4.13.0 Release 与制品信息：`https://github.com/opencv/opencv/releases/tag/4.13.0`
- OpenCV.js 教程：`https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html`
- OpenCV Apache-2.0：`https://github.com/opencv/opencv/blob/4.x/LICENSE`
- YOLOX 官方模型表、ONNX 部署和 Release：`https://github.com/Megvii-BaseDetection/YOLOX`
- YOLOX Apache-2.0：`https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE`
- ONNX Runtime Web/Electron 与 WebGPU：`https://onnxruntime.ai/docs/tutorials/web/`、`https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html`
- Ultralytics 当前许可：`https://github.com/ultralytics/ultralytics/blob/main/pyproject.toml`
