import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useVoiceConversationStore } from './voiceConversation'

function startStore() {
  const store = useVoiceConversationStore()
  store.start({
    sessionId: 'voice-session-1',
    mode: 'vad-turn-taking',
    inputProviderId: 'asr-provider',
    inputModelId: 'asr-model',
    outputProviderId: 'tts-provider',
    outputModelId: 'tts-model',
    voiceId: 'voice-1',
    listeningImmediately: true,
    now: 1000,
  })
  return store
}

describe('voice conversation store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts a runtime-only listening session without provider side effects', () => {
    const store = startStore()

    expect(store.state).toBe('listening')
    expect(store.session?.sessionId).toBe('voice-session-1')
    expect(store.session?.inputProviderId).toBe('asr-provider')
    expect(store.canAcceptUserSpeech).toBe(true)
    expect(store.isActive).toBe(true)
    expect(store.timeline.map(entry => entry.name)).toEqual([
      'voice.session.start',
    ])
  })

  it('tracks active turns through dispatch and rejects stale turn updates', () => {
    const store = startStore()

    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1010 })
    store.dispatch({ type: 'speech-end', turnId: 'turn-1', at: 1020 })

    expect(store.state).toBe('transcribing')
    expect(store.activeTurnId).toBe('turn-1')
    expect(store.isCurrentTurn('turn-1')).toBe(true)

    store.dispatch({ type: 'asr-final', turnId: 'turn-old', at: 1030 })

    expect(store.state).toBe('transcribing')
    expect(store.activeTurnId).toBe('turn-1')
    expect(store.lastTransitionError?.code).toBe('stale_turn')
    expect(store.timeline.map(entry => entry.name)).toEqual([
      'voice.session.start',
      'voice.vad.speech_start',
      'voice.vad.speech_end',
    ])
  })

  it('orders permission request and grant before VAD startup', () => {
    const store = useVoiceConversationStore()
    store.beginPermissionRequest({
      sessionId: 'voice-permission-1',
      mode: 'streaming-asr',
      now: 1000,
    })
    store.grantPermission(1010)
    store.dispatch({ type: 'vad-started', at: 1020 })

    expect(store.state).toBe('listening')
    expect(store.timeline.map(entry => entry.name)).toEqual([
      'voice.session.start',
      'voice.permission.requested',
      'voice.permission.granted',
      'voice.vad.started',
    ])
  })

  it('records permission revocation without exposing platform error text', () => {
    const store = useVoiceConversationStore()
    store.beginPermissionRequest({
      sessionId: 'voice-permission-2',
      mode: 'vad-turn-taking',
      now: 1000,
    })
    store.grantPermission(1010)
    store.denyPermission({ at: 1020, revoked: true })

    expect(store.state).toBe('failed')
    expect(store.timeline.map(entry => entry.name)).toEqual([
      'voice.session.start',
      'voice.permission.requested',
      'voice.permission.granted',
      'voice.permission.revoked',
    ])
    expect(JSON.stringify(store.timeline)).not.toContain('private device details')
  })

  it('clears transition errors after a valid event', () => {
    const store = startStore()

    store.dispatch({ type: 'asr-final', turnId: 'turn-without-speech', at: 1010 })
    expect(store.lastTransitionError?.code).toBe('stale_turn')

    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1020 })
    expect(store.lastTransitionError).toBeNull()
    expect(store.state).toBe('speech-detected')
  })

  it('stops active sessions on provider switch and updates the provider snapshot', () => {
    const store = startStore()
    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1010 })

    store.applyProviderSwitch({
      inputProviderId: 'asr-provider-2',
      inputModelId: 'asr-model-2',
      outputProviderId: 'tts-provider-2',
      outputModelId: 'tts-model-2',
      voiceId: 'voice-2',
      now: 1020,
    })

    expect(store.state).toBe('stopped')
    expect(store.session?.activeTurnId).toBeUndefined()
    expect(store.session?.lastCancelReason).toBe('provider-switch')
    expect(store.session?.inputProviderId).toBe('asr-provider-2')
    expect(store.session?.outputProviderId).toBe('tts-provider-2')
    expect(store.session?.voiceId).toBe('voice-2')
  })

  it('resets all runtime-only voice state', () => {
    const store = startStore()
    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1010 })

    store.reset()

    expect(store.session).toBeNull()
    expect(store.timeline).toEqual([])
    expect(store.state).toBe('idle')
    expect(store.activeTurnId).toBeUndefined()
    expect(store.lastTransitionError).toBeNull()
  })

  it('records accepted timeline events without storing transcript text', () => {
    const store = startStore()

    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1010 })
    store.dispatch({ type: 'speech-end', turnId: 'turn-1', at: 1020 })
    store.dispatch({ type: 'asr-final', turnId: 'turn-1', at: 1030 }, { textLength: 6 })
    store.dispatch({ type: 'chat-ingested', turnId: 'turn-1', at: 1040 })
    store.dispatch({ type: 'llm-first-token', turnId: 'turn-1', at: 1050 })
    store.dispatch({ type: 'llm-completed', turnId: 'turn-1', at: 1060 })
    store.dispatch({ type: 'tts-first-request', turnId: 'turn-1', at: 1070 })
    store.dispatch({ type: 'tts-first-audio', turnId: 'turn-1', at: 1080 })
    store.dispatch({ type: 'playback-started', turnId: 'turn-1', at: 1090 })

    expect(store.timeline.map(entry => entry.name)).toContain('voice.asr.final')
    expect(store.timeline.find(entry => entry.name === 'voice.asr.final')?.textLength).toBe(6)
    expect(JSON.stringify(store.timeline)).not.toContain('用户原文')
  })
})
