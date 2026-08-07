import { defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

/**
 * Reasons are deliberately low-cardinality. No settings, transcript, audio,
 * provider credentials, or other user content crosses this control channel.
 */
export type VoiceRuntimeQuiesceReason = 'provider-switch' | 'model-switch' | 'voice-switch'

export type VoiceRuntimeQuiesceAcknowledgementStatus = 'quiesced' | 'failed'

export type VoiceRuntimeQuiesceResultStatus = VoiceRuntimeQuiesceAcknowledgementStatus | 'timed-out'

export interface VoiceRuntimeQuiesceRequest {
  correlationId: string
  reason: VoiceRuntimeQuiesceReason
}

export interface VoiceRuntimeQuiesceAcknowledgement {
  correlationId: string
  status: VoiceRuntimeQuiesceAcknowledgementStatus
}

export interface VoiceRuntimeQuiesceResult {
  correlationId: string
  status: VoiceRuntimeQuiesceResultStatus
}

export type VoiceRuntimeQuiesceRequestHandler = (
  request: VoiceRuntimeQuiesceRequest,
) => void | Promise<void>

export interface VoiceRuntimeQuiescePeerOptions {
  onRequest?: VoiceRuntimeQuiesceRequestHandler
  timeoutMs?: number
}

export interface VoiceRuntimeQuiescePeer {
  request: (reason: VoiceRuntimeQuiesceReason) => Promise<VoiceRuntimeQuiesceResult>
  dispose: () => void
}

export const VOICE_RUNTIME_QUIESCE_CHANNEL_NAME = 'airi:voice-runtime-quiesce:v1'
export const VOICE_RUNTIME_QUIESCE_TIMEOUT_MS = 1_500
const MAX_TIMEOUT_MS = 2_000
const MAX_CORRELATION_ID_LENGTH = 96

const voiceRuntimeQuiesceRequestedEvent = defineEventa<VoiceRuntimeQuiesceRequest>(
  'eventa:event:voice-runtime-quiesce:requested',
)
const voiceRuntimeQuiesceAcknowledgedEvent = defineEventa<VoiceRuntimeQuiesceAcknowledgement>(
  'eventa:event:voice-runtime-quiesce:acknowledged',
)

const allowedReasons = new Set<VoiceRuntimeQuiesceReason>([
  'provider-switch',
  'model-switch',
  'voice-switch',
])
const allowedAcknowledgementStatuses = new Set<VoiceRuntimeQuiesceAcknowledgementStatus>([
  'quiesced',
  'failed',
])

function getCorrelationId() {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId)
    return `voice-quiesce:${randomId}`

  return `voice-quiesce:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeCorrelationId(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CORRELATION_ID_LENGTH)
    return undefined
  if (!/^[\w:-]+$/.test(value))
    return undefined
  return value
}

function sanitizeRequest(value: unknown): VoiceRuntimeQuiesceRequest | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const candidate = value as Partial<VoiceRuntimeQuiesceRequest>
  const correlationId = sanitizeCorrelationId(candidate.correlationId)
  if (!correlationId || typeof candidate.reason !== 'string' || !allowedReasons.has(candidate.reason as VoiceRuntimeQuiesceReason))
    return undefined

  return {
    correlationId,
    reason: candidate.reason as VoiceRuntimeQuiesceReason,
  }
}

function sanitizeAcknowledgement(value: unknown): VoiceRuntimeQuiesceAcknowledgement | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const candidate = value as Partial<VoiceRuntimeQuiesceAcknowledgement>
  const correlationId = sanitizeCorrelationId(candidate.correlationId)
  if (!correlationId || typeof candidate.status !== 'string' || !allowedAcknowledgementStatuses.has(candidate.status as VoiceRuntimeQuiesceAcknowledgementStatus))
    return undefined

  return {
    correlationId,
    status: candidate.status as VoiceRuntimeQuiesceAcknowledgementStatus,
  }
}

function boundedTimeout(value: number | undefined) {
  if (!Number.isFinite(value))
    return VOICE_RUNTIME_QUIESCE_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(value as number)))
}

/**
 * Creates one control-plane peer. Settings uses a requester peer; the active
 * Stage runtime uses a peer with `onRequest`. A peer owns its BroadcastChannel
 * and can therefore be disposed with its renderer lifecycle.
 */
export function createVoiceRuntimeQuiescePeer(
  options: VoiceRuntimeQuiescePeerOptions = {},
): VoiceRuntimeQuiescePeer {
  const channel = new BroadcastChannel(VOICE_RUNTIME_QUIESCE_CHANNEL_NAME)
  const context = createBroadcastChannelContext(channel).context
  const pending = new Map<string, {
    resolve: (result: VoiceRuntimeQuiesceResult) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const timeoutMs = boundedTimeout(options.timeoutMs)
  let disposed = false

  const stopAcknowledgementSubscription = context.on(voiceRuntimeQuiesceAcknowledgedEvent, (event) => {
    if (disposed)
      return

    const acknowledgement = sanitizeAcknowledgement(event?.body)
    if (!acknowledgement)
      return

    const pendingRequest = pending.get(acknowledgement.correlationId)
    if (!pendingRequest)
      return

    pending.delete(acknowledgement.correlationId)
    clearTimeout(pendingRequest.timer)
    pendingRequest.resolve({
      correlationId: acknowledgement.correlationId,
      status: acknowledgement.status,
    })
  })

  const stopRequestSubscription = options.onRequest
    ? context.on(voiceRuntimeQuiesceRequestedEvent, (event) => {
        if (disposed)
          return

        const request = sanitizeRequest(event?.body)
        if (!request)
          return

        Promise.resolve()
          .then(() => options.onRequest?.(request))
          .then(
            () => {
              if (!disposed) {
                context.emit(voiceRuntimeQuiesceAcknowledgedEvent, {
                  correlationId: request.correlationId,
                  status: 'quiesced',
                })
              }
            },
            () => {
              if (!disposed) {
                context.emit(voiceRuntimeQuiesceAcknowledgedEvent, {
                  correlationId: request.correlationId,
                  status: 'failed',
                })
              }
            },
          )
      })
    : undefined

  return {
    request(reason) {
      if (disposed)
        return Promise.resolve({ correlationId: '', status: 'timed-out' })

      const request: VoiceRuntimeQuiesceRequest = {
        correlationId: getCorrelationId(),
        reason,
      }

      return new Promise<VoiceRuntimeQuiesceResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(request.correlationId)
          resolve({
            correlationId: request.correlationId,
            status: 'timed-out',
          })
        }, timeoutMs)
        pending.set(request.correlationId, { resolve, timer })
        context.emit(voiceRuntimeQuiesceRequestedEvent, request)
      })
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      stopAcknowledgementSubscription()
      stopRequestSubscription?.()
      for (const [correlationId, pendingRequest] of pending) {
        clearTimeout(pendingRequest.timer)
        pendingRequest.resolve({ correlationId, status: 'timed-out' })
      }
      pending.clear()
      channel.close()
    },
  }
}

let defaultRequester: VoiceRuntimeQuiescePeer | undefined

function getDefaultRequester() {
  defaultRequester ??= createVoiceRuntimeQuiescePeer()
  return defaultRequester
}

/** Requests the current Stage runtime to quiesce, with a bounded wait. */
export function requestVoiceRuntimeQuiesce(reason: VoiceRuntimeQuiesceReason) {
  return getDefaultRequester().request(reason)
}

/**
 * Registers a Stage-side quiesce handler. The acknowledgement is emitted only
 * after the handler resolves, so callers can safely publish the new settings
 * after the old chat/TTS/ASR/VAD work has been cancelled.
 */
export function onVoiceRuntimeQuiesceRequested(handler: VoiceRuntimeQuiesceRequestHandler) {
  const peer = createVoiceRuntimeQuiescePeer({ onRequest: handler })
  return () => peer.dispose()
}
