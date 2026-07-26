export const PERCEPTION_CONTRACT_VERSION = 'perception/v0.3' as const

export const perceptionSourceKinds = ['screen', 'camera', 'minecraft'] as const
export const perceptionObjectiveSourceKinds = [
  'screen-local',
  'screen-cloud',
  'camera-local',
  'camera-cloud',
  'minecraft',
] as const
export const perceptionEventTypes = [
  'screen.activity.observed',
  'screen.app-class.observed',
  'screen.task-summary.observed',
  'screen.window-relation.observed',
  'screen.capture-health.changed',
  'person.presence.changed',
  'person.count.observed',
  'person.pose.observed',
  'person.gesture.observed',
  'person.observable-cue.observed',
  'person.activity-like.observed',
  'environment.lighting.observed',
  'environment.scene-class.observed',
  'object.presence.changed',
  'camera.capture-health.changed',
  'minecraft.connection-health.changed',
  'minecraft.player-status.observed',
  'minecraft.task-state.observed',
  'minecraft.nearby-threat.observed',
] as const

export type PerceptionSourceKind = typeof perceptionSourceKinds[number]
export type ObjectivePerceptionSourceKind = typeof perceptionObjectiveSourceKinds[number]
export type PerceptionEventType = typeof perceptionEventTypes[number]
export type PerceptionProcessingMode = 'local-only' | 'cloud-approved' | 'mixed'
export type PerceptionSessionState = 'idle' | 'requesting-permission' | 'running' | 'paused' | 'stopping' | 'failed' | 'stopped'
export type PerceptionModality = 'screen-frames' | 'camera-frames' | 'microphone-audio' | 'game-events'
export type PerceptionSensitivity = 'public' | 'personal' | 'sensitive' | 'prohibited'
export type PerceptionVerification = 'direct-signal' | 'multi-frame-inferred' | 'cloud-inferred'
export type RuntimePerceptionVerification = 'direct-signal' | 'inferred' | 'user-confirmed' | 'retracted'
export type PerceptionFactState = 'proposed' | 'accepted' | 'suppressed' | 'expired' | 'revoked'

export type PerceptionSessionErrorCode
  = | 'invalid-transition'
    | 'permission-required'
    | 'permission-denied'
    | 'consent-revoked'
    | 'owner-unavailable'
    | 'source-not-enabled'
    | 'stale-generation'
    | 'source-ended'
    | 'cleanup-failed'
    | 'unknown'

export type PerceptionSuppressionReason
  = | 'consent-missing'
    | 'source-unhealthy'
    | 'stale-generation'
    | 'invalid-schema'
    | 'unsupported-event-type'
    | 'prohibited-sensitivity'
    | 'sensitive-not-allowed'
    | 'low-confidence'
    | 'invalid-ttl'
    | 'expired'
    | 'temporal-insufficient'
    | 'conflict-lost'
    | 'duplicate-event'
    | 'rate-limited'
    | 'source-revoked'
    | 'user-retracted'
    | 'session-stopped'

export interface PerceptionSession {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  sessionId: string
  state: PerceptionSessionState
  enabledSources: PerceptionSourceKind[]
  activeSourceIds: string[]
  processingMode: PerceptionProcessingMode
  generation: number
  startedAt: number
  updatedAt: number
  lastErrorCode?: PerceptionSessionErrorCode
}

export interface PerceptionConsentGrant {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  grantId: string
  sourceKind: PerceptionSourceKind
  sourceId: string
  processingMode: PerceptionProcessingMode
  allowedModalities: PerceptionModality[]
  allowedFactCategories: string[]
  cloudProviderId?: string
  cloudModelId?: string
  regionId?: string
  costBoundaryId?: string
  grantedAt: number
  revokedAt?: number
  showPersistentIndicator: boolean
}

/** Metadata for a raw observation. `payloadRef` is deliberately opaque and runtime-only. */
export interface EphemeralObservation {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  observationId: string
  sessionId: string
  generation: number
  sourceKind: PerceptionSourceKind
  sourceId: string
  capturedAt: number
  monotonicTimestamp: number
  payloadKind: 'screen-frame' | 'camera-frame' | 'microphone-audio-chunk' | 'multimodal-window' | 'game-event'
  payloadRef: EphemeralPayloadRef
}

/** This token can identify an in-memory resource but can never carry its bytes. */
export interface EphemeralPayloadRef {
  readonly refId: string
  readonly byteLength: number
  readonly release: () => void
}

export type ObjectivePerceptionValue
  = | { kind: 'boolean', value: boolean }
    | { kind: 'number', value: number }
    | { kind: 'enum', value: string }
    | { kind: 'summary', value: string }

export interface PerceptionProvenance {
  analyzerId: string
  processing: 'local' | 'cloud'
  providerId?: string
  modelId?: string
  adapterId?: string
}

export interface ObjectivePerceptionEvent {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  eventId: string
  observationId: string
  sessionId: string
  generation: number
  sourceKind: ObjectivePerceptionSourceKind
  sourceId: string
  analyzers: string[]
  eventType: PerceptionEventType
  phase: 'started' | 'updated' | 'ended' | 'observed'
  subject: 'primary-user' | 'other-person' | 'environment' | 'allowlisted-object' | 'game-session'
  value: ObjectivePerceptionValue
  confidence: number
  observedAt: number
  expiresAt: number
  verification: PerceptionVerification
  sensitivity: PerceptionSensitivity
  provenance: PerceptionProvenance
}

export interface RuntimePerceptionFact {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  factId: string
  eventId: string
  observationId: string
  sessionId: string
  generation: number
  source: {
    kind: ObjectivePerceptionSourceKind
    sourceId: string
    adapterId?: string
  }
  category: string
  subject: ObjectivePerceptionEvent['subject']
  predicate: string
  value: ObjectivePerceptionValue
  confidence: number
  observedAt: number
  expiresAt: number
  sensitivity: PerceptionSensitivity
  provenance: PerceptionProvenance
  state: PerceptionFactState
  verification: RuntimePerceptionVerification
  suppressionReason?: PerceptionSuppressionReason
}

export interface PerceptionSourceCapabilities {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  sourceKind: PerceptionSourceKind
  sourceId: string
  modalities: PerceptionModality[]
  factCategories: string[]
  processing: 'local' | 'cloud' | 'mixed'
  supportsPermission: boolean
  supportsPause: boolean
  supportsStop: boolean
  cadenceMs: { min: number, max: number }
  latencyMs: { expected: number, timeout: number }
  payloadLimits: { maxBytes: number, maxItems: number }
  providesConfidence: boolean
  mayContainSensitiveContent: boolean
  requiresCloudAudioPrerequisite: boolean
}

export interface PerceptionSourceHealth {
  sourceId: string
  sourceKind: PerceptionSourceKind
  status: 'unknown' | 'healthy' | 'degraded' | 'failed' | 'stopped'
  updatedAt: number
  errorCode?: string
}

export interface PerceptionStateSnapshot {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  snapshotId: string
  sessionId: string
  generation: number
  updatedAt: number
  acceptedFactIds: string[]
  sourceHealth: PerceptionSourceHealth[]
  activeStates: Array<{ factId: string, category: string, predicate: string, subject: string }>
  reactionCandidateIds: string[]
  stageActuationCandidateIds: string[]
  shortTermRetention: 'none' | 'until-expiry' | 'until-session-end'
}

export interface PerceptionContextProjection {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  projectionId: string
  factIds: string[]
  createdAt: number
  expiresAt: number
  sourceSummary: string
  statements: string[]
  maxCharacters: number
  maxFacts: number
}

export interface PerceptionReactionCandidate {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  candidateId: string
  triggerFactIds: string[]
  salience: number
  mode: 'context-only' | 'suggest-reaction'
  cooldownKey: string
  createdAt: number
  expiresAt: number
  reasonCode: string
}

export interface StageActuationIntentLite {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  intentId: string
  triggerFactIds: string[]
  state: 'neutral' | 'attentive' | 'concerned' | 'celebratory'
  intensity: number
  createdAt: number
  expiresAt: number
}

export interface MemoryOnlyMediaRef {
  refId: string
  byteLength: number
  capturedAt: number
}

export interface MultimodalPerceptionWindow {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  windowId: string
  observationId: string
  sessionId: string
  generation: number
  startedAt: number
  endedAt: number
  monotonicTimestampBase: number
  audioFormat: 'pcm-s16le-16000-mono'
  audioChunkRefs: MemoryOnlyMediaRef[]
  imageFrameRefs: MemoryOnlyMediaRef[]
  trigger: 'speech-turn-ended' | 'significant-visual-change' | 'bounded-periodic-sample' | 'manual-test'
  consentGrantId: string
  providerId: string
  modelId: string
}

export interface ScreenPerceptionRoutingPolicy {
  residentModelId: 'qwen3.5-omni-flash-realtime'
  escalationModelId: 'qwen3.5-omni-plus-realtime'
  resolution: '1280x720'
  normalFpsMax: 0.2
  activeFpsMax: 1
  outputMode: 'text-encoded-objective-json'
  confidenceEscalationThreshold: number
  historyLookbackMs: number
}

export type ScreenModelRouteReason
  = | 'flash-low-confidence'
    | 'consecutive-conflict'
    | 'complex-multi-window-relation'
    | 'temporal-process-reasoning'
    | 'user-requested-process-analysis'
    | 'tool-relevance-uncertain'

export interface ScreenModelRouteDecision {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  decisionId: string
  sessionId: string
  generation: number
  fromModelId: string
  toModelId: string
  reason: ScreenModelRouteReason
  evidenceFactIds: string[]
  createdAt: number
  expiresAt: number
  consentGrantId: string
  costCounterId: string
}

export interface LocalScreenAnalyzerProfile {
  contractVersion: typeof PERCEPTION_CONTRACT_VERSION
  profileId: string
  adapterId: string
  generation: number
  modelId: 'Qwen/Qwen3-VL-4B-Instruct'
  runtimeKind: 'ollama' | 'vllm' | 'transformers-service'
  revision?: string
  quantizationId?: string
  deviceClass?: string
  targetResolution: '1280x720'
  normalFpsMax: 0.2
  activeFpsMax: 1
  state: 'unconfigured' | 'stopped' | 'starting' | 'validating' | 'ready' | 'degraded' | 'failed' | 'stopping'
  capabilities: string[]
  lastErrorCode?: string
  latencyClass?: string
  resourceClass?: string
}

export interface ScreenAnalyzerSelection {
  mode: 'off' | 'local-qwen3-vl' | 'cloud-qwen-omni'
  generation: number
}
