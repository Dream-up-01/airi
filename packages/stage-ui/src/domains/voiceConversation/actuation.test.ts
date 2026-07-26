import { describe, expect, it } from 'vitest'

import { deriveStageActuationIntentLite } from './actuation'
import { createVoiceConversationSession, transitionVoiceConversationSession } from './session'

function sessionIn(state: 'listening' | 'thinking' | 'speaking' | 'interrupted') {
  let session = createVoiceConversationSession({ sessionId: 'session-1', mode: 'streaming-asr', now: 1 })
  const events = state === 'listening'
    ? [{ type: 'start-listening' as const }]
    : state === 'interrupted'
      ? [{ type: 'start-listening' as const }, { type: 'speech-start' as const, turnId: 'turn-1' }, { type: 'interrupt' as const }]
      : [
          { type: 'start-listening' as const },
          { type: 'speech-start' as const, turnId: 'turn-1' },
          { type: 'asr-start' as const, turnId: 'turn-1' },
          { type: 'asr-final' as const, turnId: 'turn-1' },
          { type: 'chat-ingested' as const, turnId: 'turn-1' },
          ...(state === 'speaking' ? [{ type: 'playback-started' as const, turnId: 'turn-1' }] : []),
        ]

  for (const event of events) {
    const result = transitionVoiceConversationSession(session, event)
    if (!result.ok)
      throw new Error(result.error.reason)
    session = result.session
  }
  return session
}

describe('stage actuation intent lite', () => {
  it('maps lifecycle state to bounded stage states', () => {
    expect(deriveStageActuationIntentLite(sessionIn('listening'))).toMatchObject({ state: 'listening', emotion: 'focused' })
    expect(deriveStageActuationIntentLite(sessionIn('thinking'))).toMatchObject({ state: 'thinking', emotion: 'focused', turnId: 'turn-1' })
    expect(deriveStageActuationIntentLite(sessionIn('interrupted'))).toMatchObject({ state: 'interrupted', emotion: 'concerned' })
  })

  it('uses only the allowlisted voice style as a speaking emotion hint', () => {
    expect(deriveStageActuationIntentLite(sessionIn('speaking'), { style: 'playful' })).toMatchObject({
      state: 'speaking',
      emotion: 'happy',
    })
    expect(deriveStageActuationIntentLite(sessionIn('speaking'), { style: 'comforting' })).toMatchObject({
      state: 'speaking',
      emotion: 'comforting',
    })
  })
})
