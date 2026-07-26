import type { QwenRealtimeCloudModelId } from '@proj-airi/stage-ui/domains/perception'

import type {
  PerceptionMediaStreamOpen,
  PerceptionMediaTransportAck,
  PerceptionMediaTransportErrorCode,
  PerceptionMediaTransportMessage,
  PerceptionMediaTransportStatus,
  PerceptionMediaTransportStatusRequest,
} from '../../../../shared/eventa/perception'
import type { QwenCloudCostLedgerPort } from './qwen-cloud-cost-ledger-store'
import type { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'
import type { QwenRealtimeSocketFactory } from './qwen-realtime-protocol'

import process from 'node:process'

import {
  estimateQwenRealtimeCost,
  QWEN_CLOUD_PRICE_PROFILE_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
  QWEN_PLUS_REALTIME_MODEL_ID,
  QwenCloudCostLedger,
} from '@proj-airi/stage-ui/domains/perception'

import {
  createPerceptionMediaTransportValidator,
  parsePerceptionMediaTransportMessage,
} from '../../../../shared/eventa/perception'
import { QwenRealtimeProtocolError, QwenRealtimeProtocolSession } from './qwen-realtime-protocol'

const PRE_CALL_COST_RESERVE_MICROS = 250_000

interface ActiveGatewaySession {
  open: PerceptionMediaStreamOpen
  controller: AbortController
  protocol: QwenRealtimeProtocolSession
  status: PerceptionMediaTransportStatus
  cleanupOuterAbort: () => void
}

export interface QwenCloudMediaGatewayManagerOptions {
  grants: QwenCloudGrantRegistry
  socketFactory: QwenRealtimeSocketFactory
  isReady: () => boolean
  getWorkspaceId?: () => string | undefined
  getApiKey?: () => string | undefined
  costLedger?: QwenCloudCostLedgerPort
  now?: () => number
}

export class QwenCloudMediaGatewayManager {
  readonly #grants: QwenCloudGrantRegistry
  readonly #socketFactory: QwenRealtimeSocketFactory
  readonly #isReady: () => boolean
  readonly #getWorkspaceId: () => string | undefined
  readonly #getApiKey: () => string | undefined
  readonly #costLedger: QwenCloudCostLedgerPort
  readonly #now: () => number
  readonly #active = new Map<string, ActiveGatewaySession>()
  readonly #terminal = new Map<string, PerceptionMediaTransportStatus>()

  constructor(options: QwenCloudMediaGatewayManagerOptions) {
    this.#grants = options.grants
    this.#socketFactory = options.socketFactory
    this.#isReady = options.isReady
    this.#getWorkspaceId = options.getWorkspaceId ?? (() => process.env.AIRI_QWEN_WORKSPACE_ID)
    this.#getApiKey = options.getApiKey ?? (() => process.env.DASHSCOPE_API_KEY)
    this.#costLedger = options.costLedger ?? new QwenCloudCostLedger()
    this.#now = options.now ?? Date.now
  }

  async* handle(
    incoming: ReadableStream<PerceptionMediaTransportMessage> | AsyncIterable<PerceptionMediaTransportMessage>,
    outerSignal?: AbortSignal,
  ): AsyncGenerator<PerceptionMediaTransportAck> {
    let active: ActiveGatewaySession | undefined
    let validator: ReturnType<typeof createPerceptionMediaTransportValidator> | undefined
    try {
      for await (const raw of incoming) {
        const parsed = parsePerceptionMediaTransportMessage(raw)
        if (!parsed.ok) {
          if (active)
            yield this.#reject(active, parsed.errorCode)
          return
        }
        const message = parsed.value
        if (!active) {
          if (message.type !== 'open')
            return
          active = await this.#open(message, outerSignal)
          if (!active) {
            yield rejectedOpen(message, this.#isReady() ? 'consent-missing' : 'provider-unavailable')
            return
          }
          validator = createPerceptionMediaTransportValidator({
            expectedSessionId: message.sessionId,
            expectedGeneration: message.generation,
            isConsentActive: grantId => this.#grants.authorize({
              sessionId: message.sessionId,
              generation: message.generation,
              sourceKind: message.sourceKind,
              sourceId: message.sourceId,
              modelId: message.modelId,
              frameGrantId: grantId === message.frameConsentGrantId ? grantId : message.frameConsentGrantId,
              audioGrantId: grantId === message.audioConsentGrantId ? grantId : message.audioConsentGrantId,
            }),
          })
        }

        const validation = validator!.accept(message)
        if (!validation.ok) {
          yield this.#reject(active, validation.errorCode)
          return
        }
        active.status = statusFromAck(validation.ack, validation.ack.type === 'opened' ? 'streaming' : active.status.state)

        if (message.type === 'audio-chunk') {
          active.protocol.appendAudio(message.pcm)
          yield validation.ack
          continue
        }
        if (message.type === 'image-frame') {
          active.protocol.appendImage(message.jpeg)
          yield validation.ack
          continue
        }
        if (message.type === 'cancel') {
          active.controller.abort(message.reason)
          active.protocol.close('cancelled')
          active.status = statusFromAck(validation.ack, 'cancelled')
          this.#finish(active)
          yield validation.ack
          return
        }
        if (message.type === 'complete') {
          const result = await active.protocol.requestCompleted()
          const estimate = estimateQwenRealtimeCost(active.open.modelId as QwenRealtimeCloudModelId, result.usage)
          if (!estimate.ok) {
            yield this.#reject(active, 'provider-output-invalid')
            return
          }
          const recorded = this.#costLedger.recordIncurred({
            sessionId: active.open.sessionId,
            modelId: active.open.modelId as QwenRealtimeCloudModelId,
            incurredAt: this.#now(),
            amountMicros: estimate.amountMicros,
            priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
          })
          if (!recorded.allowed) {
            yield this.#reject(active, 'budget-exceeded')
            return
          }
          active.protocol.close('completed')
          const ack: PerceptionMediaTransportAck = {
            ...validation.ack,
            result: {
              responseId: result.responseId,
              observationId: active.open.observationId,
              sourceKind: active.open.sourceKind,
              modelId: active.open.modelId,
              completedText: result.completedText,
              usage: {
                ...result.usage,
                outputAudioTokens: result.usage.outputAudioTokens ?? 0,
              },
              amountMicros: estimate.amountMicros,
              priceProfileId: estimate.priceProfileId,
            },
          }
          active.status = statusFromAck(ack, 'completed')
          this.#finish(active)
          yield ack
          return
        }

        yield validation.ack
      }
      if (active)
        yield this.#reject(active, 'cancelled')
    }
    catch (error) {
      if (active)
        yield this.#reject(active, mapError(error))
    }
  }

  status(request: PerceptionMediaTransportStatusRequest): PerceptionMediaTransportStatus {
    const active = this.#active.get(request.windowId)
    if (active && active.open.sessionId === request.sessionId && active.open.generation === request.generation)
      return { ...active.status }
    const terminal = this.#terminal.get(request.windowId)
    if (terminal && terminal.sessionId === request.sessionId && terminal.generation === request.generation)
      return { ...terminal }
    return {
      sessionId: request.sessionId,
      generation: request.generation,
      windowId: request.windowId,
      state: 'unknown',
      acceptedAudioBytes: 0,
      acceptedImageBytes: 0,
      droppedItems: 0,
    }
  }

  cancelWindow(windowId: string, reason = 'user-stop'): boolean {
    const active = this.#active.get(windowId)
    if (!active)
      return false
    active.controller.abort(reason)
    active.protocol.close('cancelled')
    active.status = { ...active.status, state: 'cancelled', errorCode: 'cancelled' }
    this.#finish(active)
    return true
  }

  cancelByGrant(grantId: string): void {
    for (const active of this.#active.values()) {
      if (active.open.frameConsentGrantId === grantId || active.open.audioConsentGrantId === grantId)
        this.cancelWindow(active.open.windowId, 'permission-revoked')
    }
  }

  stopAll(reason = 'user-stop'): void {
    for (const windowId of this.#active.keys())
      this.cancelWindow(windowId, reason)
  }

  async #open(message: PerceptionMediaStreamOpen, outerSignal?: AbortSignal): Promise<ActiveGatewaySession | undefined> {
    if (!this.#isReady()
      || message.providerId !== QWEN_CLOUD_PROVIDER_ID
      || !isAllowedRoute(message)
      || !this.#grants.authorize({
        sessionId: message.sessionId,
        generation: message.generation,
        sourceKind: message.sourceKind,
        sourceId: message.sourceId,
        modelId: message.modelId,
        frameGrantId: message.frameConsentGrantId,
        audioGrantId: message.audioConsentGrantId,
      })
      || !this.#costLedger.authorize(message.sessionId, PRE_CALL_COST_RESERVE_MICROS).allowed
      || this.#active.has(message.windowId)) {
      return undefined
    }
    const workspaceId = this.#getWorkspaceId()
    const apiKey = this.#getApiKey()
    if (!workspaceId || !apiKey)
      return undefined
    const controller = new AbortController()
    const onOuterAbort = () => controller.abort('renderer-aborted')
    outerSignal?.addEventListener('abort', onOuterAbort, { once: true })
    const protocol = new QwenRealtimeProtocolSession({
      workspaceId,
      apiKey,
      modelId: message.modelId as QwenRealtimeCloudModelId,
      sourceKind: message.sourceKind,
      socketFactory: this.#socketFactory,
    })
    try {
      await protocol.open(controller.signal)
    }
    catch {
      outerSignal?.removeEventListener('abort', onOuterAbort)
      protocol.close('cancelled')
      return undefined
    }
    const active: ActiveGatewaySession = {
      open: message,
      controller,
      protocol,
      cleanupOuterAbort: () => outerSignal?.removeEventListener('abort', onOuterAbort),
      status: {
        sessionId: message.sessionId,
        generation: message.generation,
        windowId: message.windowId,
        state: 'opening',
        acceptedAudioBytes: 0,
        acceptedImageBytes: 0,
        droppedItems: 0,
      },
    }
    this.#active.set(message.windowId, active)
    return active
  }

  #reject(active: ActiveGatewaySession, errorCode: PerceptionMediaTransportErrorCode): PerceptionMediaTransportAck {
    active.controller.abort(errorCode)
    active.protocol.close('cancelled')
    const ack: PerceptionMediaTransportAck = {
      contractVersion: active.open.contractVersion,
      sessionId: active.open.sessionId,
      generation: active.open.generation,
      windowId: active.open.windowId,
      type: 'rejected',
      acceptedAudioBytes: active.status.acceptedAudioBytes,
      acceptedImageBytes: active.status.acceptedImageBytes,
      droppedItems: active.status.droppedItems,
      errorCode,
    }
    active.status = statusFromAck(ack, 'failed')
    this.#finish(active)
    return ack
  }

  #finish(active: ActiveGatewaySession): void {
    active.cleanupOuterAbort()
    this.#active.delete(active.open.windowId)
    this.#terminal.set(active.open.windowId, { ...active.status })
    while (this.#terminal.size > 64)
      this.#terminal.delete(this.#terminal.keys().next().value!)
  }
}

function isAllowedRoute(open: PerceptionMediaStreamOpen): boolean {
  if (open.sourceKind === 'camera-cloud')
    return open.modelId === QWEN_FLASH_REALTIME_MODEL_ID
  return open.modelId === QWEN_FLASH_REALTIME_MODEL_ID || open.modelId === QWEN_PLUS_REALTIME_MODEL_ID
}

function rejectedOpen(open: PerceptionMediaStreamOpen, errorCode: PerceptionMediaTransportErrorCode): PerceptionMediaTransportAck {
  return {
    contractVersion: open.contractVersion,
    sessionId: open.sessionId,
    generation: open.generation,
    windowId: open.windowId,
    type: 'rejected',
    acceptedAudioBytes: 0,
    acceptedImageBytes: 0,
    droppedItems: 0,
    errorCode,
  }
}

function statusFromAck(ack: PerceptionMediaTransportAck, state: PerceptionMediaTransportStatus['state']): PerceptionMediaTransportStatus {
  return {
    sessionId: ack.sessionId,
    generation: ack.generation,
    windowId: ack.windowId,
    state,
    acceptedAudioBytes: ack.acceptedAudioBytes,
    acceptedImageBytes: ack.acceptedImageBytes,
    droppedItems: ack.droppedItems,
    ...(ack.errorCode ? { errorCode: ack.errorCode } : {}),
  }
}

function mapError(error: unknown): PerceptionMediaTransportErrorCode {
  if (error instanceof QwenRealtimeProtocolError) {
    if (error.code === 'cancelled')
      return 'cancelled'
    if (['payload-invalid', 'audio-required-before-image', 'audio-required', 'image-required', 'invalid-state'].includes(error.code))
      return 'invalid-order'
    if (['provider-event-invalid', 'provider-error', 'output-audio-forbidden', 'response-incomplete'].includes(error.code))
      return 'provider-output-invalid'
  }
  return 'provider-unavailable'
}
