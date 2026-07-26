import type {
  ObjectivePerceptionEvent,
  ObjectivePerceptionSourceKind,
  ObjectivePerceptionValue,
  PerceptionEventType,
} from '../../domains/perception'

import {
  parseObjectivePerceptionEvent,
  PERCEPTION_CONTRACT_VERSION,
  perceptionEventPolicies,
  QWEN_CLOUD_PROVIDER_ID,
  validateEventPolicy,
} from '../../domains/perception'

export const QWEN_REALTIME_MODEL_IDS = [
  'qwen3.5-omni-flash-realtime',
  'qwen3.5-omni-plus-realtime',
] as const

export type QwenRealtimeModelId = typeof QWEN_REALTIME_MODEL_IDS[number]

export interface QwenCloudCompletedEnvelope {
  responseId: string
  windowId: string
  observationId: string
  sessionId: string
  generation: number
  modelId: QwenRealtimeModelId
  completedText: string
}

export interface QwenCloudObjectiveContext {
  windowId: string
  observationId: string
  sessionId: string
  generation: number
  sourceKind: Extract<ObjectivePerceptionSourceKind, 'screen-cloud' | 'camera-cloud'>
  sourceId: string
  modelId: QwenRealtimeModelId
  adapterId: string
  observedAt: number
  eventId: (index: number) => string
}

export type QwenCloudObjectiveParseResult
  = | { ok: true, responseId: string, events: ObjectivePerceptionEvent[] }
    | { ok: false, code: 'cloud-response-stale' | 'cloud-output-invalid' }

const allowedScreenEvents = new Set<PerceptionEventType>([
  'screen.activity.observed',
  'screen.app-class.observed',
  'screen.task-summary.observed',
  'screen.window-relation.observed',
])

const allowedCameraEvents = new Set<PerceptionEventType>([
  'person.presence.changed',
  'person.count.observed',
  'person.pose.observed',
  'person.gesture.observed',
  'person.observable-cue.observed',
  'person.activity-like.observed',
  'environment.lighting.observed',
  'environment.scene-class.observed',
  'object.presence.changed',
])

/** Parses completed text only. Delta/Markdown recovery and stale correlation are forbidden. */
export function parseQwenCloudObjectiveResponse(
  input: unknown,
  context: QwenCloudObjectiveContext,
): QwenCloudObjectiveParseResult {
  if (!isValidContext(context) || !isPlainRecord(input) || !hasExactKeys(input, [
    'completedText',
    'generation',
    'modelId',
    'observationId',
    'responseId',
    'sessionId',
    'windowId',
  ])) {
    return { ok: false, code: 'cloud-output-invalid' }
  }
  if (input.windowId !== context.windowId
    || input.observationId !== context.observationId
    || input.sessionId !== context.sessionId
    || input.generation !== context.generation
    || input.modelId !== context.modelId) {
    return { ok: false, code: 'cloud-response-stale' }
  }
  if (!isIdentifier(input.responseId) || typeof input.completedText !== 'string' || input.completedText.length < 1 || input.completedText.length > 8_192)
    return { ok: false, code: 'cloud-output-invalid' }

  let completed: unknown
  try {
    completed = JSON.parse(input.completedText)
  }
  catch {
    return { ok: false, code: 'cloud-output-invalid' }
  }
  if (!isPlainRecord(completed) || !hasExactKeys(completed, ['events']) || !Array.isArray(completed.events) || completed.events.length > 8)
    return { ok: false, code: 'cloud-output-invalid' }

  const allowedEvents = context.sourceKind === 'screen-cloud' ? allowedScreenEvents : allowedCameraEvents
  const events: ObjectivePerceptionEvent[] = []
  for (const [index, candidate] of completed.events.entries()) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['confidence', 'eventType', 'value']))
      return { ok: false, code: 'cloud-output-invalid' }
    if (typeof candidate.eventType !== 'string' || !allowedEvents.has(candidate.eventType as PerceptionEventType))
      return { ok: false, code: 'cloud-output-invalid' }
    if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)
      return { ok: false, code: 'cloud-output-invalid' }

    const value = parseObjectiveValue(candidate.value)
    if (!value)
      return { ok: false, code: 'cloud-output-invalid' }
    const eventType = candidate.eventType as PerceptionEventType
    const event: ObjectivePerceptionEvent = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      eventId: context.eventId(index),
      observationId: context.observationId,
      sessionId: context.sessionId,
      generation: context.generation,
      sourceKind: context.sourceKind,
      sourceId: context.sourceId,
      analyzers: ['qwen-realtime:objective'],
      eventType,
      phase: 'observed',
      subject: subjectFor(eventType),
      value,
      confidence: candidate.confidence,
      observedAt: context.observedAt,
      expiresAt: context.observedAt + perceptionEventPolicies[eventType].defaultTtlMs,
      verification: 'cloud-inferred',
      sensitivity: 'personal',
      provenance: {
        analyzerId: 'qwen-realtime:objective',
        processing: 'cloud',
        providerId: QWEN_CLOUD_PROVIDER_ID,
        modelId: context.modelId,
        adapterId: context.adapterId,
      },
    }
    if (!parseObjectivePerceptionEvent(event).ok || validateEventPolicy(event))
      return { ok: false, code: 'cloud-output-invalid' }
    events.push(event)
  }

  return { ok: true, responseId: input.responseId, events }
}

function subjectFor(eventType: PerceptionEventType): ObjectivePerceptionEvent['subject'] {
  if (eventType.startsWith('person.'))
    return 'primary-user'
  if (eventType.startsWith('object.'))
    return 'allowlisted-object'
  return 'environment'
}

function parseObjectiveValue(input: unknown): ObjectivePerceptionValue | undefined {
  if (!isPlainRecord(input) || !hasExactKeys(input, ['kind', 'value']))
    return undefined
  if (input.kind === 'enum' && typeof input.value === 'string' && input.value.length >= 1 && input.value.length <= 64)
    return { kind: 'enum', value: input.value }
  if (input.kind === 'boolean' && typeof input.value === 'boolean')
    return { kind: 'boolean', value: input.value }
  if (input.kind === 'number' && typeof input.value === 'number' && Number.isFinite(input.value) && Math.abs(input.value) <= 10_000)
    return { kind: 'number', value: input.value }
  if (input.kind === 'summary' && typeof input.value === 'string' && input.value.length >= 1 && input.value.length <= 240 && !containsAsciiControl(input.value))
    return { kind: 'summary', value: input.value }
}

function isValidContext(context: QwenCloudObjectiveContext): boolean {
  return isIdentifier(context.windowId)
    && isIdentifier(context.observationId)
    && isIdentifier(context.sessionId)
    && Number.isInteger(context.generation)
    && context.generation >= 1
    && ['screen-cloud', 'camera-cloud'].includes(context.sourceKind)
    && isIdentifier(context.sourceId)
    && QWEN_REALTIME_MODEL_IDS.includes(context.modelId)
    && isIdentifier(context.adapterId)
    && Number.isInteger(context.observedAt)
    && context.observedAt >= 0
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
