import type { PerceptionContextProjection, PerceptionSourceKind } from '@proj-airi/stage-ui/domains/perception'

import { defineEventa } from '@moeru/eventa'
import { isControlledPerceptionContextProjection, parsePerceptionContextProjection } from '@proj-airi/stage-ui/domains/perception'

export const PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION = 'perception-context-projection/v0.3' as const

export interface PerceptionContextProjectionWire {
  contractVersion: typeof PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION
  publisherId: string
  sourceKind: PerceptionSourceKind
  generation: number
  updatedAt: number
  projection: PerceptionContextProjection | null
}

export interface PerceptionContextProjectionRequestWire {
  contractVersion: typeof PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION
  requesterId: string
  sourceKind: PerceptionSourceKind
  requestedAt: number
}

export const perceptionContextProjectionChanged = defineEventa<PerceptionContextProjectionWire>(
  'eventa:event:electron:perception:context-projection:changed:v0.3',
)

export const perceptionContextProjectionRequested = defineEventa<PerceptionContextProjectionRequestWire>(
  'eventa:event:electron:perception:context-projection:requested:v0.3',
)

export function parsePerceptionContextProjectionWire(input: unknown): PerceptionContextProjectionWire | undefined {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'publisherId', 'sourceKind', 'generation', 'updatedAt', 'projection'])
    || input.contractVersion !== PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION
    || !isIdentifier(input.publisherId)
    || !isSourceKind(input.sourceKind)
    || !isGeneration(input.generation)
    || !isTimestamp(input.updatedAt)) {
    return undefined
  }

  if (input.projection === null)
    return input as unknown as PerceptionContextProjectionWire

  const parsed = parsePerceptionContextProjection(input.projection)
  if (!parsed.success
    || parsed.output.expiresAt <= parsed.output.createdAt
    || !isControlledPerceptionContextProjection(parsed.output, input.sourceKind)) {
    return undefined
  }

  return { ...input, projection: parsed.output } as PerceptionContextProjectionWire
}

export function parsePerceptionContextProjectionRequestWire(input: unknown): PerceptionContextProjectionRequestWire | undefined {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'requesterId', 'sourceKind', 'requestedAt'])
    || input.contractVersion !== PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION
    || !isIdentifier(input.requesterId)
    || !isSourceKind(input.sourceKind)
    || !isTimestamp(input.requestedAt)) {
    return undefined
  }
  return input as unknown as PerceptionContextProjectionRequestWire
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasExactKeys(input: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(input).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function isIdentifier(input: unknown): input is string {
  return typeof input === 'string' && input.length >= 1 && input.length <= 80 && /^[\w:.-]+$/.test(input)
}

function isSourceKind(input: unknown): input is PerceptionSourceKind {
  return ['screen', 'camera', 'minecraft'].includes(String(input))
}

function isGeneration(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0 && Number(input) <= 1_000_000
}

function isTimestamp(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0
}
