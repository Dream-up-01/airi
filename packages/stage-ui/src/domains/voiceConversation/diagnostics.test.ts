import { describe, expect, it } from 'vitest'

import { normalizeVoiceConversationDiagnosticsSnapshot } from './diagnostics'

describe('voice conversation diagnostics snapshot', () => {
  it('keeps only bounded configuration identifiers and allowlisted diagnostics', () => {
    expect(normalizeVoiceConversationDiagnosticsSnapshot({
      inputProviderId: 'qwen3-asr-local',
      inputModelId: 'Qwen/Qwen3-ASR-0.6B',
      inputSupportsStreaming: true,
      outputProviderId: 'minimax-speech',
      outputModelId: 'speech-2.8-turbo',
      voiceId: 'AiriFirefly',
      ttsCapability: 'rest-aggregated',
      lastErrorCode: 'tts_error',
      asrFirstPartialLatencyMs: 243.7,
      ttsFirstAudioLatencyMs: 745.1,
      styleWarningCodes: ['voice-style.unsupported-style', 'not-allowed'],
      updatedAt: 42.9,
    })).toEqual({
      inputProviderId: 'qwen3-asr-local',
      inputModelId: 'Qwen/Qwen3-ASR-0.6B',
      inputSupportsStreaming: true,
      outputProviderId: 'minimax-speech',
      outputModelId: 'speech-2.8-turbo',
      voiceId: 'AiriFirefly',
      ttsCapability: 'rest-aggregated',
      lastErrorCode: 'tts_error',
      asrFirstPartialLatencyMs: 244,
      ttsFirstAudioLatencyMs: 745,
      styleWarningCodes: ['voice-style.unsupported-style'],
      updatedAt: 43,
    })
  })

  it('rejects malformed envelopes and drops unsafe optional values', () => {
    expect(normalizeVoiceConversationDiagnosticsSnapshot({})).toBeUndefined()
    expect(normalizeVoiceConversationDiagnosticsSnapshot({
      inputProviderId: 'provider\nsecret',
      inputSupportsStreaming: false,
      ttsCapability: 'rest-aggregated',
      lastErrorCode: 'provider leaked text',
      asrFirstPartialLatencyMs: -1,
      ttsFirstAudioLatencyMs: 700_000,
      styleWarningCodes: [],
      updatedAt: 10,
    })).toMatchObject({
      inputProviderId: undefined,
      lastErrorCode: undefined,
      asrFirstPartialLatencyMs: undefined,
      ttsFirstAudioLatencyMs: undefined,
    })
  })

  it.each([
    'C:\\Users\\example\\voice.bin',
    '\\\\server\\share\\voice.wav',
    '/home/example/models/voice',
    'https://example.invalid/voice',
    'sk-not-a-real-secret-value',
    'authorization bearer credential',
    '../private/voice',
  ])('drops path, URL, and credential-like configuration values: %s', (unsafeValue) => {
    const normalized = normalizeVoiceConversationDiagnosticsSnapshot({
      inputProviderId: unsafeValue,
      inputModelId: unsafeValue,
      inputSupportsStreaming: false,
      outputProviderId: unsafeValue,
      outputModelId: unsafeValue,
      voiceId: unsafeValue,
      ttsCapability: 'rest-aggregated',
      styleWarningCodes: [],
      updatedAt: 10,
    })

    expect(normalized).toMatchObject({
      inputProviderId: undefined,
      inputModelId: undefined,
      outputProviderId: undefined,
      outputModelId: undefined,
      voiceId: undefined,
    })
  })
})
