import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createVoiceRuntimeQuiescePeer,
  requestVoiceRuntimeQuiesce,
} from './voice-runtime-quiesce'

interface MockMessageEvent {
  data: unknown
}

type MockMessageListener = (event: MockMessageEvent) => void

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>()
  static messages: unknown[] = []

  private readonly listeners = new Set<MockMessageListener>()
  readonly name: string

  constructor(name: string) {
    this.name = name
    const peers = MockBroadcastChannel.channels.get(name) ?? new Set<MockBroadcastChannel>()
    peers.add(this)
    MockBroadcastChannel.channels.set(name, peers)
  }

  addEventListener(_type: 'message', listener: MockMessageListener) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: MockMessageListener) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    MockBroadcastChannel.messages.push(data)
    for (const peer of MockBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this)
        continue
      for (const listener of peer.listeners)
        queueMicrotask(() => listener({ data }))
    }
  }

  close() {
    const peers = MockBroadcastChannel.channels.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0)
      MockBroadcastChannel.channels.delete(this.name)
    this.listeners.clear()
  }

  static reset() {
    for (const peers of MockBroadcastChannel.channels.values()) {
      for (const peer of peers)
        peer.close()
    }
    MockBroadcastChannel.channels.clear()
    MockBroadcastChannel.messages = []
  }
}

describe('voice runtime quiesce control', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockBroadcastChannel.reset()
    vi.useRealTimers()
  })

  it('waits for the Stage acknowledgement before resolving', async () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    const requests: Array<{ reason: string, correlationId: string }> = []
    const stagePeer = createVoiceRuntimeQuiescePeer({
      onRequest: async (request) => {
        requests.push(request)
      },
      timeoutMs: 100,
    })
    const settingsPeer = createVoiceRuntimeQuiescePeer({ timeoutMs: 100 })

    const result = await settingsPeer.request('provider-switch')

    expect(result.status).toBe('quiesced')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      reason: 'provider-switch',
      correlationId: expect.stringMatching(/^voice-quiesce:/),
    })
    stagePeer.dispose()
    settingsPeer.dispose()
  })

  it('returns a bounded failed acknowledgement without leaking payloads', async () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    const stagePeer = createVoiceRuntimeQuiescePeer({
      onRequest: async () => {
        throw new Error('cancellation failed')
      },
      timeoutMs: 100,
    })
    const settingsPeer = createVoiceRuntimeQuiescePeer({ timeoutMs: 100 })

    const result = await settingsPeer.request('model-switch')

    expect(result.status).toBe('failed')
    const serializedMessages = JSON.stringify(MockBroadcastChannel.messages)
    expect(serializedMessages).not.toContain('cancellation failed')
    expect(serializedMessages).not.toContain('transcript')
    expect(serializedMessages).not.toContain('audio')
    stagePeer.dispose()
    settingsPeer.dispose()
  })

  it('times out and disposes pending requests instead of waiting indefinitely', async () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    vi.useFakeTimers()
    const settingsPeer = createVoiceRuntimeQuiescePeer({ timeoutMs: 20 })

    const pending = settingsPeer.request('voice-switch')
    await vi.advanceTimersByTimeAsync(20)
    await expect(pending).resolves.toMatchObject({ status: 'timed-out' })

    settingsPeer.dispose()
  })

  it('uses the public requester with a missing Stage as a bounded no-owner request', async () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    vi.useFakeTimers()

    const pending = requestVoiceRuntimeQuiesce('provider-switch')
    await vi.advanceTimersByTimeAsync(1_500)

    await expect(pending).resolves.toMatchObject({ status: 'timed-out' })
  })
})
