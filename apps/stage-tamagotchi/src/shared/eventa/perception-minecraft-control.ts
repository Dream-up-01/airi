import type { PerceptionRuntimeState } from './perception-runtime-status'

import { defineEventa } from '@moeru/eventa'

export const PERCEPTION_MINECRAFT_CONTROL_VERSION = 'perception-minecraft-control/v0.1' as const

export type MinecraftPerceptionControlCommand = 'start' | 'pause' | 'resume' | 'stop'

export interface MinecraftPerceptionControlRequestWire {
  contractVersion: typeof PERCEPTION_MINECRAFT_CONTROL_VERSION
  requesterId: string
  requestId: string
  command: MinecraftPerceptionControlCommand
  consentConfirmed: boolean
  requestedAt: number
}

export interface MinecraftPerceptionControlResultWire {
  contractVersion: typeof PERCEPTION_MINECRAFT_CONTROL_VERSION
  requesterId: string
  responderId: string
  requestId: string
  state: PerceptionRuntimeState
  generation: number
  errorCode?: string
  respondedAt: number
}

export const perceptionMinecraftControlRequested = defineEventa<MinecraftPerceptionControlRequestWire>(
  'eventa:event:electron:perception:minecraft-control:requested:v0.1',
)

export const perceptionMinecraftControlResult = defineEventa<MinecraftPerceptionControlResultWire>(
  'eventa:event:electron:perception:minecraft-control:result:v0.1',
)

export function parseMinecraftPerceptionControlRequest(input: unknown): MinecraftPerceptionControlRequestWire | undefined {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'requesterId', 'requestId', 'command', 'consentConfirmed', 'requestedAt'])
    || input.contractVersion !== PERCEPTION_MINECRAFT_CONTROL_VERSION
    || !isIdentifier(input.requesterId)
    || !isIdentifier(input.requestId)
    || !['start', 'pause', 'resume', 'stop'].includes(String(input.command))
    || typeof input.consentConfirmed !== 'boolean'
    || !isTimestamp(input.requestedAt)) {
    return undefined
  }

  return input as unknown as MinecraftPerceptionControlRequestWire
}

export function parseMinecraftPerceptionControlResult(input: unknown): MinecraftPerceptionControlResultWire | undefined {
  if (!isRecord(input)
    || !hasAllowedKeys(input, ['contractVersion', 'requesterId', 'responderId', 'requestId', 'state', 'generation', 'respondedAt'], ['errorCode'])
    || input.contractVersion !== PERCEPTION_MINECRAFT_CONTROL_VERSION
    || !isIdentifier(input.requesterId)
    || !isIdentifier(input.responderId)
    || !isIdentifier(input.requestId)
    || !['idle', 'starting', 'running', 'paused', 'stopping', 'failed', 'stopped'].includes(String(input.state))
    || !isGeneration(input.generation)
    || ('errorCode' in input && !isIdentifier(input.errorCode))
    || !isTimestamp(input.respondedAt)) {
    return undefined
  }

  return input as unknown as MinecraftPerceptionControlResultWire
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasExactKeys(input: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(input).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function hasAllowedKeys(input: Record<string, unknown>, required: string[], optional: string[]): boolean {
  const actual = Object.keys(input)
  return required.every(key => actual.includes(key))
    && actual.every(key => required.includes(key) || optional.includes(key))
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
