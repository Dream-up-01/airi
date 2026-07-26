import type { InferOutput } from 'valibot'

import {
  array,
  boolean,
  check,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
  union,
} from 'valibot'

import {
  PERCEPTION_CONTRACT_VERSION,
  perceptionEventTypes,
  perceptionObjectiveSourceKinds,
  perceptionSourceKinds,
} from './contracts'

const identifier = pipe(string(), minLength(1), maxLength(160), regex(/^[a-z0-9][\w.:-]*$/iu))
const timestamp = pipe(number(), integer(), minValue(0))
const generation = pipe(number(), integer(), minValue(0))
const confidence = pipe(number(), minValue(0), maxValue(1))
const boundedIds = pipe(array(identifier), maxLength(64))
const boundedSummary = pipe(string(), minLength(1), maxLength(240), check(value => !containsAsciiControl(value)))

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

export const ObjectivePerceptionValueSchema = union([
  strictObject({ kind: literal('boolean'), value: boolean() }),
  strictObject({ kind: literal('number'), value: pipe(number(), minValue(-1_000_000), maxValue(1_000_000)) }),
  strictObject({ kind: literal('enum'), value: pipe(string(), minLength(1), maxLength(80), regex(/^[a-z0-9][a-z0-9._:-]*$/u)) }),
  strictObject({ kind: literal('summary'), value: boundedSummary }),
])

export const PerceptionProvenanceSchema = strictObject({
  analyzerId: identifier,
  processing: picklist(['local', 'cloud']),
  providerId: optional(identifier),
  modelId: optional(pipe(string(), minLength(1), maxLength(160))),
  adapterId: optional(identifier),
})

export const PerceptionSessionSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  sessionId: identifier,
  state: picklist(['idle', 'requesting-permission', 'running', 'paused', 'stopping', 'failed', 'stopped']),
  enabledSources: pipe(array(picklist(perceptionSourceKinds)), maxLength(3)),
  activeSourceIds: boundedIds,
  processingMode: picklist(['local-only', 'cloud-approved', 'mixed']),
  generation,
  startedAt: timestamp,
  updatedAt: timestamp,
  lastErrorCode: optional(picklist([
    'invalid-transition',
    'permission-required',
    'permission-denied',
    'consent-revoked',
    'owner-unavailable',
    'source-not-enabled',
    'stale-generation',
    'source-ended',
    'cleanup-failed',
    'unknown',
  ])),
})

export const PerceptionConsentGrantSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  grantId: identifier,
  sourceKind: picklist(perceptionSourceKinds),
  sourceId: identifier,
  processingMode: picklist(['local-only', 'cloud-approved', 'mixed']),
  allowedModalities: pipe(array(picklist(['screen-frames', 'camera-frames', 'microphone-audio', 'game-events'])), minLength(1), maxLength(4)),
  allowedFactCategories: pipe(array(identifier), minLength(1), maxLength(64)),
  cloudProviderId: optional(identifier),
  cloudModelId: optional(pipe(string(), minLength(1), maxLength(160))),
  regionId: optional(identifier),
  costBoundaryId: optional(identifier),
  grantedAt: timestamp,
  revokedAt: optional(timestamp),
  showPersistentIndicator: boolean(),
})

export const EphemeralObservationMetadataSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  observationId: identifier,
  sessionId: identifier,
  generation,
  sourceKind: picklist(perceptionSourceKinds),
  sourceId: identifier,
  capturedAt: timestamp,
  monotonicTimestamp: pipe(number(), minValue(0)),
  payloadKind: picklist(['screen-frame', 'camera-frame', 'microphone-audio-chunk', 'multimodal-window', 'game-event']),
})

export const ObjectivePerceptionEventSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  eventId: identifier,
  observationId: identifier,
  sessionId: identifier,
  generation,
  sourceKind: picklist(perceptionObjectiveSourceKinds),
  sourceId: identifier,
  analyzers: pipe(array(identifier), minLength(1), maxLength(8)),
  eventType: picklist(perceptionEventTypes),
  phase: picklist(['started', 'updated', 'ended', 'observed']),
  subject: picklist(['primary-user', 'other-person', 'environment', 'allowlisted-object', 'game-session']),
  value: ObjectivePerceptionValueSchema,
  confidence,
  observedAt: timestamp,
  expiresAt: timestamp,
  verification: picklist(['direct-signal', 'multi-frame-inferred', 'cloud-inferred']),
  sensitivity: picklist(['public', 'personal', 'sensitive', 'prohibited']),
  provenance: PerceptionProvenanceSchema,
})

export const RuntimePerceptionFactSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  factId: identifier,
  eventId: identifier,
  observationId: identifier,
  sessionId: identifier,
  generation,
  source: strictObject({
    kind: picklist(perceptionObjectiveSourceKinds),
    sourceId: identifier,
    adapterId: optional(identifier),
  }),
  category: identifier,
  subject: picklist(['primary-user', 'other-person', 'environment', 'allowlisted-object', 'game-session']),
  predicate: identifier,
  value: ObjectivePerceptionValueSchema,
  confidence,
  observedAt: timestamp,
  expiresAt: timestamp,
  sensitivity: picklist(['public', 'personal', 'sensitive', 'prohibited']),
  provenance: PerceptionProvenanceSchema,
  state: picklist(['proposed', 'accepted', 'suppressed', 'expired', 'revoked']),
  verification: picklist(['direct-signal', 'inferred', 'user-confirmed', 'retracted']),
  suppressionReason: optional(picklist([
    'consent-missing',
    'source-unhealthy',
    'stale-generation',
    'invalid-schema',
    'unsupported-event-type',
    'prohibited-sensitivity',
    'sensitive-not-allowed',
    'low-confidence',
    'invalid-ttl',
    'expired',
    'temporal-insufficient',
    'conflict-lost',
    'duplicate-event',
    'rate-limited',
    'source-revoked',
    'user-retracted',
    'session-stopped',
  ])),
})

export const PerceptionSourceCapabilitiesSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  sourceKind: picklist(perceptionSourceKinds),
  sourceId: identifier,
  modalities: pipe(array(picklist(['screen-frames', 'camera-frames', 'microphone-audio', 'game-events'])), maxLength(4)),
  factCategories: pipe(array(identifier), maxLength(64)),
  processing: picklist(['local', 'cloud', 'mixed']),
  supportsPermission: boolean(),
  supportsPause: boolean(),
  supportsStop: boolean(),
  cadenceMs: strictObject({
    min: pipe(number(), integer(), minValue(0), maxValue(3_600_000)),
    max: pipe(number(), integer(), minValue(0), maxValue(3_600_000)),
  }),
  latencyMs: strictObject({
    expected: pipe(number(), integer(), minValue(0), maxValue(3_600_000)),
    timeout: pipe(number(), integer(), minValue(1), maxValue(3_600_000)),
  }),
  payloadLimits: strictObject({
    maxBytes: pipe(number(), integer(), minValue(0), maxValue(64 * 1024 * 1024)),
    maxItems: pipe(number(), integer(), minValue(0), maxValue(10_000)),
  }),
  providesConfidence: boolean(),
  mayContainSensitiveContent: boolean(),
  requiresCloudAudioPrerequisite: boolean(),
})

const PerceptionSourceHealthSchema = strictObject({
  sourceId: identifier,
  sourceKind: picklist(perceptionSourceKinds),
  status: picklist(['unknown', 'healthy', 'degraded', 'failed', 'stopped']),
  updatedAt: timestamp,
  errorCode: optional(identifier),
})

export const PerceptionStateSnapshotSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  snapshotId: identifier,
  sessionId: identifier,
  generation,
  updatedAt: timestamp,
  acceptedFactIds: pipe(array(identifier), maxLength(64)),
  sourceHealth: pipe(array(PerceptionSourceHealthSchema), maxLength(32)),
  activeStates: pipe(array(strictObject({
    factId: identifier,
    category: identifier,
    predicate: identifier,
    subject: identifier,
  })), maxLength(64)),
  reactionCandidateIds: pipe(array(identifier), maxLength(32)),
  stageActuationCandidateIds: pipe(array(identifier), maxLength(32)),
  shortTermRetention: picklist(['none', 'until-expiry', 'until-session-end']),
})

export const PerceptionContextProjectionSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  projectionId: identifier,
  factIds: pipe(array(identifier), maxLength(16)),
  createdAt: timestamp,
  expiresAt: timestamp,
  sourceSummary: pipe(string(), maxLength(240)),
  statements: pipe(array(boundedSummary), maxLength(16)),
  maxCharacters: pipe(number(), integer(), minValue(1), maxValue(4_000)),
  maxFacts: pipe(number(), integer(), minValue(1), maxValue(16)),
})

export const PerceptionReactionCandidateSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  candidateId: identifier,
  triggerFactIds: pipe(array(identifier), minLength(1), maxLength(16)),
  salience: confidence,
  mode: picklist(['context-only', 'suggest-reaction']),
  cooldownKey: identifier,
  createdAt: timestamp,
  expiresAt: timestamp,
  reasonCode: identifier,
})

export const StageActuationIntentLiteSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  intentId: identifier,
  triggerFactIds: pipe(array(identifier), minLength(1), maxLength(16)),
  state: picklist(['neutral', 'attentive', 'concerned', 'celebratory']),
  intensity: confidence,
  createdAt: timestamp,
  expiresAt: timestamp,
})

const MemoryOnlyMediaRefSchema = strictObject({
  refId: identifier,
  byteLength: pipe(number(), integer(), minValue(0), maxValue(64 * 1024 * 1024)),
  capturedAt: timestamp,
})

export const MultimodalPerceptionWindowSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  windowId: identifier,
  observationId: identifier,
  sessionId: identifier,
  generation,
  startedAt: timestamp,
  endedAt: timestamp,
  monotonicTimestampBase: pipe(number(), minValue(0)),
  audioFormat: literal('pcm-s16le-16000-mono'),
  audioChunkRefs: pipe(array(MemoryOnlyMediaRefSchema), maxLength(2_000)),
  imageFrameRefs: pipe(array(MemoryOnlyMediaRefSchema), maxLength(24)),
  trigger: picklist(['speech-turn-ended', 'significant-visual-change', 'bounded-periodic-sample', 'manual-test']),
  consentGrantId: identifier,
  providerId: identifier,
  modelId: pipe(string(), minLength(1), maxLength(160)),
})

export const ScreenPerceptionRoutingPolicySchema = strictObject({
  residentModelId: literal('qwen3.5-omni-flash-realtime'),
  escalationModelId: literal('qwen3.5-omni-plus-realtime'),
  resolution: literal('1280x720'),
  normalFpsMax: literal(0.2),
  activeFpsMax: literal(1),
  outputMode: literal('text-encoded-objective-json'),
  confidenceEscalationThreshold: confidence,
  historyLookbackMs: pipe(number(), integer(), minValue(120_000), maxValue(240_000)),
})

export const ScreenModelRouteDecisionSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  decisionId: identifier,
  sessionId: identifier,
  generation,
  fromModelId: pipe(string(), minLength(1), maxLength(160)),
  toModelId: pipe(string(), minLength(1), maxLength(160)),
  reason: picklist([
    'flash-low-confidence',
    'consecutive-conflict',
    'complex-multi-window-relation',
    'temporal-process-reasoning',
    'user-requested-process-analysis',
    'tool-relevance-uncertain',
  ]),
  evidenceFactIds: pipe(array(identifier), minLength(1), maxLength(24)),
  createdAt: timestamp,
  expiresAt: timestamp,
  consentGrantId: identifier,
  costCounterId: identifier,
})

export const LocalScreenAnalyzerProfileSchema = strictObject({
  contractVersion: literal(PERCEPTION_CONTRACT_VERSION),
  profileId: identifier,
  adapterId: identifier,
  generation,
  modelId: literal('Qwen/Qwen3-VL-4B-Instruct'),
  runtimeKind: picklist(['ollama', 'vllm', 'transformers-service']),
  revision: optional(pipe(string(), minLength(1), maxLength(160))),
  quantizationId: optional(identifier),
  deviceClass: optional(identifier),
  targetResolution: literal('1280x720'),
  normalFpsMax: literal(0.2),
  activeFpsMax: literal(1),
  state: picklist(['unconfigured', 'stopped', 'starting', 'validating', 'ready', 'degraded', 'failed', 'stopping']),
  capabilities: pipe(array(identifier), maxLength(32)),
  lastErrorCode: optional(identifier),
  latencyClass: optional(identifier),
  resourceClass: optional(identifier),
})

export const ScreenAnalyzerSelectionSchema = strictObject({
  mode: picklist(['off', 'local-qwen3-vl', 'cloud-qwen-omni']),
  generation,
})

export type ParsedObjectivePerceptionEvent = InferOutput<typeof ObjectivePerceptionEventSchema>

export type PerceptionParseResult<T>
  = | { ok: true, value: T }
    | { ok: false, code: 'invalid-schema', issues: Array<{ path: string, message: string }> }

export function parseObjectivePerceptionEvent(input: unknown): PerceptionParseResult<ParsedObjectivePerceptionEvent> {
  const result = safeParse(ObjectivePerceptionEventSchema, input)
  if (result.success)
    return { ok: true, value: result.output }

  return {
    ok: false,
    code: 'invalid-schema',
    issues: result.issues.slice(0, 16).map(issue => ({
      path: issue.path?.map(item => String(item.key)).join('.') ?? '',
      message: issue.message,
    })),
  }
}

export function parsePerceptionConsentGrant(input: unknown) {
  return safeParse(PerceptionConsentGrantSchema, input)
}

export function parsePerceptionSession(input: unknown) {
  return safeParse(PerceptionSessionSchema, input)
}

export function parseRuntimePerceptionFact(input: unknown) {
  return safeParse(RuntimePerceptionFactSchema, input)
}

export function parsePerceptionSourceCapabilities(input: unknown) {
  return safeParse(PerceptionSourceCapabilitiesSchema, input)
}

export function parsePerceptionStateSnapshot(input: unknown) {
  return safeParse(PerceptionStateSnapshotSchema, input)
}

export function parsePerceptionContextProjection(input: unknown) {
  return safeParse(PerceptionContextProjectionSchema, input)
}

export function parsePerceptionReactionCandidate(input: unknown) {
  return safeParse(PerceptionReactionCandidateSchema, input)
}

export function parseStageActuationIntentLite(input: unknown) {
  return safeParse(StageActuationIntentLiteSchema, input)
}

export function parseMultimodalPerceptionWindow(input: unknown) {
  return safeParse(MultimodalPerceptionWindowSchema, input)
}

export function parseScreenPerceptionRoutingPolicy(input: unknown) {
  return safeParse(ScreenPerceptionRoutingPolicySchema, input)
}

export function parseScreenModelRouteDecision(input: unknown) {
  return safeParse(ScreenModelRouteDecisionSchema, input)
}

export function parseLocalScreenAnalyzerProfile(input: unknown) {
  return safeParse(LocalScreenAnalyzerProfileSchema, input)
}

export function parseScreenAnalyzerSelection(input: unknown) {
  return safeParse(ScreenAnalyzerSelectionSchema, input)
}
