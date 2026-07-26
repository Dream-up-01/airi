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

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // In apps/stage-tamagotchi/src/renderer/pages/index.vue, the
  // `shouldIgnoreAutomaticVoiceInput()` and `isRecentDuplicateVoiceFinal()`
  // branches of `consumeFinalAsrTranscript` returned without releasing the
  // already-opened voice turn. The session then stayed in
  // 'speech-detected'/'transcribing' with that turn active; as this test pins
  // down, 'speech-start' for any new turn is rejected from those states, so
  // the page's busy guard (`canStartAutomaticVoiceTurn()`) never opened
  // another microphone turn. Repeating the same short phrase twice within
  // 2 seconds (duplicate final) froze the voice loop permanently.
  //
  // We fixed this by dropping the held turn in both branches
  // (`dropActiveVoiceTurnAndResumeListening`: stop + fresh listening session)
  // before returning. This test pins the store contract behind that fix:
  // stop + start is the transition sequence that makes 'speech-start' legal
  // again.
  it('rejects new speech-start while a held turn keeps the session transcribing until the turn is dropped', () => {
    const store = startStore()

    store.dispatch({ type: 'speech-start', turnId: 'turn-duplicate', at: 1010 })
    store.dispatch({ type: 'speech-end', turnId: 'turn-duplicate', at: 1020 })
    expect(store.state).toBe('transcribing')
    expect(store.isCurrentTurn('turn-duplicate')).toBe(true)

    // Stuck precondition: while the held turn keeps the machine transcribing,
    // no new turn can begin, mirroring the frozen microphone loop.
    const rejected = store.dispatch({ type: 'speech-start', turnId: 'turn-next', at: 1030 })
    expect(rejected?.state).toBe('transcribing')
    expect(store.state).toBe('transcribing')
    expect(store.activeTurnId).toBe('turn-duplicate')
    expect(store.lastTransitionError?.code).toBe('illegal_transition')
    expect(store.lastTransitionError?.event).toBe('speech-start')

    // Release path used by the page fix: drop the held turn, re-open listening.
    store.stop('unknown', 1040)
    expect(store.state).toBe('stopped')
    expect(store.activeTurnId).toBeUndefined()

    store.start({
      sessionId: 'voice-session-2',
      mode: 'vad-turn-taking',
      listeningImmediately: true,
      now: 1050,
    })
    const accepted = store.dispatch({ type: 'speech-start', turnId: 'turn-next', at: 1060 })
    expect(accepted?.state).toBe('speech-detected')
    expect(store.isCurrentTurn('turn-next')).toBe(true)
    expect(store.lastTransitionError).toBeNull()
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // In apps/stage-tamagotchi/src/renderer/pages/index.vue,
  // `retryVoiceRecoveryDraft` dispatched { type: 'chat-retry' } and discarded
  // the result. When the draft's turn was no longer the active voice turn
  // (a provider switch while the draft was pending replaces the failed
  // session with a fresh listening one), the transition is rejected with
  // `stale_turn` — but `dispatch` still returns the current (old) session
  // object, so the page proceeded with requestIngest/requestRetry as if the
  // voice turn were re-attached, leaving voice session state and UI
  // correlation broken.
  //
  // We fixed this by checking `lastTransitionError` (and a null session)
  // after the dispatch and degrading to an uncorrelated retry. This test pins
  // the store contract the fix relies on: a rejected `chat-retry` returns a
  // non-null unchanged session, so callers must consult `lastTransitionError`
  // to detect the failure.
  it('keeps the session unchanged and surfaces stale_turn when chat-retry targets a detached turn', () => {
    const store = startStore()

    store.dispatch({ type: 'speech-start', turnId: 'turn-1', at: 1010 })
    store.dispatch({ type: 'speech-end', turnId: 'turn-1', at: 1020 })
    store.dispatch({ type: 'asr-final', turnId: 'turn-1', at: 1030 })
    store.dispatch({ type: 'chat-ingested', turnId: 'turn-1', at: 1040 })
    store.dispatch({ type: 'fail', code: 'chat_error', reason: 'chat-error', at: 1050 })
    expect(store.state).toBe('failed')
    expect(store.activeTurnId).toBe('turn-1')

    // A provider switch while the session is 'failed' does not stop it (the
    // session is not active), so the turn detaches only when the page
    // replaces the session with a fresh listening one afterwards
    // (`startVoiceListeningSession` -> `replaceVoiceConversationSession`).
    store.applyProviderSwitch({
      inputProviderId: 'asr-provider-2',
      outputProviderId: 'tts-provider-2',
      voiceId: 'voice-2',
      now: 1060,
    })
    expect(store.state).toBe('failed')
    expect(store.activeTurnId).toBe('turn-1')

    store.start({
      sessionId: 'voice-session-2',
      mode: 'vad-turn-taking',
      listeningImmediately: true,
      now: 1070,
    })
    expect(store.activeTurnId).toBeUndefined()

    const result = store.dispatch({ type: 'chat-retry', turnId: 'turn-1', at: 1080 })
    expect(result).not.toBeNull()
    expect(result).toBe(store.session)
    expect(store.state).toBe('listening')
    expect(store.activeTurnId).toBeUndefined()
    expect(store.lastTransitionError?.code).toBe('stale_turn')
    expect(store.lastTransitionError?.event).toBe('chat-retry')
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
