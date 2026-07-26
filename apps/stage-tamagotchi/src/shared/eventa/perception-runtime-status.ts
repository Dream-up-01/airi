import { defineEventa } from '@moeru/eventa'

export const PERCEPTION_RUNTIME_STATUS_VERSION = 'perception-runtime-status/v0.3' as const

export type PerceptionRuntimeSourceKind = 'screen' | 'camera' | 'minecraft'
export type PerceptionRuntimeState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed' | 'stopped'

export interface PerceptionRuntimeStatusWire {
  contractVersion: typeof PERCEPTION_RUNTIME_STATUS_VERSION
  publisherId: string
  sourceKind: PerceptionRuntimeSourceKind
  state: PerceptionRuntimeState
  generation: number
  updatedAt: number
}

export interface PerceptionRuntimeStatusRequestWire {
  contractVersion: typeof PERCEPTION_RUNTIME_STATUS_VERSION
  requesterId: string
  requestedAt: number
}

export const perceptionRuntimeStatusChanged = defineEventa<PerceptionRuntimeStatusWire>(
  'eventa:event:electron:perception:runtime-status:changed:v0.3',
)

export const perceptionRuntimeStatusRequested = defineEventa<PerceptionRuntimeStatusRequestWire>(
  'eventa:event:electron:perception:runtime-status:requested:v0.3',
)

export function parsePerceptionRuntimeStatusWire(input: unknown): PerceptionRuntimeStatusWire | undefined {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'publisherId', 'sourceKind', 'state', 'generation', 'updatedAt'])
    || input.contractVersion !== PERCEPTION_RUNTIME_STATUS_VERSION
    || !isIdentifier(input.publisherId)
    || !['screen', 'camera', 'minecraft'].includes(String(input.sourceKind))
    || !['idle', 'starting', 'running', 'paused', 'stopping', 'failed', 'stopped'].includes(String(input.state))
    || !isGeneration(input.generation)
    || !isTimestamp(input.updatedAt)) {
    return undefined
  }

  return input as unknown as PerceptionRuntimeStatusWire
}

export function parsePerceptionRuntimeStatusRequestWire(input: unknown): PerceptionRuntimeStatusRequestWire | undefined {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'requesterId', 'requestedAt'])
    || input.contractVersion !== PERCEPTION_RUNTIME_STATUS_VERSION
    || !isIdentifier(input.requesterId)
    || !isTimestamp(input.requestedAt)) {
    return undefined
  }

  return input as unknown as PerceptionRuntimeStatusRequestWire
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasExactKeys(input: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(input).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function isIdentifier(input: unknown): input is string {
  return typeof input === 'string'
    && input.length >= 1
    && input.length <= 80
    && /^[\w:.-]+$/.test(input)
}

function isGeneration(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0 && Number(input) <= 1_000_000
}

function isTimestamp(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0
}
