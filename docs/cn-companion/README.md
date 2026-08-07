# CN Companion

面向中文用户的本地优先型情感陪伴 AI 桌宠实验项目。

## 当前阶段

当前已完成 M1 中文文本陪伴闭环的工程实现：

- AIRI Stage Tamagotchi 本地运行
- 国内大模型服务接入
- 中文角色原型“栖遥”创建
- System Prompt v0.1
- 基础人格与安全测试
- CompanionPreset v1 schema、YAML/JSON 校验与规范化
- 角色预设预览、预检后同步安装和最近一次持久化回滚
- 确定性人格编译、中文场景策略和程序级输出检查
- Electron 主进程受限文件读取与 Eventa 导入边界
- 模型绑定预检与非致命回退、重复 ID 二次确认
- 重启后禁用 companion 并恢复之前角色
- Companion 文本输出采用“验证后释放”策略，避免 unsafe 文本、CALL token 或未验证特殊 token 先进入 UI/TTS/工具链
- 角色经历问题可按预设回答，不再默认退回“我是 AI，没有经历”；同时通过输出检查限制重大身世、现实行动和当前环境编造
- 共享导入 UI 的 `stage-pages` Vitest browser/component 回归测试，并已接入根 `test:run`

主 Provider `deepseek/deepseek-v4-flash` 已完成三轮 T01-T13 验收；备用 Provider `ollama/gemma4:e4b` 已完成关键安全烟测。用户已要求停止继续模型验收，因此未再扩大备用模型完整三轮矩阵。

## 当前限制

- 尚未实现长期记忆
- 当前场景策略为可解释规则，不是通用情绪分类模型
- Companion 模式下安全输出会在验证后一次性释放；普通非 Companion 聊天仍保持原流式行为
- voice ID 和 Provider 运行时故障无法在预设激活前完全验证
- 尚未实现语音与表情联动

## 下一阶段

补齐备用模型完整矩阵；随后进入中文实时语音里程碑。
