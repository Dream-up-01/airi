# 中文陪伴预设与 AIRI Character Card 调查

## 调查基线

- 调查日期：2026-07-06
- 上游基线：`moeru-ai/airi@55e850d71`
- 中文陪伴分支：`codex/m0-m1-cn-companion`
- 首个样例：`docs/cn-companion/presets/qiyao-v0.1.yaml`

本文件记录代码调用链和映射决策。它不表示对应功能已经进入生产链路；实现状态以测试和主 Stage 调用链为准。

## 当前角色系统

### 活动 Stage 角色卡

`packages/stage-ui/src/stores/modules/airi-card.ts` 是当前 Stage 角色卡真源：

- `cards` 使用本地存储键 `airi-cards` 保存 `Map<string, AiriCard>`。
- `activeCardId` 使用 `airi-card-active-id` 保存活动卡片 ID。
- `newAiriCard` 将 CCv3 `CharacterCardV3` 转换成内部 `AiriCard`。
- `watchDebounced(activeCard, ...)` 在切换后同步意识、视觉、语音、显示模型和 Artistry 设置。
- 普通 AIRI Card 的 `systemPrompt` 按 `card.systemPrompt`、`description`、`personality`、Artistry widget instruction 顺序拼接；companion card 只使用已编译 `systemPrompt` 和 Artistry instruction，避免身份与人格重复注入。

`packages/stage-ui/src/stores/characters.ts`、`models/characters.ts` 和 `services/characters.ts` 是本地优先的角色目录/远程 API 控制层，不是主 Stage 活动 AIRI Card 的替代品。中文陪伴预设必须适配现有 `useAiriCardStore`，不能创建第二套聊天角色状态。

### Prompt 与聊天调用链

```text
useAiriCardStore.systemPrompt
  -> useCharacterStore / character orchestrator
  -> packages/core-agent chat orchestrator runtime
  -> provider messages
  -> streamed response marker parser
  -> Stage text / TTS / ACT presentation
```

- `packages/stage-ui/src/stores/character/index.ts` 暴露活动角色名称和 system prompt。
- `packages/stage-ui/src/stores/character/orchestrator/store.ts` 将 system prompt 提供给 core-agent runtime。
- `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` 组合 system message、工具补充和运行时上下文。
- `packages/stage-ui/src/components/scenes/Stage.vue` 消费特殊 token；ACT/DELAY 解析实现在 queues/marker parser 相关模块中。

### ASR、TTS 与表现调用链

```text
MediaStream / recorded Blob
  -> useVAD + useHearingSpeechInputPipeline
  -> useHearingStore.transcription / streaming provider
  -> apps/stage-tamagotchi renderer requestIngest
  -> existing chat orchestrator

assistant literal / special token hooks
  -> Stage.vue TTS session and streaming-control dispatcher
  -> speech provider / playback manager
  -> analyser-driven lip sync + model-specific emotion/motion adapters
```

- ASR 主实现位于 `packages/stage-ui/src/stores/modules/hearing.ts`；流式和录制后转写最终由 `apps/stage-tamagotchi/src/renderer/pages/index.vue` 送入现有 chat-sync ingest，不是 companion 独立聊天入口。
- TTS session、播放取消、literal/special token 消费位于 `packages/stage-ui/src/components/scenes/Stage.vue` 和 `packages/stage-ui/src/libs/speech/tts-session.ts`。
- ACT/DELAY 由 core-agent marker parser 触发 `onTokenSpecial`，再由 Stage streaming-control dispatcher 路由；模型不支持某动作时只能降级。
- VRM 口型使用 `packages/stage-ui-three/src/components/Model/VRMModel.vue` 的 analyser/lip-sync 路径；Live2D 表情、参数和 motion 能力位于 `packages/stage-ui-live2d`。M1 没有增加情景动画导演。

### 持久化与可观测性

- AIRI Card map 和活动 ID 分别使用 `airi-cards`、`airi-card-active-id` 本地存储键；display model 文件由 `stores/display-models.ts` 管理 IndexedDB。
- companion card 在 extension 中持久化规范化 preset、Prompt section、绑定回退警告和激活前角色 ID。后者使设置窗口重开后仍可禁用 companion 并切回之前角色。
- core-agent/runtime 与 stage chat store 已记录 LLM TTFT、完整响应耗时、失败阶段/错误枚举和队列取消原因；新增 companion 安全日志只包含场景、风险和规则 ID。
- `use-io-tracer` 是本机 Devtools BroadcastChannel，不是外发 analytics。它可能包含供本地调试使用的 ASR/TTS 文本；外发 analytics 不应接收原始对话、Prompt、音频或图像。

### 当前能力边界

| 能力 | 状态 | 证据/限制 |
| --- | --- | --- |
| CCv3/AIRI Card 本地存储 | 已接入 | `useAiriCardStore` |
| YAML 中文陪伴预设 | 已接入 | Electron 文件边界、YAML/JSON 解析、预览和激活已实现 |
| 人格结构化编译 | 已接入 | 确定性 section 编译后写入 AIRI Card，并按每轮场景补充策略 |
| 程序级安全路由 | 已接入首版 | 输入场景路由与最终输出检查已实现；流式前缀拦截仍待后续里程碑 |
| 模型绑定同步 | 已接入但非事务 | 激活前检查已配置 Provider、已加载模型清单和显示模型；不可用项回退并告警，实际切换仍由 debounced watcher 异步完成 |
| ACT/DELAY 表现 token | 已接入 | 是否有对应动作取决于活动模型 |
| TTS 朗读 | 已接入 | 不包含自动打断、全双工和情感韵律保证 |
| 长期记忆 | 未实现 | 不在 M0/M1 范围 |
| 屏幕/摄像头/Minecraft 感知 | 存在独立基础模块 | 未接入中文陪伴策略闭环 |

## CompanionPreset 到 AIRI Card 的映射

| CompanionPreset | AIRI Card/CCv3 | 决策 |
| --- | --- | --- |
| `id` | 外部持久化元数据 | AIRI Card map key 由激活服务确定，不把 ID 塞进自然语言字段 |
| `version` | `Card.version` | 原样保留语义化版本 |
| `identity.name` | `Card.name` | 必填 |
| `identity.nickname` | CCv3 nickname/扩展元数据 | 内部 Card 暂无稳定 nickname 字段时保存在 companion extension |
| `identity.description` | `Card.description` | 只描述身份，不混入安全规则 |
| `behavior.personality` | `Card.personality` | 由确定性编译器生成稳定文本 |
| `behavior.primary_scenarios` | companion extension + Prompt section | 不挤入 tags 以免丢失顺序和语义 |
| `behavior.greeting` | `Card.greetings[0]` | 首条问候语 |
| `system_prompt` | 高级角色补充 section | 不能覆盖产品安全策略或声明不存在的能力 |
| `response_policy` | companion extension + Prompt section | 保留结构化字段供策略层使用 |
| `relationship_policy` | companion extension +安全 section | 产品安全优先级高于角色覆盖 |
| `safety_policy` | companion extension +安全路由 | 不只写进 Prompt |
| `model_bindings` | `extensions.airi.modules` | 可选绑定；缺失只警告，不阻止纯文本激活 |
| `presentation` | companion extension | 表现层可降级处理 |

## 无损映射限制

1. 当前 `AiriCard` 的主字段以自由文本为主，无法无损表达结构化回复、安全和关系策略，因此必须在 `extensions` 下保存规范化 companion preset 元数据。
2. 当前活动卡的模型同步仍由 watcher 完成，不具备跨 Provider 的事务语义。M1 激活服务会在写入前检查 Provider、已加载模型清单和显示模型；无法验证的 voice ID 或 Provider 运行时故障仍只能在后续状态中反馈。
3. AIRI Card 的 `systemPrompt` 仍被其他入口直接读取。M1 已将编译结果写入该字段以兼容现有链路，同时保留结构化 sections 供调试和后续重编译。
4. 模型 Provider/ID 的存在性依赖用户本地配置。预设可以声明绑定，但不得携带 API key，也不得因可选 Provider 缺失而阻止文本人格使用。

## M0 决策

- schema 和规范化逻辑归属 `@proj-airi/stage-ui/domains/companion`，保持无 Vue、Electron 和 Provider 依赖。
- YAML/JSON 解析属于平台入口；桌面端复用已有 `yaml` 包，解析后把 unknown value 交给领域验证器。
- schema 使用 Valibot `strictObject`，未知字段必须报错，防止 secret 和拼写错误被静默丢弃。
- 验证错误统一为 `{ path, code, message, suggestion }` 并稳定排序。
- 错误另外携带稳定修复动作，UI 使用 i18n 展示；敏感值、本机路径和明显安全覆盖指令在领域层拒绝。
- v1 不执行自动版本降级；未来迁移必须按 `schema_version` 显式注册。

## M1 实际接入

- 领域 schema、Prompt compiler 和策略：`packages/stage-ui/src/domains/companion/`
- AIRI Card 适配：`packages/stage-ui/src/services/companion.ts`
- 预览、按能力分类的绑定预检、重复 ID 二次确认、激活和恢复状态：`packages/stage-ui/src/stores/companion.ts`
- 活动卡原子安装入口：`useAiriCardStore.upsertAndActivateCard`
- 每轮策略和输出检查：`packages/stage-ui/src/stores/chat.ts`
- 通用最终输出替换边界：`packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`
- Eventa contract：`electronCompanionPresetPickFile`
- Electron 文件策略：`apps/stage-tamagotchi/src/main/services/electron/companionPreset.ts`
- YAML/JSON 解析：`apps/stage-tamagotchi/src/renderer/utils/companionPreset.ts`
- 设置页 UI：`CompanionPresetImportPanel.vue`

主进程只返回 basename 和受限 UTF-8 文本，不返回绝对路径。文件限制为 `.json`、`.yaml`、`.yml` 和 256 KiB；实际读取只分配 256 KiB + 1 byte，防止文件在 `stat` 后增长造成无界分配。YAML 和 JSON 均拒绝重复 key，YAML 另限制 alias 展开。预期文件错误通过稳定 Eventa result code 返回，由 renderer i18n 本地化，不显示原始文件系统或 parser 错误。

最近一次 `CardActivationSnapshot` 使用与 AIRI Card 相同的本地持久化边界保存。因此设置窗口重建后仍可恢复被同 ID 覆盖的旧卡；若快照缺失或其原活动卡已删除，才使用 companion extension 中的 `previousActiveCardId` 切回原角色。

## 后续验证点

- 在模型矩阵运行验收集并记录真实结果；不得沿用原型阶段的手工“通过”结论。
- Electron 实际窗口的设置页视觉检查已完成；原生文件选择、激活和回滚仍需在发布验收中完成一次人工端到端操作。
- 输出检查发生在流结束后，不能撤回已经触发的 TTS、ACT 或工具副作用；进入发布前需要决定是否为 companion 增加受控流式缓冲。
