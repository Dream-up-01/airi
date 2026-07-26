import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useVoiceStyleRuntimeStore } from './voiceStyleRuntime'

describe('voice style runtime store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps policy and resolution runtime-only and correlated by turn', () => {
    const store = useVoiceStyleRuntimeStore()
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-1',
      policy: { risk: 'none', scenario: 'casual' },
    })
    expect(store.policyForSegment({ turnId: 'turn-1', sessionId: 'session-1' })).toEqual({ risk: 'none', scenario: 'casual' })

    store.publishResolution({
      sessionId: 'session-1',
      turnId: 'turn-1',
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      directive: { style: 'warm' },
      warnings: [],
      resolvedAt: 10,
    })
    expect(store.latestResolution?.directive.style).toBe('warm')

    store.clearTurn('turn-1')
    expect(store.policyForSegment({ turnId: 'turn-1', sessionId: undefined })).toBeUndefined()
    expect(store.latestResolution?.directive.style).toBe('warm')

    store.clear()
    expect(store.latestResolution).toBeUndefined()
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // chat.ts only captured the companion turn policy when
  // `voiceSession.activeTurnId` existed at prompt-composition time. When the
  // policy was evaluated between voice turns (interrupt/stop clears
  // activeTurnId), no policy was stored at all, Stage.vue then resolved
  // `policy: undefined`, and deriveVoiceStyleDirective defaulted to risk
  // 'none' — the crisis prosody clamp failed open.
  //
  // We fixed this by adding a session-scoped policy map
  // (captureSessionPolicy/policyForSegment) that chat.ts fills whenever a
  // voice session exists, so Stage.vue can fall back to it when the
  // turn-scoped policy is missing.
  it('keeps a session-scoped policy as fallback when no turn policy was captured', () => {
    const store = useVoiceStyleRuntimeStore()

    store.captureSessionPolicy({
      sessionId: 'session-1',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })

    expect(store.policyForSegment({ turnId: 'turn-unknown', sessionId: undefined })).toBeUndefined()
    expect(store.policyForSegment({ turnId: 'turn-unknown', sessionId: 'session-1' })).toEqual({ risk: 'crisis', scenario: 'crisis' })
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-1' })).toEqual({ risk: 'crisis', scenario: 'crisis' })
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-2' })).toBeUndefined()
    expect(store.policyForSegment({ turnId: undefined, sessionId: undefined })).toBeUndefined()
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // Stage.vue looked the session-scoped fallback up with the *live*
  // `voiceConversationStore.session.sessionId` while the `turnId` it passed
  // alongside was the snapshot taken when the segment's TTS intent opened:
  //
  //   policy: voiceStyleRuntimeStore.policyForTurn(turnId)
  //     ?? voiceStyleRuntimeStore.policyForSession(voiceSession.sessionId),
  //
  // `replaceVoiceConversationSession`
  // (apps/stage-tamagotchi/src/renderer/pages/index.vue) calls
  // `voiceConversationStore.start` with a freshly minted session id every time
  // listening restarts. Segments enqueued under the previous session were
  // still synthesizing at that point, so the fallback was read under a key
  // that had never been captured, `deriveVoiceStyleDirective` received
  // `policy: undefined` and defaulted to risk 'none' — the crisis
  // slow/quiet clamp was dropped for exactly those segments.
  //
  // We fixed this by snapshotting the voice session id next to the turn id
  // (`CapturedSpeechOutputProfile.voiceSessionId` in Stage.vue) and moving the
  // turn-then-session lookup into this store as `policyForSegment`, which only
  // ever reads the ids the segment itself originated from.
  it('resolves a queued segment against its own session after the live session rotated', () => {
    const store = useVoiceStyleRuntimeStore()

    store.captureSessionPolicy({
      sessionId: 'voice-session-1',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })

    // Listening restarted: a new session exists and nothing was captured for
    // it yet, but the still-queued segment belongs to `voice-session-1`.
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'voice-session-2' })).toBeUndefined()
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'voice-session-1' })).toEqual({
      risk: 'crisis',
      scenario: 'crisis',
    })
  })

  it('prefers the turn policy over the session policy of the same segment', () => {
    const store = useVoiceStyleRuntimeStore()

    store.captureSessionPolicy({
      sessionId: 'session-1',
      policy: { risk: 'none', scenario: 'casual' },
    })
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-1',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })

    expect(store.policyForSegment({ turnId: 'turn-1', sessionId: 'session-1' })).toEqual({
      risk: 'crisis',
      scenario: 'crisis',
    })
  })

  it('clearTurn keeps session policies while clear wipes both maps', () => {
    const store = useVoiceStyleRuntimeStore()
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-1',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })
    store.captureSessionPolicy({
      sessionId: 'session-1',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })

    store.clearTurn('turn-1')
    expect(store.policyForSegment({ turnId: 'turn-1', sessionId: undefined })).toBeUndefined()
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-1' })).toEqual({ risk: 'crisis', scenario: 'crisis' })

    store.clear()
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-1' })).toBeUndefined()
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // Interrupted voice turns never reach `playback-completed`, so their
  // policies were never cleared through `clearTurn` and the map grew for the
  // whole renderer lifetime.
  //
  // We fixed this by evicting the oldest entries beyond a retention cap of
  // 16 in both the turn-scoped and session-scoped policy maps.
  it('evicts the oldest turn policy beyond the retention cap', () => {
    const store = useVoiceStyleRuntimeStore()

    for (let index = 0; index < 17; index += 1) {
      store.capturePolicy({
        sessionId: 'session-1',
        turnId: `turn-${index}`,
        policy: { risk: 'none', scenario: 'casual' },
      })
    }

    expect(store.policyForSegment({ turnId: 'turn-0', sessionId: undefined })).toBeUndefined()
    expect(store.policyForSegment({ turnId: 'turn-1', sessionId: undefined })).toEqual({ risk: 'none', scenario: 'casual' })
    expect(store.policyForSegment({ turnId: 'turn-16', sessionId: undefined })).toEqual({ risk: 'none', scenario: 'casual' })
  })

  it('evicts the oldest session policy beyond the retention cap', () => {
    const store = useVoiceStyleRuntimeStore()

    for (let index = 0; index < 17; index += 1) {
      store.captureSessionPolicy({
        sessionId: `session-${index}`,
        policy: { risk: 'none', scenario: 'casual' },
      })
    }

    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-0' })).toBeUndefined()
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-1' })).toEqual({ risk: 'none', scenario: 'casual' })
    expect(store.policyForSegment({ turnId: undefined, sessionId: 'session-16' })).toEqual({ risk: 'none', scenario: 'casual' })
  })

  it('refreshes recapture order so an updated turn policy is not evicted early', () => {
    const store = useVoiceStyleRuntimeStore()

    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-crisis',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })
    for (let index = 0; index < 15; index += 1) {
      store.capturePolicy({
        sessionId: 'session-1',
        turnId: `turn-${index}`,
        policy: { risk: 'none', scenario: 'casual' },
      })
    }
    // Re-capturing must move the entry to the newest position...
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-crisis',
      policy: { risk: 'crisis', scenario: 'crisis' },
    })
    // ...so one more insert evicts `turn-0` (the oldest) instead.
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-extra',
      policy: { risk: 'none', scenario: 'casual' },
    })

    expect(store.policyForSegment({ turnId: 'turn-crisis', sessionId: undefined })).toEqual({ risk: 'crisis', scenario: 'crisis' })
    expect(store.policyForSegment({ turnId: 'turn-0', sessionId: undefined })).toBeUndefined()
  })
})
