import { defineInvokeEventa } from '@moeru/eventa'

export const PERCEPTION_MEDIA_TRANSPORT_VERSION = 'perception-media/v0.3' as const
export const PERCEPTION_AUDIO_FORMAT = 'pcm-s16le-16000-mono' as const
export const MAX_PERCEPTION_AUDIO_CHUNK_BYTES = 64 * 1024
export const MAX_PERCEPTION_JPEG_BYTES = 190 * 1024

interface PerceptionMediaCorrelation {
  contractVersion: typeof PERCEPTION_MEDIA_TRANSPORT_VERSION
  sessionId: string
  generation: number
  windowId: string
}

export interface PerceptionMediaStreamOpen extends PerceptionMediaCorrelation {
  type: 'open'
  observationId: string
  sourceKind: 'screen-cloud' | 'camera-cloud'
  sourceId: string
  frameConsentGrantId: string
  audioConsentGrantId: string
  providerId: string
  modelId: string
  startedAt: number
  monotonicTimestampBase: number
}

export interface PerceptionMediaAudioChunk extends PerceptionMediaCorrelation {
  type: 'audio-chunk'
  sequence: number
  capturedAt: number
  monotonicTimestamp: number
  audioFormat: typeof PERCEPTION_AUDIO_FORMAT
  pcm: Uint8Array
}

export interface PerceptionMediaImageFrame extends PerceptionMediaCorrelation {
  type: 'image-frame'
  sequence: number
  capturedAt: number
  monotonicTimestamp: number
  width: number
  height: number
  jpeg: Uint8Array
}

export interface PerceptionMediaStreamComplete extends PerceptionMediaCorrelation {
  type: 'complete'
  endedAt: number
}

export interface PerceptionMediaStreamCancel extends PerceptionMediaCorrelation {
  type: 'cancel'
  reason: 'user-stop' | 'permission-revoked' | 'generation-stale' | 'echo-blocked' | 'source-ended' | 'timeout' | 'unmount' | 'app-exit'
  cancelledAt: number
}

export type PerceptionMediaTransportMessage
  = | PerceptionMediaStreamOpen
    | PerceptionMediaAudioChunk
    | PerceptionMediaImageFrame
    | PerceptionMediaStreamComplete
    | PerceptionMediaStreamCancel

export interface PerceptionMediaTransportAck extends PerceptionMediaCorrelation {
  type: 'opened' | 'audio-accepted' | 'image-accepted' | 'completed' | 'cancelled' | 'rejected'
  sequence?: number
  acceptedAudioBytes: number
  acceptedImageBytes: number
  droppedItems: number
  errorCode?: PerceptionMediaTransportErrorCode
  result?: PerceptionMediaCompletedResult
}

export interface PerceptionMediaCompletedResult {
  responseId: string
  observationId: string
  sourceKind: 'screen-cloud' | 'camera-cloud'
  modelId: string
  completedText: string
  usage: {
    inputTextImageTokens: number
    inputAudioTokens: number
    outputTextTokens: number
    outputAudioTokens: number
  }
  amountMicros: number
  priceProfileId: string
}

export type PerceptionMediaTransportErrorCode
  = | 'invalid-schema'
    | 'invalid-order'
    | 'payload-too-large'
    | 'stale-generation'
    | 'consent-missing'
    | 'provider-unavailable'
    | 'provider-output-invalid'
    | 'budget-exceeded'
    | 'cancelled'

export interface PerceptionMediaTransportStatusRequest {
  sessionId: string
  generation: number
  windowId: string
}

export interface PerceptionMediaTransportStatus {
  sessionId: string
  generation: number
  windowId: string
  state: 'unknown' | 'opening' | 'streaming' | 'completed' | 'cancelled' | 'failed'
  acceptedAudioBytes: number
  acceptedImageBytes: number
  droppedItems: number
  errorCode?: PerceptionMediaTransportErrorCode
}

export interface PerceptionMediaTransportCancelRequest extends PerceptionMediaTransportStatusRequest {
  reason: PerceptionMediaStreamCancel['reason']
}

export function parsePerceptionMediaTransportStatusRequest(input: unknown): { ok: true, value: PerceptionMediaTransportStatusRequest } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !hasExactKeys(input, ['generation', 'sessionId', 'windowId'])
    || !isIdentifier(input.sessionId)
    || !isIdentifier(input.windowId)
    || !Number.isInteger(input.generation)
    || Number(input.generation) < 1) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as PerceptionMediaTransportStatusRequest }
}

export function parsePerceptionMediaTransportCancelRequest(input: unknown): { ok: true, value: PerceptionMediaTransportCancelRequest } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !hasExactKeys(input, ['generation', 'reason', 'sessionId', 'windowId'])
    || !isIdentifier(input.sessionId)
    || !isIdentifier(input.windowId)
    || !Number.isInteger(input.generation)
    || Number(input.generation) < 1
    || !['user-stop', 'permission-revoked', 'generation-stale', 'echo-blocked', 'source-ended', 'timeout', 'unmount', 'app-exit'].includes(String(input.reason))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as PerceptionMediaTransportCancelRequest }
}

export type PerceptionMediaMessageParseResult
  = | { ok: true, value: PerceptionMediaTransportMessage }
    | { ok: false, errorCode: 'invalid-schema' | 'payload-too-large' }

export type PerceptionMediaValidationResult
  = | { ok: true, ack: PerceptionMediaTransportAck }
    | { ok: false, errorCode: PerceptionMediaTransportErrorCode }

export function parsePerceptionMediaTransportAck(input: unknown): { ok: true, value: PerceptionMediaTransportAck } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !isCorrelation(input)
    || !Object.keys(input).every(key => ['acceptedAudioBytes', 'acceptedImageBytes', 'contractVersion', 'droppedItems', 'errorCode', 'generation', 'result', 'sequence', 'sessionId', 'type', 'windowId'].includes(key))
    || !['opened', 'audio-accepted', 'image-accepted', 'completed', 'cancelled', 'rejected'].includes(String(input.type))
    || !isSafeCount(input.acceptedAudioBytes)
    || !isSafeCount(input.acceptedImageBytes)
    || !isSafeCount(input.droppedItems)
    || (input.sequence !== undefined && !isSequence(input.sequence))
    || (input.errorCode !== undefined && !isTransportErrorCode(input.errorCode))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  if ((input.type === 'rejected') !== (input.errorCode !== undefined)
    || (input.type === 'completed') !== (input.result !== undefined)
    || (input.result !== undefined && !isCompletedResult(input.result))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as PerceptionMediaTransportAck }
}

export interface PerceptionMediaTransportValidatorOptions {
  expectedSessionId: string
  expectedGeneration: number
  isConsentActive: (grantId: string) => boolean
}

/** Directed bidirectional stream. It must never be registered on a broadcast context. */
export const electronPerceptionMediaStream = defineInvokeEventa<
  PerceptionMediaTransportAck,
  ReadableStream<PerceptionMediaTransportMessage>
>('eventa:stream:electron:perception:media:v0.3')

export const electronPerceptionMediaTransportStatus = defineInvokeEventa<
  PerceptionMediaTransportStatus,
  PerceptionMediaTransportStatusRequest
>('eventa:invoke:electron:perception:media:status:v0.3')

export const electronPerceptionMediaTransportCancel = defineInvokeEventa<
  PerceptionMediaTransportAck,
  PerceptionMediaTransportCancelRequest
>('eventa:invoke:electron:perception:media:cancel:v0.3')

const correlationKeys = ['contractVersion', 'sessionId', 'generation', 'windowId'] as const

export function parsePerceptionMediaTransportMessage(input: unknown): PerceptionMediaMessageParseResult {
  if (!isRecord(input) || !isCorrelation(input) || typeof input.type !== 'string')
    return { ok: false, errorCode: 'invalid-schema' }

  switch (input.type) {
    case 'open':
      if (!hasExactKeys(input, [...correlationKeys, 'type', 'observationId', 'sourceKind', 'sourceId', 'frameConsentGrantId', 'audioConsentGrantId', 'providerId', 'modelId', 'startedAt', 'monotonicTimestampBase'])
        || !isIdentifier(input.observationId)
        || !['screen-cloud', 'camera-cloud'].includes(String(input.sourceKind))
        || !isIdentifier(input.sourceId)
        || !isIdentifier(input.frameConsentGrantId)
        || !isIdentifier(input.audioConsentGrantId)
        || input.frameConsentGrantId === input.audioConsentGrantId
        || !isIdentifier(input.providerId)
        || !isBoundedString(input.modelId, 160)
        || !isTimestamp(input.startedAt)
        || !isFiniteNonNegative(input.monotonicTimestampBase)) {
        return { ok: false, errorCode: 'invalid-schema' }
      }
      break
    case 'audio-chunk':
      if (!hasExactKeys(input, [...correlationKeys, 'type', 'sequence', 'capturedAt', 'monotonicTimestamp', 'audioFormat', 'pcm'])
        || !isSequence(input.sequence)
        || !isTimestamp(input.capturedAt)
        || !isFiniteNonNegative(input.monotonicTimestamp)
        || input.audioFormat !== PERCEPTION_AUDIO_FORMAT
        || !(input.pcm instanceof Uint8Array)) {
        return { ok: false, errorCode: 'invalid-schema' }
      }
      if (input.pcm.byteLength > MAX_PERCEPTION_AUDIO_CHUNK_BYTES)
        return { ok: false, errorCode: 'payload-too-large' }
      break
    case 'image-frame':
      if (!hasExactKeys(input, [...correlationKeys, 'type', 'sequence', 'capturedAt', 'monotonicTimestamp', 'width', 'height', 'jpeg'])
        || !isSequence(input.sequence)
        || !isTimestamp(input.capturedAt)
        || !isFiniteNonNegative(input.monotonicTimestamp)
        || !isDimension(input.width)
        || !isDimension(input.height)
        || !(input.jpeg instanceof Uint8Array)) {
        return { ok: false, errorCode: 'invalid-schema' }
      }
      if (input.jpeg.byteLength > MAX_PERCEPTION_JPEG_BYTES)
        return { ok: false, errorCode: 'payload-too-large' }
      break
    case 'complete':
      if (!hasExactKeys(input, [...correlationKeys, 'type', 'endedAt']) || !isTimestamp(input.endedAt))
        return { ok: false, errorCode: 'invalid-schema' }
      break
    case 'cancel':
      if (!hasExactKeys(input, [...correlationKeys, 'type', 'reason', 'cancelledAt'])
        || !['user-stop', 'permission-revoked', 'generation-stale', 'echo-blocked', 'source-ended', 'timeout', 'unmount', 'app-exit'].includes(String(input.reason))
        || !isTimestamp(input.cancelledAt)) {
        return { ok: false, errorCode: 'invalid-schema' }
      }
      break
    default:
      return { ok: false, errorCode: 'invalid-schema' }
  }

  return { ok: true, value: input as unknown as PerceptionMediaTransportMessage }
}

/** Validates stream order/correlation without retaining PCM or JPEG bytes. */
export function createPerceptionMediaTransportValidator(options: PerceptionMediaTransportValidatorOptions) {
  let opened = false
  let terminal = false
  let correlation: PerceptionMediaCorrelation | undefined
  let lastAudioSequence = -1
  let lastImageSequence = -1
  let acceptedAudioBytes = 0
  let acceptedImageBytes = 0
  let acceptedImageCount = 0

  return {
    accept(input: unknown): PerceptionMediaValidationResult {
      const parsed = parsePerceptionMediaTransportMessage(input)
      if (!parsed.ok)
        return parsed
      const message = parsed.value

      if (message.sessionId !== options.expectedSessionId || message.generation !== options.expectedGeneration)
        return { ok: false, errorCode: 'stale-generation' }
      if (terminal)
        return { ok: false, errorCode: 'invalid-order' }

      if (message.type === 'open') {
        if (opened || !options.isConsentActive(message.frameConsentGrantId) || !options.isConsentActive(message.audioConsentGrantId))
          return { ok: false, errorCode: opened ? 'invalid-order' : 'consent-missing' }
        opened = true
        correlation = pickCorrelation(message)
        return { ok: true, ack: createAck(message, 'opened') }
      }

      if (!opened || !correlation || !sameCorrelation(correlation, message))
        return { ok: false, errorCode: 'invalid-order' }

      switch (message.type) {
        case 'audio-chunk':
          if (message.sequence <= lastAudioSequence)
            return { ok: false, errorCode: 'invalid-order' }
          lastAudioSequence = message.sequence
          acceptedAudioBytes += message.pcm.byteLength
          return { ok: true, ack: createAck(message, 'audio-accepted', message.sequence) }
        case 'image-frame':
          if (message.sequence <= lastImageSequence || acceptedImageCount >= 24)
            return { ok: false, errorCode: 'invalid-order' }
          lastImageSequence = message.sequence
          acceptedImageCount += 1
          acceptedImageBytes += message.jpeg.byteLength
          return { ok: true, ack: createAck(message, 'image-accepted', message.sequence) }
        case 'complete':
          terminal = true
          return { ok: true, ack: createAck(message, 'completed') }
        case 'cancel':
          terminal = true
          return { ok: true, ack: createAck(message, 'cancelled') }
      }
    },
    snapshot(): Pick<PerceptionMediaTransportStatus, 'acceptedAudioBytes' | 'acceptedImageBytes' | 'state'> {
      return {
        acceptedAudioBytes,
        acceptedImageBytes,
        state: terminal ? 'completed' : opened ? 'streaming' : 'opening',
      }
    },
  }

  function createAck(message: PerceptionMediaTransportMessage, type: PerceptionMediaTransportAck['type'], sequence?: number): PerceptionMediaTransportAck {
    return {
      ...pickCorrelation(message),
      type,
      sequence,
      acceptedAudioBytes,
      acceptedImageBytes,
      droppedItems: 0,
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

function isCorrelation(value: Record<string, unknown>): boolean {
  return value.contractVersion === PERCEPTION_MEDIA_TRANSPORT_VERSION
    && isIdentifier(value.sessionId)
    && Number.isInteger(value.generation)
    && Number(value.generation) >= 0
    && isIdentifier(value.windowId)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isSequence(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000
}

function isDimension(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 4_096
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isTransportErrorCode(value: unknown): value is PerceptionMediaTransportErrorCode {
  return typeof value === 'string' && [
    'invalid-schema',
    'invalid-order',
    'payload-too-large',
    'stale-generation',
    'consent-missing',
    'provider-unavailable',
    'provider-output-invalid',
    'budget-exceeded',
    'cancelled',
  ].includes(value)
}

function isCompletedResult(value: unknown): value is PerceptionMediaCompletedResult {
  if (!isRecord(value) || !hasExactKeys(value, ['amountMicros', 'completedText', 'modelId', 'observationId', 'priceProfileId', 'responseId', 'sourceKind', 'usage'])
    || !isIdentifier(value.responseId)
    || !isIdentifier(value.observationId)
    || !['screen-cloud', 'camera-cloud'].includes(String(value.sourceKind))
    || !isBoundedString(value.modelId, 160)
    || !isBoundedString(value.completedText, 8_192)
    || containsAsciiControl(value.completedText)
    || !isSafeCount(value.amountMicros)
    || !isIdentifier(value.priceProfileId)
    || !isRecord(value.usage)
    || !hasExactKeys(value.usage, ['inputAudioTokens', 'inputTextImageTokens', 'outputAudioTokens', 'outputTextTokens'])) {
    return false
  }
  const usage = value.usage as Record<string, unknown>
  return ['inputAudioTokens', 'inputTextImageTokens', 'outputAudioTokens', 'outputTextTokens'].every(key => isSafeCount(usage[key]))
    && usage.outputAudioTokens === 0
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1F || code === 0x7F)
      return true
  }
  return false
}

function pickCorrelation(value: PerceptionMediaCorrelation): PerceptionMediaCorrelation {
  return {
    contractVersion: value.contractVersion,
    sessionId: value.sessionId,
    generation: value.generation,
    windowId: value.windowId,
  }
}

function sameCorrelation(left: PerceptionMediaCorrelation, right: PerceptionMediaCorrelation): boolean {
  return left.contractVersion === right.contractVersion
    && left.sessionId === right.sessionId
    && left.generation === right.generation
    && left.windowId === right.windowId
}
