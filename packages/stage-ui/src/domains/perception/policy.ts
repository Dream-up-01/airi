import type {
  ObjectivePerceptionEvent,
  ObjectivePerceptionValue,
  PerceptionEventType,
  PerceptionSourceKind,
} from './contracts'

export interface PerceptionEventPolicy {
  category: string
  predicate: string
  defaultTtlMs: number
  maxTtlMs: number
  minimumConfidence: number
  minimumSamples: number
  smoothingWindowMs: number
  allowedValueKinds: ObjectivePerceptionValue['kind'][]
}

const screenPolicy = { defaultTtlMs: 20_000, maxTtlMs: 30_000, minimumConfidence: 0.55, minimumSamples: 1, smoothingWindowMs: 10_000 }
const cameraFastPolicy = { defaultTtlMs: 3_000, maxTtlMs: 5_000, minimumConfidence: 0.6, minimumSamples: 1, smoothingWindowMs: 1_500 }
const cameraSmoothedPolicy = { defaultTtlMs: 4_000, maxTtlMs: 10_000, minimumConfidence: 0.65, minimumSamples: 2, smoothingWindowMs: 2_000 }
const minecraftPolicy = { defaultTtlMs: 15_000, maxTtlMs: 30_000, minimumConfidence: 0.5, minimumSamples: 1, smoothingWindowMs: 2_000 }

export const perceptionEventPolicies: Record<PerceptionEventType, PerceptionEventPolicy> = {
  'screen.activity.observed': { ...screenPolicy, category: 'screen.activity', predicate: 'activity', minimumSamples: 2, allowedValueKinds: ['enum'] },
  'screen.app-class.observed': { ...screenPolicy, category: 'screen.application', predicate: 'app-class', allowedValueKinds: ['enum'] },
  'screen.task-summary.observed': { ...screenPolicy, category: 'screen.task', predicate: 'task-summary', minimumConfidence: 0.65, allowedValueKinds: ['summary'] },
  'screen.window-relation.observed': { ...screenPolicy, category: 'screen.window', predicate: 'window-relation', minimumSamples: 2, allowedValueKinds: ['enum', 'summary'] },
  'screen.capture-health.changed': { ...screenPolicy, category: 'screen.health', predicate: 'capture-health', minimumConfidence: 0, allowedValueKinds: ['enum'] },
  'person.presence.changed': { ...cameraFastPolicy, category: 'person.presence', predicate: 'present', allowedValueKinds: ['boolean'] },
  'person.count.observed': { ...cameraFastPolicy, category: 'person.count', predicate: 'count', allowedValueKinds: ['number'] },
  'person.pose.observed': { ...cameraSmoothedPolicy, category: 'person.pose', predicate: 'pose', allowedValueKinds: ['enum'] },
  'person.gesture.observed': { ...cameraSmoothedPolicy, category: 'person.gesture', predicate: 'gesture', allowedValueKinds: ['enum'] },
  'person.observable-cue.observed': { ...cameraSmoothedPolicy, category: 'person.observable-cue', predicate: 'cue', allowedValueKinds: ['enum'] },
  'person.activity-like.observed': { ...cameraSmoothedPolicy, category: 'person.activity-like', predicate: 'activity-like', minimumConfidence: 0.7, allowedValueKinds: ['enum'] },
  'environment.lighting.observed': { ...cameraFastPolicy, category: 'environment.lighting', predicate: 'lighting', allowedValueKinds: ['enum'] },
  'environment.scene-class.observed': { ...cameraSmoothedPolicy, category: 'environment.scene', predicate: 'scene-class', allowedValueKinds: ['enum'] },
  'object.presence.changed': { ...cameraSmoothedPolicy, category: 'object.presence', predicate: 'present', allowedValueKinds: ['boolean', 'enum'] },
  'camera.capture-health.changed': { ...cameraFastPolicy, category: 'camera.health', predicate: 'capture-health', minimumConfidence: 0, allowedValueKinds: ['enum'] },
  'minecraft.connection-health.changed': { ...minecraftPolicy, category: 'minecraft.health', predicate: 'connection-health', minimumConfidence: 0, allowedValueKinds: ['enum'] },
  'minecraft.player-status.observed': { ...minecraftPolicy, category: 'minecraft.player', predicate: 'player-status', allowedValueKinds: ['enum', 'summary'] },
  'minecraft.task-state.observed': { ...minecraftPolicy, category: 'minecraft.task', predicate: 'task-state', allowedValueKinds: ['enum', 'summary'] },
  'minecraft.nearby-threat.observed': { ...minecraftPolicy, category: 'minecraft.threat', predicate: 'nearby-threat', minimumConfidence: 0.65, allowedValueKinds: ['boolean', 'enum'] },
}

export const sourceReliability: Record<ObjectivePerceptionEvent['sourceKind'], number> = {
  'screen-local': 0.9,
  'screen-cloud': 0.7,
  'camera-local': 0.9,
  'camera-cloud': 0.7,
  'minecraft': 1,
}

export const objectiveSourceToSourceKind: Record<ObjectivePerceptionEvent['sourceKind'], PerceptionSourceKind> = {
  'screen-local': 'screen',
  'screen-cloud': 'screen',
  'camera-local': 'camera',
  'camera-cloud': 'camera',
  'minecraft': 'minecraft',
}

export const allowedPerceptionEnumValuesByCategory: Readonly<Record<string, readonly string[]>> = {
  'screen.activity': ['video', 'game', 'document', 'code', 'browser', 'chat', 'meeting', 'idle', 'unknown'],
  'screen.application': ['browser', 'video', 'game', 'document-editor', 'code-editor', 'chat', 'meeting', 'system', 'unknown'],
  'screen.window': ['single-window', 'side-by-side', 'overlapping', 'fullscreen', 'unknown'],
  'screen.health': ['healthy', 'paused', 'permission-denied', 'source-ended', 'failed', 'stopped'],
  'person.pose': ['upright', 'seated', 'standing', 'head-down', 'leaning', 'unknown'],
  'person.gesture': ['hand-raised', 'waving', 'thumbs-up', 'hands-visible', 'unknown'],
  'person.observable-cue': ['smile-like', 'eyes-closed', 'face-occluded', 'looking-away', 'unknown'],
  'person.activity-like': ['still', 'moving', 'typing-like', 'speaking-like', 'unknown'],
  'environment.lighting': ['dark', 'dim', 'normal', 'bright', 'backlit', 'unknown'],
  'environment.scene': ['indoor', 'outdoor', 'desk-like', 'room-like', 'unknown'],
  'object.presence': ['person', 'cup', 'bottle', 'book', 'laptop', 'keyboard', 'mouse', 'cell-phone', 'chair', 'cat', 'dog'],
  'camera.health': ['healthy', 'paused', 'permission-denied', 'track-ended', 'failed', 'stopped'],
  'minecraft.health': ['connected', 'degraded', 'disconnected', 'stale'],
  'minecraft.player': ['safe', 'injured', 'low-health', 'hungry', 'underwater', 'unknown'],
  'minecraft.task': ['idle', 'in-progress', 'completed', 'blocked', 'unknown'],
  'minecraft.threat': ['none', 'low', 'medium', 'high', 'unknown'],
}

export function validateEventPolicy(event: ObjectivePerceptionEvent): 'unsupported-value-kind' | 'unsupported-enum-value' | undefined {
  const policy = perceptionEventPolicies[event.eventType]
  if (!policy.allowedValueKinds.includes(event.value.kind))
    return 'unsupported-value-kind'

  if (event.value.kind !== 'enum')
    return validateNumericEventValue(event)

  const allowlist = allowedPerceptionEnumValuesByCategory[policy.category]
  if (allowlist && !allowlist.includes(event.value.value))
    return 'unsupported-enum-value'
}

function validateNumericEventValue(event: ObjectivePerceptionEvent): 'unsupported-value-kind' | undefined {
  if (event.eventType === 'person.count.observed') {
    if (event.value.kind !== 'number' || !Number.isInteger(event.value.value) || event.value.value < 0 || event.value.value > 16)
      return 'unsupported-value-kind'
  }
}
