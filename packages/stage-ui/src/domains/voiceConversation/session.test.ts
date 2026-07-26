import { describe, expect, it } from 'vitest'

import {
  createVoiceConversationSession,
  isVoiceConversationTransitionAllowed,
  legalVoiceConversationEvents,
  transitionVoiceConversationSession,
} from './session'

function createSession() {
  return createVoiceConversationSession({
    sessionId: 'voice-session-1',
    mode: 'vad-turn-taking',
    inputProviderId: 'asr-provider',
    inputModelId: 'asr-model',
    outputProviderId: 'tts-provider',
    outputModelId: 'tts-model',
    voiceId: 'voice-1',
    now: 1000,
  })
}

function apply(
  session: ReturnType<typeof createSession>,
  ...events: Parameters<typeof transitionVoiceConversationSession>[1][]
) {
  let current = session
  for (const event of events) {
    const result = transitionVoiceConversationSession(current, event)
    expect(result.ok).toBe(true)
    if (!result.ok)
      throw new Error(result.error.reason)
    current = result.session
  }
  return current
}

describe('voice conversation session state machine', () => {
  it('runs the normal microphone turn lifecycle and clears active turn after playback', () => {
    const session = apply(
      createSession(),
      { type: 'request-permission', at: 1010 },
      { type: 'permission-granted', at: 1020 },
      { type: 'speech-start', turnId: 'turn-1', at: 1030 },
      { type: 'speech-end', turnId: 'turn-1', at: 1040 },
      { type: 'asr-final', turnId: 'turn-1', at: 1050 },
      { type: 'chat-ingested', turnId: 'turn-1', at: 1060 },
      { type: 'llm-first-token', turnId: 'turn-1', at: 1070 },
      { type: 'playback-started', turnId: 'turn-1', at: 1080 },
      { type: 'playback-completed', turnId: 'turn-1', at: 1090 },
    )

    expect(session.state).toBe('listening')
    expect(session.activeTurnId).toBeUndefined()
    expect(session.updatedAt).toBe(1090)
    expect(session.inputProviderId).toBe('asr-provider')
    expect(session.outputProviderId).toBe('tts-provider')
  })

  it('rejects illegal transitions with a stable actionable error', () => {
    const result = transitionVoiceConversationSession(createSession(), {
      type: 'asr-final',
      turnId: 'turn-1',
      at: 1010,
    })

    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('expected transition failure')

    expect(result.session.state).toBe('idle')
    expect(result.error).toEqual({
      code: 'stale_turn',
      from: 'idle',
      event: 'asr-final',
      reason: 'Turn "turn-1" is not the active voice turn.',
      suggestion: 'Drop this event and keep the current voice session unchanged.',
    })
  })

  it('guards stale ASR and playback events from old turns', () => {
    const session = apply(
      createSession(),
      { type: 'start-listening', at: 1010 },
      { type: 'speech-start', turnId: 'turn-active', at: 1020 },
      { type: 'speech-end', turnId: 'turn-active', at: 1030 },
    )

    const stale = transitionVoiceConversationSession(session, {
      type: 'asr-final',
      turnId: 'turn-old',
      at: 1040,
    })

    expect(stale.ok).toBe(false)
    if (stale.ok)
      throw new Error('expected stale turn failure')

    expect(stale.session).toBe(session)
    expect(stale.error.code).toBe('stale_turn')
    expect(stale.error.suggestion).toContain('Drop this event')
  })

  it('marks interruption and resumes listening only through an explicit ready event', () => {
    const speaking = apply(
      createSession(),
      { type: 'start-listening', at: 1010 },
      { type: 'speech-start', turnId: 'turn-1', at: 1020 },
      { type: 'speech-end', turnId: 'turn-1', at: 1030 },
      { type: 'asr-final', turnId: 'turn-1', at: 1040 },
      { type: 'chat-ingested', turnId: 'turn-1', at: 1050 },
      { type: 'playback-started', turnId: 'turn-1', at: 1060 },
    )

    const interruptedResult = transitionVoiceConversationSession(speaking, {
      type: 'interrupt',
      reason: 'user-interrupt',
      at: 1070,
    })

    expect(interruptedResult.ok).toBe(true)
    if (!interruptedResult.ok)
      throw new Error(interruptedResult.error.reason)

    expect(interruptedResult.session.state).toBe('interrupted')
    expect(interruptedResult.session.activeTurnId).toBeUndefined()
    expect(interruptedResult.session.lastCancelReason).toBe('user-interrupt')

    const resumed = transitionVoiceConversationSession(interruptedResult.session, {
      type: 'interruption-ready',
      at: 1080,
    })

    expect(resumed.ok).toBe(true)
    if (!resumed.ok)
      throw new Error(resumed.error.reason)

    expect(resumed.session.state).toBe('listening')
  })

  it('keeps speaking state for late telemetry-only events', () => {
    const speaking = apply(
      createSession(),
      { type: 'start-listening', at: 1010 },
      { type: 'speech-start', turnId: 'turn-1', at: 1020 },
      { type: 'speech-end', turnId: 'turn-1', at: 1030 },
      { type: 'asr-final', turnId: 'turn-1', at: 1040 },
      { type: 'chat-ingested', turnId: 'turn-1', at: 1050 },
      { type: 'llm-first-token', turnId: 'turn-1', at: 1060 },
      { type: 'playback-started', turnId: 'turn-1', at: 1070 },
      { type: 'llm-completed', turnId: 'turn-1', at: 1080 },
      { type: 'tts-first-audio', turnId: 'turn-1', at: 1090 },
    )

    expect(speaking.state).toBe('speaking')
    expect(speaking.activeTurnId).toBe('turn-1')
  })

  it('stops and resets without carrying active turn or terminal errors forward', () => {
    const transcribing = apply(
      createSession(),
      { type: 'start-listening', at: 1010 },
      { type: 'speech-start', turnId: 'turn-1', at: 1020 },
      { type: 'speech-end', turnId: 'turn-1', at: 1030 },
    )

    const stopped = transitionVoiceConversationSession(transcribing, {
      type: 'stop',
      reason: 'page-dispose',
      at: 1040,
    })

    expect(stopped.ok).toBe(true)
    if (!stopped.ok)
      throw new Error(stopped.error.reason)

    expect(stopped.session.state).toBe('stopped')
    expect(stopped.session.activeTurnId).toBeUndefined()
    expect(stopped.session.lastCancelReason).toBe('page-dispose')

    const reset = transitionVoiceConversationSession(stopped.session, {
      type: 'reset',
      at: 1050,
    })

    expect(reset.ok).toBe(true)
    if (!reset.ok)
      throw new Error(reset.error.reason)

    expect(reset.session.state).toBe('idle')
    expect(reset.session.lastCancelReason).toBeUndefined()
    expect(reset.session.lastErrorCode).toBeUndefined()
  })

  it('exposes legal transition introspection for UI and store guards', () => {
    expect(isVoiceConversationTransitionAllowed('speaking', 'interrupt')).toBe(true)
    expect(isVoiceConversationTransitionAllowed('speaking', 'asr-final')).toBe(false)
    expect(legalVoiceConversationEvents('requesting-permission')).toEqual([
      'permission-granted',
      'permission-denied',
      'permission-revoked',
      'fail',
      'stop',
      'reset',
    ])
  })

  it('keeps timestamps monotonic when a platform callback arrives with an older clock value', () => {
    const session = apply(
      createSession(),
      { type: 'request-permission', at: 1200 },
      { type: 'permission-granted', at: 1100 },
    )

    expect(session.state).toBe('listening')
    expect(session.updatedAt).toBe(1200)
  })

  it('fails an active session when microphone permission is revoked', () => {
    const session = apply(
      createSession(),
      { type: 'request-permission', at: 1010 },
      { type: 'permission-granted', at: 1020 },
      { type: 'permission-revoked', at: 1030 },
    )

    expect(session.state).toBe('failed')
    expect(session.lastErrorCode).toBe('permission_denied')
    expect(session.lastCancelReason).toBe('permission-denied')
  })

  it('keeps turn correlation across a recoverable chat failure and retry', () => {
    const failed = apply(
      createSession(),
      { type: 'start-listening', at: 1010 },
      { type: 'speech-start', turnId: 'turn-1', at: 1020 },
      { type: 'speech-end', turnId: 'turn-1', at: 1030 },
      { type: 'asr-final', turnId: 'turn-1', at: 1040 },
      { type: 'chat-ingested', turnId: 'turn-1', at: 1050 },
      { type: 'fail', code: 'chat_error', reason: 'chat-error', at: 1060 },
    )

    expect(failed.state).toBe('failed')
    expect(failed.activeTurnId).toBe('turn-1')

    const retrying = transitionVoiceConversationSession(failed, {
      type: 'chat-retry',
      turnId: 'turn-1',
      at: 1070,
    })
    expect(retrying.ok).toBe(true)
    if (!retrying.ok)
      throw new Error(retrying.error.reason)

    expect(retrying.session).toMatchObject({
      state: 'thinking',
      activeTurnId: 'turn-1',
      lastErrorCode: undefined,
      lastCancelReason: undefined,
    })
  })
})
