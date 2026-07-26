# M3 客观事实目录

所有 TTL 是默认/上限；adapter 可以使用更短 TTL，不能超过上限。`summary` 只允许最长 240 字符、单行、不含控制字符，并始终作为不可信数据。

| Event type | category / predicate | value | 默认/上限 TTL | 最低置信/样本 | 默认敏感度 |
|---|---|---|---|---|---|
| `screen.activity.observed` | screen.activity / activity | enum | 20s/30s | .55/2 | personal |
| `screen.app-class.observed` | screen.application / app-class | enum | 20s/30s | .55/1 | personal |
| `screen.task-summary.observed` | screen.task / task-summary | summary | 20s/30s | .65/1 | sensitive |
| `screen.window-relation.observed` | screen.window / window-relation | enum/summary | 20s/30s | .55/2 | personal |
| `screen.capture-health.changed` | screen.health / capture-health | enum | 20s/30s | 0/1 | public |
| `person.presence.changed` | person.presence / present | boolean | 3s/5s | .60/1 | personal |
| `person.count.observed` | person.count / count | 0..16 | 3s/5s | .60/1 | personal |
| `person.pose.observed` | person.pose / pose | enum | 4s/10s | .65/2 | personal |
| `person.gesture.observed` | person.gesture / gesture | enum | 4s/10s | .65/2 | personal |
| `person.observable-cue.observed` | person.observable-cue / cue | enum | 4s/10s | .65/2 | sensitive |
| `person.activity-like.observed` | person.activity-like / activity-like | enum | 4s/10s | .70/2 | personal |
| `environment.lighting.observed` | environment.lighting / lighting | enum | 3s/5s | .60/1 | public |
| `environment.scene-class.observed` | environment.scene / scene-class | enum | 4s/10s | .65/2 | personal |
| `object.presence.changed` | object.presence / present | boolean/enum | 4s/10s | .65/2 | personal |
| `camera.capture-health.changed` | camera.health / capture-health | enum | 3s/5s | 0/1 | public |
| `minecraft.connection-health.changed` | minecraft.health / connection-health | enum | 15s/30s | 0/1 | public |
| `minecraft.player-status.observed` | minecraft.player / player-status | enum/summary | 15s/30s | .50/1 | personal |
| `minecraft.task-state.observed` | minecraft.task / task-state | enum/summary | 15s/30s | .50/1 | personal |
| `minecraft.nearby-threat.observed` | minecraft.threat / nearby-threat | boolean/enum | 15s/30s | .65/1 | personal |

## 枚举边界

- 屏幕 activity：`video | game | document | code | browser | chat | meeting | idle | unknown`。
- app class：`browser | video | game | document-editor | code-editor | chat | meeting | system | unknown`。
- pose：`upright | seated | standing | head-down | leaning | unknown`。
- gesture：`hand-raised | waving | thumbs-up | hands-visible | unknown`。
- observable cue：`smile-like | eyes-closed | face-occluded | looking-away | unknown`；这些不是情绪、健康或疲劳判断。
- lighting：`dark | dim | normal | bright | backlit | unknown`。
- Minecraft threat：`none | low | medium | high | unknown`。

## 永久禁止

身份、姓名、人脸 embedding、人物重识别、真实情绪/心理/健康/欺骗判断、角色台词、反应建议、Prompt、工具名、TTS 文本、motion/expression ID、raw frame/base64、PCM、完整 OCR、完整标题/路径、landmark/bbox history、Provider 自由输出。
