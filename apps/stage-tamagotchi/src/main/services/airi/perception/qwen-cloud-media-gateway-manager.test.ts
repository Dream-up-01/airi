import type { PerceptionMediaTransportMessage } from '../../../../shared/eventa/perception'
import type { QwenRealtimeSocketEvent, QwenRealtimeSocketLike } from './qwen-realtime-protocol'

import {
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it } from 'vitest'

import { PERCEPTION_MEDIA_TRANSPORT_VERSION } from '../../../../shared/eventa/perception'
import { QWEN_CLOUD_GRANT_VERSION } from '../../../../shared/eventa/perception-cloud'
import { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'
import { QwenCloudMediaGatewayManager } from './qwen-cloud-media-gateway-manager'

describe('qwenCloudMediaGatewayManager', () => {
  it('requires two grants, sends real audio before JPEG, and returns only bounded completed output', async () => {
    const grants = grantsForCamera()
    const socket = new CompletingSocket()
    const manager = new QwenCloudMediaGatewayManager({
      grants,
      socketFactory: () => socket,
      isReady: () => true,
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'local-secret',
      now: () => 2_000,
    })
    const messages: PerceptionMediaTransportMessage[] = [
      open(),
      correlation({
        type: 'audio-chunk',
        sequence: 0,
        capturedAt: 1_010,
        monotonicTimestamp: 10,
        audioFormat: 'pcm-s16le-16000-mono',
        pcm: new Uint8Array([1, 0, 2, 0]),
      }),
      correlation({
        type: 'image-frame',
        sequence: 0,
        capturedAt: 1_020,
        monotonicTimestamp: 20,
        width: 640,
        height: 360,
        jpeg: new Uint8Array([0xFF, 0xD8, 1, 2, 0xFF, 0xD9]),
      }),
      correlation({ type: 'complete', endedAt: 1_030 }),
    ]

    const acknowledgements = []
    for await (const acknowledgement of manager.handle(asStream(messages)))
      acknowledgements.push(acknowledgement)

    expect(acknowledgements.map(item => item.type)).toEqual(['opened', 'audio-accepted', 'image-accepted', 'completed'])
    expect(acknowledgements.at(-1)?.result).toMatchObject({
      observationId: 'observation:camera',
      sourceKind: 'camera-cloud',
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      completedText: '{"events":[]}',
    })
    expect(JSON.stringify(acknowledgements)).not.toMatch(/local-secret|workspace-1|base64|jpeg|pcm/iu)
    expect(socket.sentJson().map(item => item.type)).toEqual([
      'session.update',
      'input_audio_buffer.append',
      'input_image_buffer.append',
      'input_audio_buffer.commit',
      'response.create',
    ])
  })

  it('rejects before opening a provider socket when either consent is missing', async () => {
    const grants = new QwenCloudGrantRegistry({ now: () => 1_000 })
    grants.register(grantRequest('grant:frame', 'camera-frames'))
    let socketCreated = false
    const manager = new QwenCloudMediaGatewayManager({
      grants,
      socketFactory: () => {
        socketCreated = true
        return new CompletingSocket()
      },
      isReady: () => true,
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'local-secret',
    })
    const acknowledgements = []
    for await (const acknowledgement of manager.handle(asStream([open()])))
      acknowledgements.push(acknowledgement)
    expect(acknowledgements).toEqual([expect.objectContaining({ type: 'rejected', errorCode: 'consent-missing' })])
    expect(socketCreated).toBe(false)
  })
})

class CompletingSocket implements QwenRealtimeSocketLike {
  readyState = 1
  readonly sent: string[] = []
  readonly listeners = new Map<string, Array<(event: QwenRealtimeSocketEvent) => void>>()

  send(data: string): void {
    this.sent.push(data)
    if (JSON.parse(data).type === 'response.create') {
      queueMicrotask(() => {
        this.emit({
          event_id: 'server-1',
          type: 'response.text.done',
          response_id: 'response-1',
          item_id: 'item-1',
          output_index: 0,
          content_index: 0,
          text: '{"events":[]}',
        })
        this.emit(responseDone())
      })
    }
  }

  close(): void {}

  addEventListener(type: string, listener: (event: QwenRealtimeSocketEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: (event: QwenRealtimeSocketEvent) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(candidate => candidate !== listener))
  }

  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map(item => JSON.parse(item))
  }

  emit(value: unknown): void {
    for (const listener of this.listeners.get('message') ?? [])
      listener({ data: JSON.stringify(value) })
  }
}

function grantsForCamera(): QwenCloudGrantRegistry {
  const grants = new QwenCloudGrantRegistry({ now: () => 1_000 })
  grants.register(grantRequest('grant:frame', 'camera-frames'))
  grants.register(grantRequest('grant:audio', 'microphone-audio'))
  return grants
}

function grantRequest(grantId: string, modality: 'camera-frames' | 'microphone-audio') {
  return {
    contractVersion: QWEN_CLOUD_GRANT_VERSION,
    sessionId: 'session:camera',
    generation: 1,
    grant: {
      contractVersion: 'perception/v0.3' as const,
      grantId,
      sourceKind: 'camera' as const,
      sourceId: 'camera:default',
      processingMode: 'mixed' as const,
      allowedModalities: [modality],
      allowedFactCategories: ['person.presence'],
      cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
      cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
      regionId: QWEN_CLOUD_REGION_ID,
      costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  }
}

function open(): PerceptionMediaTransportMessage {
  return correlation({
    type: 'open',
    observationId: 'observation:camera',
    sourceKind: 'camera-cloud',
    sourceId: 'camera:default',
    frameConsentGrantId: 'grant:frame',
    audioConsentGrantId: 'grant:audio',
    providerId: QWEN_CLOUD_PROVIDER_ID,
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    startedAt: 1_000,
    monotonicTimestampBase: 0,
  })
}

function correlation<const T extends Record<string, unknown>>(value: T): T & {
  contractVersion: typeof PERCEPTION_MEDIA_TRANSPORT_VERSION
  sessionId: string
  generation: number
  windowId: string
} {
  return {
    contractVersion: PERCEPTION_MEDIA_TRANSPORT_VERSION,
    sessionId: 'session:camera',
    generation: 1,
    windowId: 'window:camera',
    ...value,
  }
}

function asStream(messages: PerceptionMediaTransportMessage[]): ReadableStream<PerceptionMediaTransportMessage> {
  return new ReadableStream({
    start(controller) {
      messages.forEach(message => controller.enqueue(message))
      controller.close()
    },
  })
}

function responseDone() {
  return {
    event_id: 'server-2',
    type: 'response.done',
    response: {
      id: 'response-1',
      object: 'realtime.response',
      conversation_id: 'conversation-1',
      status: 'completed',
      modalities: ['text'],
      output: [{
        id: 'item-1',
        object: 'realtime.item',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'text', text: '{"events":[]}' }],
      }],
      usage: {
        total_tokens: 185,
        input_tokens: 175,
        output_tokens: 10,
        input_tokens_details: { text_tokens: 100, image_tokens: 50, audio_tokens: 25 },
        output_tokens_details: { text_tokens: 10, audio_tokens: 0 },
      },
    },
  }
}
