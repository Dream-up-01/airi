import { describe, expect, it } from 'vitest'

import { createVoiceConversationSession } from './session'
import {
  createVoiceSessionStartTimelineEntry,
  createVoiceTimelineEntry,
  isVoiceTimelineMonotonic,
  voiceTimelineNameForEvent,
} from './timeline'

function createSession() {
  return createVoiceConversationSession({
    sessionId: 'voice-session-1',
    mode: 'streaming-asr',
    inputProviderId: 'asr-provider',
    inputModelId: 'asr-model',
    outputProviderId: 'tts-provider',
    outputModelId: 'tts-model',
    voiceId: 'voice-1',
    now: 1000,
  })
}

describe('voice conversation timeline', () => {
  it('creates privacy-safe session and event timeline entries', () => {
    const session = createSession()
    const sessionEntry = createVoiceSessionStartTimelineEntry(session)
    const asrEntry = createVoiceTimelineEntry(session, {
      type: 'asr-final',
      turnId: 'turn-1',
      at: 1200,
    }, {
      textLength: 8,
    })

    expect(sessionEntry).toMatchObject({
      name: 'voice.session.start',
      sessionId: 'voice-session-1',
      at: 1000,
      mode: 'streaming-asr',
      inputProviderId: 'asr-provider',
      outputProviderId: 'tts-provider',
      voiceId: 'voice-1',
    })
    expect(asrEntry).toMatchObject({
      name: 'voice.asr.final',
      sessionId: 'voice-session-1',
      turnId: 'turn-1',
      at: 1200,
      textLength: 8,
    })
    expect(JSON.stringify(asrEntry)).not.toContain('你好')
  })

  it('maps state-machine events to stable metric names', () => {
    expect(voiceTimelineNameForEvent({ type: 'vad-started' })).toBe('voice.vad.started')
    expect(voiceTimelineNameForEvent({ type: 'asr-first-partial', turnId: 'turn-1' })).toBe('voice.asr.first_partial')
    expect(voiceTimelineNameForEvent({ type: 'llm-first-token', turnId: 'turn-1' })).toBe('voice.llm.first_token')
    expect(voiceTimelineNameForEvent({ type: 'tts-first-request', turnId: 'turn-1' })).toBe('voice.tts.first_request')
    expect(voiceTimelineNameForEvent({ type: 'tts-first-audio', turnId: 'turn-1' })).toBe('voice.tts.first_audio')
    expect(voiceTimelineNameForEvent({ type: 'playback-completed', turnId: 'turn-1' })).toBe('voice.playback.completed')
  })

  it('omits secrets, URLs, and local paths from provider metadata', () => {
    const session = createVoiceConversationSession({
      sessionId: 'voice-session-private',
      mode: 'streaming-asr',
      inputProviderId: 'https://private.example.test',
      inputModelId: 'C:\\Users\\private\\model.bin',
      outputProviderId: 'minimax-speech',
      outputModelId: 'speech-2.8-turbo',
      voiceId: 'sk-private-secret-value',
      now: 1000,
    })

    expect(createVoiceSessionStartTimelineEntry(session)).toMatchObject({
      inputProviderId: undefined,
      inputModelId: undefined,
      outputProviderId: 'minimax-speech',
      outputModelId: 'speech-2.8-turbo',
      voiceId: undefined,
    })
  })

  it('checks monotonic event ordering without requiring wall-clock duration math', () => {
    const session = createSession()
    expect(isVoiceTimelineMonotonic([
      createVoiceSessionStartTimelineEntry(session),
      createVoiceTimelineEntry(session, { type: 'asr-start', turnId: 'turn-1', at: 1010 })!,
      createVoiceTimelineEntry(session, { type: 'asr-final', turnId: 'turn-1', at: 1020 })!,
    ])).toBe(true)

    expect(isVoiceTimelineMonotonic([
      createVoiceTimelineEntry(session, { type: 'asr-final', turnId: 'turn-1', at: 1020 })!,
      createVoiceTimelineEntry(session, { type: 'asr-start', turnId: 'turn-1', at: 1010 })!,
    ])).toBe(false)
  })
})
