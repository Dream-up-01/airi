import type { ObjectivePerceptionEvent, ObjectivePerceptionValue, PerceptionEventType } from '../../domains/perception'

import {
  parseObjectivePerceptionEvent,
  PERCEPTION_CONTRACT_VERSION,
  perceptionEventPolicies,
  validateEventPolicy,
} from '../../domains/perception'

const LOCAL_SCREEN_MODEL_ID = 'Qwen/Qwen3-VL-4B-Instruct'
const LOCAL_SCREEN_ANALYZER_ID = 'qwen3-vl:screen-objective'
const allowedLocalScreenEvents = new Set<PerceptionEventType>([
  'screen.activity.observed',
  'screen.app-class.observed',
  'screen.task-summary.observed',
  'screen.window-relation.observed',
])

export interface LocalScreenObjectiveEnvelope {
  observationId: string
  sessionId: string
  generation: number
  sourceId: string
  observedAt: number
  eventId: (index: number) => string
  adapterId: string
  runtimeModelId: string
  runtimeProviderId?: 'ollama' | 'transformers-service'
}

export type LocalScreenObjectiveParseResult
  = | { ok: true, events: ObjectivePerceptionEvent[] }
    | { ok: false, code: 'local-screen-output-invalid' }

/** Parses only a completed JSON response; partial/Markdown recovery is forbidden. */
export function parseLocalScreenObjectiveResponse(
  completedText: string,
  envelope: LocalScreenObjectiveEnvelope,
): LocalScreenObjectiveParseResult {
  if (!completedText || completedText.length > 8_192 || !isValidEnvelope(envelope))
    return { ok: false, code: 'local-screen-output-invalid' }

  let value: unknown
  try {
    value = JSON.parse(completedText)
  }
  catch {
    return { ok: false, code: 'local-screen-output-invalid' }
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, ['events']) || !Array.isArray(value.events) || value.events.length > 4)
    return { ok: false, code: 'local-screen-output-invalid' }

  const events: ObjectivePerceptionEvent[] = []
  for (const [index, candidate] of value.events.entries()) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['confidence', 'eventType', 'value']))
      return { ok: false, code: 'local-screen-output-invalid' }
    if (typeof candidate.eventType !== 'string' || !allowedLocalScreenEvents.has(candidate.eventType as PerceptionEventType))
      return { ok: false, code: 'local-screen-output-invalid' }
    if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)
      return { ok: false, code: 'local-screen-output-invalid' }

    const objectiveValue = parseObjectiveValue(candidate.value)
    if (!objectiveValue)
      return { ok: false, code: 'local-screen-output-invalid' }
    const eventType = candidate.eventType as PerceptionEventType
    const policy = perceptionEventPolicies[eventType]
    const event: ObjectivePerceptionEvent = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      eventId: envelope.eventId(index),
      observationId: envelope.observationId,
      sessionId: envelope.sessionId,
      generation: envelope.generation,
      sourceKind: 'screen-local',
      sourceId: envelope.sourceId,
      analyzers: [LOCAL_SCREEN_ANALYZER_ID],
      eventType,
      phase: 'observed',
      subject: 'environment',
      value: objectiveValue,
      confidence: candidate.confidence,
      observedAt: envelope.observedAt,
      expiresAt: envelope.observedAt + policy.defaultTtlMs,
      verification: 'multi-frame-inferred',
      sensitivity: 'personal',
      provenance: {
        analyzerId: LOCAL_SCREEN_ANALYZER_ID,
        processing: 'local',
        providerId: envelope.runtimeProviderId ?? 'ollama',
        modelId: LOCAL_SCREEN_MODEL_ID,
        adapterId: envelope.adapterId,
      },
    }
    if (!parseObjectivePerceptionEvent(event).ok || validateEventPolicy(event))
      return { ok: false, code: 'local-screen-output-invalid' }
    events.push(event)
  }

  return { ok: true, events }
}

function parseObjectiveValue(input: unknown): ObjectivePerceptionValue | undefined {
  if (!isPlainRecord(input) || !hasExactKeys(input, ['kind', 'value']) || typeof input.kind !== 'string')
    return undefined
  if (input.kind === 'enum' && typeof input.value === 'string' && input.value.length >= 1 && input.value.length <= 64)
    return { kind: 'enum', value: input.value }
  if (input.kind === 'summary' && typeof input.value === 'string' && input.value.length >= 1 && input.value.length <= 240 && !containsAsciiControl(input.value))
    return { kind: 'summary', value: input.value }
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

function isValidEnvelope(envelope: LocalScreenObjectiveEnvelope): boolean {
  return !!envelope.observationId
    && !!envelope.sessionId
    && Number.isInteger(envelope.generation)
    && envelope.generation >= 1
    && !!envelope.sourceId
    && Number.isFinite(envelope.observedAt)
    && !!envelope.adapterId
    && envelope.runtimeModelId === LOCAL_SCREEN_MODEL_ID
    && (envelope.runtimeProviderId === undefined || ['ollama', 'transformers-service'].includes(envelope.runtimeProviderId))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}
