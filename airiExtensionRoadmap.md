# AIRI 中文情感陪伴扩展路线图

## 当前实现基线

- 分支：`codex/m0-m1-cn-companion`
- 上游基线：`moeru-ai/airi@55e850d71`
- 范围：M0 可复现基线 + M1 中文安全文本陪伴闭环
- 非范围：长期记忆、全双工语音、屏幕/摄像头感知、Minecraft 真人陪玩、Live2D 动画导演

## M0：可复现基线

- [x] 版本化 `CompanionPresetV1Schema`
- [x] strict unknown-field 校验和稳定字段错误
- [x] 安全默认值、动态 nickname、列表去重规范化
- [x] 栖遥 YAML 生产 schema 集成测试
- [x] Character Card/Prompt/持久化调用链调查
- [x] 12 类中文人格与安全验收用例
- [x] TTFT、完整响应、错误枚举和队列取消原因接入现有 chat observability
- [x] Companion 安全日志仅记录场景、风险、动作和规则 ID

## M1：中文安全文本陪伴闭环

- [x] 确定性 Prompt sections 和来源追踪
- [x] 不可被预设覆盖的产品安全、真实性和关系边界
- [x] 倾听、建议、学习、日常、高风险场景策略
- [x] AIRI Card 转换、稳定 ID、Provider/已加载模型/display 绑定预检与回退
- [x] 原子安装、重复 ID 二次确认、活动卡切换快照和单步回滚
- [x] 最终输出高置信度安全检查；违规文本在持久化/云同步前替换
- [x] Electron 主进程文件选择、扩展名/大小/UTF-8 限制
- [x] Eventa contract，不向渲染进程泄露绝对路径
- [x] YAML/JSON 解析、重复 YAML/JSON key 防护
- [x] 设置页预览、验证错误、激活和恢复操作
- [x] 同 ID 替换警告和开发态 Prompt section 来源预览
- [x] 重启后可禁用 companion 并恢复激活前角色
- [x] 英文和简体中文 UI 文案

## 尚未通过的 M1 发布门槛

- [ ] 在声明的 Provider/模型矩阵上执行 `acceptance-v0.1.md` 并记录结果
- [ ] 人工完成原生文件选择、激活、重启恢复和回滚的端到端验收
- [ ] 人工验证禁用后不残留 companion 动态 Prompt，并补充发布记录
- [ ] 为 `stage-pages` 共享导入 UI 建立 Vitest browser/component 回归测试

## 已知边界

1. 输出安全检查发生在模型流完成后；最终历史和云同步不会保存命中规则的文本或相关 tool/reasoning residue，但此前已经流式显示、进入 TTS、触发 ACT 或造成工具副作用的内容无法完全撤回。后续里程碑需要流式安全缓冲和取消策略。
2. M1 的场景策略是保守、可解释的中文规则，不是通用情绪分类模型。只有验收数据证明规则不足后才评估额外模型。
3. 模型绑定缺失或预检不可用时保留用户当前选择，因此文本人格不会因可选 TTS/Vision/Display Provider 缺失而失效；voice ID 和 Provider 运行时故障仍无法在激活前完全验证。
4. 最近一次激活快照已与角色卡状态一同持久化；重开设置窗口后可精确恢复被同 ID 覆盖的卡片。若快照不存在或已失效，才降级为根据 companion metadata 切回原角色并保留导入卡。

## 后续里程碑候选

### M2：中文实时语音

- 语义回合检测、自动打断、回声/自声抑制
- ASR 局部结果合并和中文标点恢复
- TTS 首音频延迟、情绪韵律和声线稳定性测试
- 流式输出安全缓冲与 TTS 取消

### M3：可信感知上下文

- 屏幕活动、摄像头行为/表情和 Minecraft 状态统一为带来源、时效和置信度的 `RuntimePerceptionFact`
- 用户可见权限、暂停、采集指示和本地数据生命周期
- 感知事实进入策略层，不直接拼接未经验证的原始 Prompt

### M4：角色表现编排

- `StageActuationIntent` 到 Live2D/Spine/VRM 的能力协商和降级
- 口型、注视、表情、动作和语音时序同步
- 防止模型生成不存在的动作或失控高频动画
