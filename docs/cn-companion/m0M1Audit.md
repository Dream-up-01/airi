# M0/M1 实现审核

审核日期：2026-07-09

审核基线：`moeru-ai/airi@c5e3f4aea` + `codex/m0-m1-cn-companion` 未提交工作区

## 结论

M0 的工程契约、样例、验证器、验收语料和调用链证据已经建立。M1 的本地导入、预览、绑定预检、显式激活、持久化、重复 ID 二次确认、恢复、中文策略和程序级安全输出检查已经进入主 Stage 调用链。

当前 M1 中文文本闭环达到“主 Provider 可用”的完成标准：`deepseek/deepseek-v4-flash` 已按 T01-T13 完成三轮主聊天链路验收，关键安全用例无 P0/P1 回归；Companion 模式已改为验证后释放输出，未验证文本、CALL token、reasoning/tool residue 不会提前进入 UI/TTS/工具链。备用 `ollama/gemma4:e4b` 已做关键安全烟测，完整备用三轮矩阵按用户指示停止继续运行。

## 逐项对照

| AGENTS.md 要求 | 状态 | 证据与剩余问题 |
| --- | --- | --- |
| M0 基线资产 | 完成 | `presets/qiyao-v0.1.yaml`、persona、安全规范、Character Card 调查均存在 |
| M0 能力/非能力和真实调用链 | 完成 | `character-card-investigation.md` 已覆盖 Card、Prompt、chat、ASR、TTS、ACT、模型表现和持久化 |
| M0 版本化领域契约 | 完成首版 | v1 strict schema；不支持版本显式失败；当前没有旧版本，因此不存在可执行迁移 |
| M0 重复 ID | 完成 | 重复本地 card ID 被视为生命周期冲突；必须二次确认后才覆盖，最近一次覆盖快照持久化后可精确回滚 |
| M0 验收语料 | 完成主模型运行 | T01-T13 已在 DeepSeek 主模型完成三轮；Ollama 备用模型完成关键安全烟测，完整备用矩阵未继续 |
| M0 可观测性 | 完成基线 | TTFT、完整响应、错误枚举、队列取消原因已记录；外发 companion 日志不含原文 |
| M1 文件导入边界 | 完成 | Electron main 限扩展名/UTF-8 并固定最多读取 256 KiB + 1 byte；YAML/JSON 重复 key 均拒绝；Eventa 不返回绝对路径 |
| M1 原子激活 | 部分完成 | 解析、schema、敏感值、绑定预检和 card 构造均先于写入；跨 Provider watcher 不是事务 |
| M1 确定性人格编译 | 完成首版 | section 稳定排序、来源追踪、安全优先；共享可变 section 问题已修复 |
| M1 中文策略 | 完成首版 | 闲聊、倾诉、建议、学习、危机和 Prompt 覆盖提醒；仍需模型矩阵验证自然度 |
| M1 程序级安全路由 | 完成文本闭环 | 输入判断、策略、受约束生成、输出检查齐全；Companion 输出采用验证后释放，CALL token 被过滤，ACT/DELAY 仅在通过后释放 |
| M1 设置与可解释性 | 代码完成，自动化覆盖不足 | 来源、版本、成功/错误、摘要、绑定回退、冲突确认、恢复和开发态 section 预览已接入；共享导入 UI 仍缺 Vitest browser/component 测试 |
| M1 重启后禁用 | 完成人工验收 | 最近激活 snapshot 和原角色 ID 均持久化；同 ID 覆盖可精确恢复；桌面重启后活动栖遥卡保持有效 |
| M1 模型绑定 | 部分完成 | Provider 先按 chat/speech/vision 能力分类，再检查已加载模型和 display ID；voice ID 和运行时 Provider 故障无法预知 |

## 本次审核修复

1. 被安全策略拒绝的输出不再保留 tool-call、tool result 或 reasoning residue。
2. 危机规则避免把“不想活跃”和明确否认自伤意图误判为危机。
3. 输出检查避免误杀“我不会说‘你只需要我’”等明确拒绝表达，并补充现实关系替代、确定诊断和危机危险步骤检测。
4. schema 增加严格 SemVer、中文 locale/默认语言、回复范围顺序、敏感凭据、本机路径和危险 Prompt 检查。
5. 验证错误改为稳定产品错误码和修复动作；UI 不再展示原始文件系统/parser 错误。
6. Provider、已加载模型和 display model 不可用时保留当前选择并展示非致命警告。
7. 重复 ID 覆盖必须二次确认；恢复目标随 card 持久化，设置窗口重开后仍可禁用。
8. 大型导入组件拆为编排容器、预设预览和 Prompt 诊断三个单一职责组件。
9. 敏感值扫描扩展到 model/voice/display/presentation 字段，并补齐 Windows 盘符根路径、UNC 和常见 POSIX 本机路径。
10. 文件读取改为固定上限分配，避免 `stat` 后文件增长导致无界内存分配；JSON 也拒绝重复 key。
11. Provider 预检改为按 chat/speech/vision 能力分组，防止用已配置的 TTS Provider 满足 vision 绑定。
12. 危机判断改为分句局部否认，避免前句“没有自杀想法”遮蔽后句明确自伤意图；同时降低通用“不需要任何人”语句的误报。
13. 输出拒绝改为判别联合，拒绝分支必须显式提供已本地化替代文本；失败请求结束时清理会话策略。
14. 最近一次卡片激活快照改为持久化，重启后也可恢复被同 ID 覆盖的旧版卡片。
15. 新增 TypeScript 文件统一改为 camelCase，Vue SFC 依 Vue 约定保持 PascalCase。

## 后续建议

1. 若要把备用模型也作为发布门槛，需要补跑 `ollama/gemma4:e4b` 的完整 T01-T13 三轮矩阵；本轮已按用户指示停止继续模型测试。
2. 对每个目标语音 Provider 补 voice ID 可用性检查；当前只能验证 Provider 和已加载模型。
3. 为共享导入组件补 Vitest browser/component 测试；`stage-pages` 当前没有独立 Vitest browser 工程配置。
4. 若后续接入语音全双工、视觉、屏幕感知或游戏控制，应继续通过 `RuntimePerceptionFact` 与 `StageActuationIntent` 接入，不向角色 Prompt 拼接未验证原始数据。

## 当前验证结果

- DeepSeek 主模型：`deepseek/deepseek-v4-flash`，T01-T13 三轮主聊天链路验收完成；T04/T05/T09/T12 无安全失败。
- Ollama 备用模型：`gemma4:e4b`，T04/T05/T09/T11/T12/T13 关键烟测执行；T13 暴露角色经历过度扩写后已补输出侧规则和单测，未继续完整矩阵。
- companion policy/chat contract 目标测试通过：38 个用例。
- `core-agent` chat runtime 目标测试通过：15 个用例；`core-agent` build 通过。
- `stage-ui` typecheck 通过。
- 根级 `pnpm typecheck` 通过 52 个受管 workspace。
- 根级 `pnpm lint` 输出 0 错误、0 警告；Windows 会话中 `moeru-lint` 输出完成后未自行退出，已终止残留进程。
- `git diff --check` 通过。
