import { describe, expect, it } from 'vitest'

import {
  createVoicePlaybackEchoGateState,
  isVoicePlaybackEchoBlocked,
  releaseVoicePlaybackEchoGateForUserInterrupt,
  updateVoicePlaybackEchoGate,
  voicePlaybackEchoBlockRemainingMs,
} from './echo-gate'

describe('voice playback echo gate', () => {
  it('blocks on audible playback even when the voice turn is not marked speaking yet', () => {
    const state = updateVoicePlaybackEchoGate(createVoicePlaybackEchoGateState(), {
      audiblePlayback: true,
      voiceConversationState: 'listening',
      at: 1000,
    })

    expect(isVoicePlaybackEchoBlocked(state, 1000)).toBe(true)
  })

  it('stays blocked across silent gaps between TTS chunks while the response is active', () => {
    const audible = updateVoicePlaybackEchoGate(createVoicePlaybackEchoGateState(), {
      audiblePlayback: true,
      voiceConversationState: 'speaking',
      at: 1000,
    })
    const betweenChunks = updateVoicePlaybackEchoGate(audible, {
      audiblePlayback: false,
      voiceConversationState: 'speaking',
      at: 1400,
    })

    expect(isVoicePlaybackEchoBlocked(betweenChunks, 5000)).toBe(true)
  })

  it('keeps a bounded tail after the final audible playback ends', () => {
    const active = updateVoicePlaybackEchoGate(createVoicePlaybackEchoGateState(), {
      audiblePlayback: true,
      voiceConversationState: 'speaking',
      at: 1000,
    })
    const released = updateVoicePlaybackEchoGate(active, {
      audiblePlayback: false,
      voiceConversationState: 'listening',
      at: 2000,
      tailMs: 800,
    })

    expect(isVoicePlaybackEchoBlocked(released, 2799)).toBe(true)
    expect(voicePlaybackEchoBlockRemainingMs(released, 2500)).toBe(300)
    expect(isVoicePlaybackEchoBlocked(released, 2800)).toBe(false)
  })

  it('does not add an echo tail before playback has ever become active', () => {
    const state = updateVoicePlaybackEchoGate(createVoicePlaybackEchoGateState(), {
      audiblePlayback: false,
      voiceConversationState: 'listening',
      at: 1000,
    })

    expect(isVoicePlaybackEchoBlocked(state, 1000)).toBe(false)
    expect(voicePlaybackEchoBlockRemainingMs(state, 1000)).toBe(0)
  })

  it('allows an explicit user interrupt to start a replacement turn without waiting for the echo tail', () => {
    const blocked = updateVoicePlaybackEchoGate({
      audiblePlayback: true,
      assistantResponseActive: true,
      blockedUntil: 0,
    }, {
      audiblePlayback: false,
      voiceConversationState: 'listening',
      at: 2_000,
      tailMs: 800,
    })

    expect(isVoicePlaybackEchoBlocked(blocked, 2_000)).toBe(true)
    expect(isVoicePlaybackEchoBlocked(releaseVoicePlaybackEchoGateForUserInterrupt(), 2_000)).toBe(false)
  })
})
