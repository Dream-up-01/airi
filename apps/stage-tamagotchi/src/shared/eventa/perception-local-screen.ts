import type { ObjectivePerceptionEvent } from '@proj-airi/stage-ui/domains/perception'

import { defineInvokeEventa } from '@moeru/eventa'
import { parseObjectivePerceptionEvent } from '@proj-airi/stage-ui/domains/perception'

export const LOCAL_SCREEN_GATEWAY_VERSION = 'perception-local-screen/v0.3' as const
export const LOCAL_SCREEN_PROFILE_ID = 'screen:qwen3-vl-4b-instruct:transformers-service' as const
export const LOCAL_SCREEN_MODEL_ID = 'Qwen/Qwen3-VL-4B-Instruct' as const
export const LOCAL_SCREEN_MODEL_REVISION = 'ebb281ec70b05090aa6165b016eac8ec08e71b17' as const
export const LOCAL_SCREEN_QUANTIZATION_ID = 'bitsandbytes-nf4-double-quant' as const
export const MAX_LOCAL_SCREEN_FRAME_BYTES = 1024 * 1024
export const MAX_LOCAL_SCREEN_FRAMES = 4

export type LocalScreenGatewayErrorCode
  = | 'invalid-schema'
    | 'invalid-order'
    | 'payload-too-large'
    | 'consent-missing'
    | 'stale-generation'
    | 'runtime-unavailable'
    | 'runtime-busy'
    | 'runtime-validation-failed'
    | 'runtime-cancelled'
    | 'runtime-timeout'
    | 'runtime-output-invalid'
    | 'runtime-stopped'

interface LocalScreenCorrelation {
  contractVersion: typeof LOCAL_SCREEN_GATEWAY_VERSION
  sessionId: string
  generation: number
  observationId: string
}

export interface LocalScreenGatewayValidateRequest {
  contractVersion: typeof LOCAL_SCREEN_GATEWAY_VERSION
  sessionId: string
  generation: number
  consentGrantId: string
  profileId: typeof LOCAL_SCREEN_PROFILE_ID
}

export interface LocalScreenGatewayStopRequest {
  contractVersion: typeof LOCAL_SCREEN_GATEWAY_VERSION
  sessionId: string
  generation: number
  reason: 'user-stop' | 'permission-revoked' | 'generation-stale' | 'source-ended' | 'unmount' | 'app-exit'
}

export interface LocalScreenGatewayStatusRequest {
  contractVersion: typeof LOCAL_SCREEN_GATEWAY_VERSION
  sessionId: string
  generation: number
}

export interface LocalScreenGatewayStatus {
  contractVersion: typeof LOCAL_SCREEN_GATEWAY_VERSION
  sessionId: string
  generation: number
  profileId: typeof LOCAL_SCREEN_PROFILE_ID
  state: 'stopped' | 'starting' | 'validating' | 'ready' | 'stopping' | 'failed'
  modelId: typeof LOCAL_SCREEN_MODEL_ID
  revision: typeof LOCAL_SCREEN_MODEL_REVISION
  quantizationId: typeof LOCAL_SCREEN_QUANTIZATION_ID
  capabilities: string[]
  loadDurationMs?: number
  errorCode?: LocalScreenGatewayErrorCode
}

export interface LocalScreenAnalyzeOpen extends LocalScreenCorrelation {
  type: 'open'
  consentGrantId: string
  sourceId: string
  observedAt: number
}

export interface LocalScreenAnalyzeFrame extends LocalScreenCorrelation {
  type: 'frame'
  sequence: number
  capturedAt: number
  width: 1280
  height: 720
  jpeg: Uint8Array
}

export interface LocalScreenAnalyzeComplete extends LocalScreenCorrelation {
  type: 'complete'
  endedAt: number
}

export type LocalScreenAnalyzeMessage
  = | LocalScreenAnalyzeOpen
    | LocalScreenAnalyzeFrame
    | LocalScreenAnalyzeComplete

export interface LocalScreenAnalyzeResponse extends LocalScreenCorrelation {
  events: ObjectivePerceptionEvent[]
  totalDurationMs: number
  outputTokenCount: number
}

export type LocalScreenGatewayParseResult<T>
  = | { ok: true, value: T }
    | { ok: false, errorCode: 'invalid-schema' | 'payload-too-large' }

export const electronLocalScreenValidate = defineInvokeEventa<
  LocalScreenGatewayStatus,
  LocalScreenGatewayValidateRequest
>('eventa:invoke:electron:perception:local-screen:validate:v0.3')

/** Directed client stream. Raw JPEG must never be registered on a broadcast context. */
export const electronLocalScreenAnalyze = defineInvokeEventa<
  LocalScreenAnalyzeResponse,
  ReadableStream<LocalScreenAnalyzeMessage>
>('eventa:stream:electron:perception:local-screen:analyze:v0.3')

export const electronLocalScreenStop = defineInvokeEventa<
  LocalScreenGatewayStatus,
  LocalScreenGatewayStopRequest
>('eventa:invoke:electron:perception:local-screen:stop:v0.3')

export const electronLocalScreenStatus = defineInvokeEventa<
  LocalScreenGatewayStatus,
  LocalScreenGatewayStatusRequest
>('eventa:invoke:electron:perception:local-screen:status:v0.3')

export function parseLocalScreenGatewayValidateRequest(input: unknown): LocalScreenGatewayParseResult<LocalScreenGatewayValidateRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'consentGrantId', 'profileId'])
    || input.contractVersion !== LOCAL_SCREEN_GATEWAY_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || !isIdentifier(input.consentGrantId)
    || input.profileId !== LOCAL_SCREEN_PROFILE_ID) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenGatewayValidateRequest }
}

export function parseLocalScreenGatewayStopRequest(input: unknown): LocalScreenGatewayParseResult<LocalScreenGatewayStopRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'reason'])
    || input.contractVersion !== LOCAL_SCREEN_GATEWAY_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || !['user-stop', 'permission-revoked', 'generation-stale', 'source-ended', 'unmount', 'app-exit'].includes(String(input.reason))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenGatewayStopRequest }
}

export function parseLocalScreenGatewayStatusRequest(input: unknown): LocalScreenGatewayParseResult<LocalScreenGatewayStatusRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation'])
    || input.contractVersion !== LOCAL_SCREEN_GATEWAY_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenGatewayStatusRequest }
}

export function parseLocalScreenGatewayStatus(input: unknown): LocalScreenGatewayParseResult<LocalScreenGatewayStatus> {
  if (!isRecord(input))
    return { ok: false, errorCode: 'invalid-schema' }
  const optionalKeys = [input.loadDurationMs === undefined ? undefined : 'loadDurationMs', input.errorCode === undefined ? undefined : 'errorCode'].filter(Boolean) as string[]
  if (!hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'profileId', 'state', 'modelId', 'revision', 'quantizationId', 'capabilities', ...optionalKeys])
    || input.contractVersion !== LOCAL_SCREEN_GATEWAY_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || input.profileId !== LOCAL_SCREEN_PROFILE_ID
    || !['stopped', 'starting', 'validating', 'ready', 'stopping', 'failed'].includes(String(input.state))
    || input.modelId !== LOCAL_SCREEN_MODEL_ID
    || input.revision !== LOCAL_SCREEN_MODEL_REVISION
    || input.quantizationId !== LOCAL_SCREEN_QUANTIZATION_ID
    || !Array.isArray(input.capabilities)
    || input.capabilities.length > 16
    || input.capabilities.some(capability => !isIdentifier(capability, 80))
    || (input.loadDurationMs !== undefined && !isFiniteNonNegative(input.loadDurationMs))
    || (input.errorCode !== undefined && !isGatewayErrorCode(input.errorCode))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenGatewayStatus }
}

export function parseLocalScreenAnalyzeMessage(input: unknown): LocalScreenGatewayParseResult<LocalScreenAnalyzeMessage> {
  if (!isRecord(input) || !isCorrelation(input) || typeof input.type !== 'string')
    return { ok: false, errorCode: 'invalid-schema' }

  if (input.type === 'open') {
    if (!hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'observationId', 'type', 'consentGrantId', 'sourceId', 'observedAt'])
      || !isIdentifier(input.consentGrantId)
      || !isIdentifier(input.sourceId)
      || !isTimestamp(input.observedAt)) {
      return { ok: false, errorCode: 'invalid-schema' }
    }
  }
  else if (input.type === 'frame') {
    if (!hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'observationId', 'type', 'sequence', 'capturedAt', 'width', 'height', 'jpeg'])
      || !isSequence(input.sequence)
      || !isTimestamp(input.capturedAt)
      || input.width !== 1280
      || input.height !== 720
      || !(input.jpeg instanceof Uint8Array)
      || !isJpeg(input.jpeg)) {
      return { ok: false, errorCode: 'invalid-schema' }
    }
    if (input.jpeg.byteLength > MAX_LOCAL_SCREEN_FRAME_BYTES)
      return { ok: false, errorCode: 'payload-too-large' }
  }
  else if (input.type === 'complete') {
    if (!hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'observationId', 'type', 'endedAt'])
      || !isTimestamp(input.endedAt)) {
      return { ok: false, errorCode: 'invalid-schema' }
    }
  }
  else {
    return { ok: false, errorCode: 'invalid-schema' }
  }

  return { ok: true, value: input as unknown as LocalScreenAnalyzeMessage }
}

export function parseLocalScreenAnalyzeResponse(input: unknown): LocalScreenGatewayParseResult<LocalScreenAnalyzeResponse> {
  const eventsValid = isRecord(input)
    && Array.isArray(input.events)
    && input.events.every((event) => {
      const parsed = parseObjectivePerceptionEvent(event)
      return parsed.ok
        && parsed.value.sessionId === input.sessionId
        && parsed.value.generation === input.generation
        && parsed.value.observationId === input.observationId
    })
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'observationId', 'events', 'totalDurationMs', 'outputTokenCount'])
    || !isCorrelation(input)
    || !Array.isArray(input.events)
    || input.events.length > 4
    || !eventsValid
    || !isFiniteNonNegative(input.totalDurationMs)
    || !isNonNegativeInteger(input.outputTokenCount)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenAnalyzeResponse }
}

function isCorrelation(value: Record<string, unknown>): boolean {
  return value.contractVersion === LOCAL_SCREEN_GATEWAY_VERSION
    && isIdentifier(value.sessionId)
    && isGeneration(value.generation)
    && isIdentifier(value.observationId, 148)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function isIdentifier(value: unknown, maxLength = 160): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && /^[a-z0-9][\w.:-]*$/iu.test(value)
}

function isGeneration(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function isTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isSequence(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegative(value) && Number.isInteger(value)
}

function isJpeg(value: Uint8Array): boolean {
  return value.byteLength >= 4
    && value[0] === 0xFF
    && value[1] === 0xD8
    && value[value.byteLength - 2] === 0xFF
    && value[value.byteLength - 1] === 0xD9
}

function isGatewayErrorCode(value: unknown): value is LocalScreenGatewayErrorCode {
  return typeof value === 'string' && [
    'invalid-schema',
    'invalid-order',
    'payload-too-large',
    'consent-missing',
    'stale-generation',
    'runtime-unavailable',
    'runtime-busy',
    'runtime-validation-failed',
    'runtime-cancelled',
    'runtime-timeout',
    'runtime-output-invalid',
    'runtime-stopped',
  ].includes(value)
}
