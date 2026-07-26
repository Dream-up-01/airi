import { describe, expect, it, vi } from 'vitest'

import { createVoicePlaybackEchoGateState, updateVoicePlaybackEchoGate } from '../../domains/voiceConversation/echo-gate'
import { AudioFanoutHub, PERCEPTION_PCM_AUDIO_FORMAT } from './audio-fanout'
import { createCloudPerceptionAudioEchoGate } from './cloud-audio-gate'

function chunk(id: number) {
  return {
    chunkId: `chunk:${id}`,
    capturedAt: id,
    monotonicTimestamp: id,
    format: PERCEPTION_PCM_AUDIO_FORMAT,
    samples: new Int16Array([id, id + 1]),
  }
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index++)
    await Promise.resolve()
}

describe('audio fanout hub', () => {
  it('gives canonical and cloud lanes independent PCM copies and controllers', async () => {
    const canonical: number[] = []
    const cloud: number[] = []
    const signals: AbortSignal[] = []
    const hub = new AudioFanoutHub()
    hub.subscribe({
      subscriberId: 'canonical',
      lane: 'canonical-transcript',
      onChunk: (value, context) => {
        canonical.push(value.samples[0] ?? 0)
        value.samples[0] = 999
        signals.push(context.signal)
      },
    })
    hub.subscribe({
      subscriberId: 'cloud',
      lane: 'cloud-perception',
      onChunk: (value, context) => {
        cloud.push(value.samples[0] ?? 0)
        signals.push(context.signal)
      },
    })

    hub.publish(chunk(1))
    await flushMicrotasks()
    expect(canonical).toEqual([1])
    expect(cloud).toEqual([1])
    expect(signals[0]).not.toBe(signals[1])
  })

  it('drops old cloud chunks under backpressure without blocking canonical delivery', async () => {
    let releaseCloud: (() => void) | undefined
    const cloudGate = new Promise<void>((resolve) => {
      releaseCloud = resolve
    })
    const canonical: number[] = []
    const cloud: number[] = []
    const hub = new AudioFanoutHub()
    const canonicalSubscription = hub.subscribe({
      subscriberId: 'canonical',
      lane: 'canonical-transcript',
      onChunk: (value) => {
        canonical.push(value.samples[0] ?? 0)
      },
    })
    const cloudSubscription = hub.subscribe({
      subscriberId: 'cloud',
      lane: 'cloud-perception',
      queueCapacity: 2,
      overflow: 'drop-oldest',
      onChunk: async (value) => {
        cloud.push(value.samples[0] ?? 0)
        if (cloud.length === 1)
          await cloudGate
      },
    })

    for (let id = 1; id <= 5; id++)
      hub.publish(chunk(id))
    await flushMicrotasks()
    expect(canonical).toEqual([1, 2, 3, 4, 5])
    expect(cloud).toEqual([1])
    expect(cloudSubscription.stats().droppedChunks).toBe(2)
    expect(canonicalSubscription.stats().droppedChunks).toBe(0)

    releaseCloud?.()
    await flushMicrotasks()
    expect(cloud).toEqual([1, 4, 5])
  })

  it('stopping either lane does not abort the other and onEmpty runs only after the last lane', async () => {
    const onEmpty = vi.fn()
    const canonical: number[] = []
    const cloud: number[] = []
    const hub = new AudioFanoutHub({ onEmpty })
    const canonicalSubscription = hub.subscribe({
      subscriberId: 'canonical',
      lane: 'canonical-transcript',
      onChunk: (value) => {
        canonical.push(value.samples[0] ?? 0)
      },
    })
    const cloudSubscription = hub.subscribe({
      subscriberId: 'cloud',
      lane: 'cloud-perception',
      onChunk: (value) => {
        cloud.push(value.samples[0] ?? 0)
      },
    })

    cloudSubscription.unsubscribe()
    hub.publish(chunk(2))
    await flushMicrotasks()
    expect(canonical).toEqual([2])
    expect(cloud).toEqual([])
    expect(onEmpty).not.toHaveBeenCalled()

    canonicalSubscription.unsubscribe()
    canonicalSubscription.unsubscribe()
    expect(onEmpty).toHaveBeenCalledOnce()
  })

  it('aborts only the removed subscriber controller', async () => {
    let cloudSignal: AbortSignal | undefined
    const canonical: number[] = []
    const hub = new AudioFanoutHub()
    hub.subscribe({
      subscriberId: 'canonical',
      lane: 'canonical-transcript',
      onChunk: (value) => {
        canonical.push(value.samples[0] ?? 0)
      },
    })
    const cloudSubscription = hub.subscribe({
      subscriberId: 'cloud',
      lane: 'cloud-perception',
      onChunk: async (_value, context) => {
        cloudSignal = context.signal
        await new Promise<void>(() => undefined)
      },
    })

    hub.publish(chunk(1))
    await flushMicrotasks()
    expect(cloudSignal?.aborted).toBe(false)
    cloudSubscription.unsubscribe()
    expect(cloudSignal?.aborted).toBe(true)

    hub.publish(chunk(2))
    await flushMicrotasks()
    expect(canonical).toEqual([1, 2])
  })

  it('reuses the voice playback echo gate for cloud audio without blocking canonical audio', async () => {
    let now = 1_000
    let echoState = updateVoicePlaybackEchoGate(createVoicePlaybackEchoGateState(), {
      audiblePlayback: true,
      voiceConversationState: 'speaking',
      at: now,
    })
    const canonical: number[] = []
    const cloud: number[] = []
    const hub = new AudioFanoutHub()
    hub.subscribe({
      subscriberId: 'canonical',
      lane: 'canonical-transcript',
      onChunk: (value) => {
        canonical.push(value.samples[0] ?? 0)
      },
    })
    const cloudSubscription = hub.subscribe({
      subscriberId: 'cloud',
      lane: 'cloud-perception',
      shouldAccept: createCloudPerceptionAudioEchoGate(() => echoState, () => now),
      onChunk: (value) => {
        cloud.push(value.samples[0] ?? 0)
      },
    })

    hub.publish(chunk(1))
    await flushMicrotasks()
    expect(canonical).toEqual([1])
    expect(cloud).toEqual([])
    expect(cloudSubscription.stats().gatedChunks).toBe(1)

    now = 2_000
    echoState = createVoicePlaybackEchoGateState()
    hub.publish(chunk(2))
    await flushMicrotasks()
    expect(cloud).toEqual([2])
  })
})
