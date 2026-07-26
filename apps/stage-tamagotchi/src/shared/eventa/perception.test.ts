import type { PerceptionMediaTransportMessage } from './perception'

import { createContext, defineStreamInvoke, defineStreamInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  createPerceptionMediaTransportValidator,
  electronPerceptionMediaStream,
  MAX_PERCEPTION_AUDIO_CHUNK_BYTES,
  MAX_PERCEPTION_JPEG_BYTES,
  parsePerceptionMediaTransportMessage,
  PERCEPTION_AUDIO_FORMAT,
  PERCEPTION_MEDIA_TRANSPORT_VERSION,
} from './perception'

const correlation = {
  contractVersion: PERCEPTION_MEDIA_TRANSPORT_VERSION,
  sessionId: 'session:1',
  generation: 2,
  windowId: 'window:1',
} as const

function openMessage(): PerceptionMediaTransportMessage {
  return {
    ...correlation,
    type: 'open',
    observationId: 'observation:1',
    sourceKind: 'camera-cloud',
    sourceId: 'camera:default',
    frameConsentGrantId: 'grant:cloud-frame',
    audioConsentGrantId: 'grant:cloud-audio',
    providerId: 'aliyun',
    modelId: 'qwen3.5-omni-flash-realtime',
    startedAt: 1_000,
    monotonicTimestampBase: 100,
  }
}

describe('perception Eventa media transport', () => {
  it('rejects unknown fields and oversized PCM/JPEG at the wire edge', () => {
    expect(parsePerceptionMediaTransportMessage({ ...openMessage(), apiKey: 'forbidden' }).ok).toBe(false)
    expect(parsePerceptionMediaTransportMessage({
      ...correlation,
      type: 'audio-chunk',
      sequence: 1,
      capturedAt: 1_100,
      monotonicTimestamp: 200,
      audioFormat: PERCEPTION_AUDIO_FORMAT,
      pcm: new Uint8Array(MAX_PERCEPTION_AUDIO_CHUNK_BYTES + 1),
    })).toEqual({ ok: false, errorCode: 'payload-too-large' })
    expect(parsePerceptionMediaTransportMessage({
      ...correlation,
      type: 'image-frame',
      sequence: 1,
      capturedAt: 1_100,
      monotonicTimestamp: 200,
      width: 640,
      height: 360,
      jpeg: new Uint8Array(MAX_PERCEPTION_JPEG_BYTES + 1),
    })).toEqual({ ok: false, errorCode: 'payload-too-large' })
  })

  it('enforces consent, generation, correlation and monotonic sequence', () => {
    const validator = createPerceptionMediaTransportValidator({
      expectedSessionId: 'session:1',
      expectedGeneration: 2,
      isConsentActive: grantId => ['grant:cloud-frame', 'grant:cloud-audio'].includes(grantId),
    })
    expect(validator.accept({ ...openMessage(), audioConsentGrantId: 'grant:revoked' })).toEqual({ ok: false, errorCode: 'consent-missing' })
    expect(validator.accept({ ...openMessage(), generation: 1 })).toEqual({ ok: false, errorCode: 'stale-generation' })
    expect(validator.accept(openMessage()).ok).toBe(true)

    const audio = {
      ...correlation,
      type: 'audio-chunk' as const,
      sequence: 1,
      capturedAt: 1_100,
      monotonicTimestamp: 200,
      audioFormat: PERCEPTION_AUDIO_FORMAT,
      pcm: new Uint8Array(3_200),
    }
    expect(validator.accept(audio).ok).toBe(true)
    expect(validator.accept(audio)).toEqual({ ok: false, errorCode: 'invalid-order' })
    expect(validator.snapshot()).toEqual({
      acceptedAudioBytes: 3_200,
      acceptedImageBytes: 0,
      state: 'streaming',
    })
  })

  it('streams fake PCM/JPEG bidirectionally with per-window acknowledgements', async () => {
    const context = createContext()
    const validator = createPerceptionMediaTransportValidator({
      expectedSessionId: 'session:1',
      expectedGeneration: 2,
      isConsentActive: () => true,
    })
    defineStreamInvokeHandler(context, electronPerceptionMediaStream, async function* (incoming) {
      for await (const message of incoming) {
        const result = validator.accept(message)
        if (!result.ok)
          throw new Error(result.errorCode)
        yield result.ack
      }
    })

    const messages: PerceptionMediaTransportMessage[] = [
      openMessage(),
      {
        ...correlation,
        type: 'audio-chunk',
        sequence: 1,
        capturedAt: 1_100,
        monotonicTimestamp: 200,
        audioFormat: PERCEPTION_AUDIO_FORMAT,
        pcm: new Uint8Array(3_200),
      },
      {
        ...correlation,
        type: 'image-frame',
        sequence: 1,
        capturedAt: 1_200,
        monotonicTimestamp: 300,
        width: 640,
        height: 360,
        jpeg: new Uint8Array(12_000),
      },
      { ...correlation, type: 'complete', endedAt: 1_300 },
    ]
    const outgoing = new ReadableStream<PerceptionMediaTransportMessage>({
      start(controller) {
        for (const message of messages)
          controller.enqueue(message)
        controller.close()
      },
    })

    const invoke = defineStreamInvoke(context, electronPerceptionMediaStream)
    const acknowledgements = []
    for await (const acknowledgement of invoke(outgoing))
      acknowledgements.push(acknowledgement)

    expect(acknowledgements.map(item => item.type)).toEqual(['opened', 'audio-accepted', 'image-accepted', 'completed'])
    expect(acknowledgements.at(-1)).toMatchObject({
      sessionId: 'session:1',
      generation: 2,
      windowId: 'window:1',
      acceptedAudioBytes: 3_200,
      acceptedImageBytes: 12_000,
    })
  })

  it('propagates AbortSignal to the stream handler', async () => {
    const context = createContext()
    let handlerSignal: AbortSignal | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const validator = createPerceptionMediaTransportValidator({
      expectedSessionId: 'session:1',
      expectedGeneration: 2,
      isConsentActive: () => true,
    })
    defineStreamInvokeHandler(context, electronPerceptionMediaStream, async function* (incoming, options) {
      handlerSignal = options?.abortController?.signal
      const first = await incoming.getReader().read()
      if (!first.done) {
        const result = validator.accept(first.value)
        if (!result.ok)
          throw new Error(result.errorCode)
        markStarted?.()
        await new Promise<void>((resolve) => {
          handlerSignal?.addEventListener('abort', () => resolve(), { once: true })
        })
        yield result.ack
      }
    })

    const outgoing = new ReadableStream<PerceptionMediaTransportMessage>({
      start(controller) {
        controller.enqueue(openMessage())
      },
    })
    const controller = new AbortController()
    const invoke = defineStreamInvoke(context, electronPerceptionMediaStream)
    const responseReader = invoke(outgoing, { signal: controller.signal }).getReader()
    const pendingRead = responseReader.read().catch(() => ({ done: true as const, value: undefined }))
    await started
    controller.abort('test-cancel')
    await vi.waitFor(() => expect(handlerSignal?.aborted).toBe(true))
    await pendingRead
  })
})
