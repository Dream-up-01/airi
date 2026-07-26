import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSpeechOutputControlStore } from './speech-output-control'

describe('speech output control store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('records manual chat stop-speaking requests with monotonic sequence numbers', () => {
    const store = useSpeechOutputControlStore()

    expect(store.latestStopRequest).toBeUndefined()

    store.requestStopSpeaking('manual-chat')

    expect(store.latestStopRequest).toEqual({
      id: 1,
      reason: 'manual-chat',
    })

    store.requestStopSpeaking('manual-chat')

    expect(store.latestStopRequest).toEqual({
      id: 2,
      reason: 'manual-chat',
    })
  })

  it('records voice interruption requests with the same host channel', () => {
    const store = useSpeechOutputControlStore()

    store.requestStopSpeaking('voice-interrupt')

    expect(store.latestStopRequest).toEqual({
      id: 1,
      reason: 'voice-interrupt',
    })
  })

  it('records voice stop requests separately from interruption requests', () => {
    const store = useSpeechOutputControlStore()

    store.requestStopSpeaking('voice-stop')

    expect(store.latestStopRequest).toEqual({
      id: 1,
      reason: 'voice-stop',
    })
  })

  it('routes provider switches through the same cancellable output host', () => {
    const store = useSpeechOutputControlStore()

    store.requestStopSpeaking('provider-switch')

    expect(store.latestStopRequest).toEqual({
      id: 1,
      reason: 'provider-switch',
    })
  })

  it('acknowledges only monotonic completed stop requests', () => {
    const store = useSpeechOutputControlStore()
    const firstRequestId = store.requestStopSpeaking('voice-interrupt')
    const secondRequestId = store.requestStopSpeaking('voice-stop')

    store.acknowledgeStopSpeaking(secondRequestId)
    store.acknowledgeStopSpeaking(firstRequestId)
    store.acknowledgeStopSpeaking(0)

    expect(store.latestStopAcknowledgement).toEqual({ requestId: secondRequestId })
  })
})
