import { describe, expect, it } from 'vitest'

import {
  defaultVoiceConversationPreferences,
  migrateVoiceConversationPreferencesV1,
  normalizeVoiceConversationPreferences,
} from './preferences'

describe('voice conversation preferences', () => {
  it('uses low-latency defaults', () => {
    expect(normalizeVoiceConversationPreferences(undefined)).toEqual(defaultVoiceConversationPreferences)
    expect(defaultVoiceConversationPreferences.interruptionPolicy).toBe('pushToInterrupt')
    expect(defaultVoiceConversationPreferences.trailingSilenceMs).toBe(800)
    expect(defaultVoiceConversationPreferences.cloudPrivacyAcknowledged).toBe(false)
  })

  it('migrates only a complete legacy default profile', () => {
    expect(migrateVoiceConversationPreferencesV1({
      mode: 'streaming-asr',
      interruptionPolicy: 'disabled',
      vadThreshold: 0.6,
      minSpeechDurationMs: 250,
      trailingSilenceMs: 1_600,
      cloudPrivacyAcknowledged: false,
    })).toEqual({
      mode: 'streaming-asr',
      interruptionPolicy: 'pushToInterrupt',
      vadThreshold: 0.6,
      minSpeechDurationMs: 250,
      trailingSilenceMs: 800,
      cloudPrivacyAcknowledged: false,
    })

    expect(migrateVoiceConversationPreferencesV1({ trailingSilenceMs: 1_600 }).trailingSilenceMs).toBe(1_600)
    expect(migrateVoiceConversationPreferencesV1({
      mode: 'vad-turn-taking',
      interruptionPolicy: 'pushToInterrupt',
      vadThreshold: 0.7,
      minSpeechDurationMs: 300,
      trailingSilenceMs: 800,
      cloudPrivacyAcknowledged: true,
    })).toMatchObject({
      mode: 'vad-turn-taking',
      interruptionPolicy: 'pushToInterrupt',
      trailingSilenceMs: 800,
      cloudPrivacyAcknowledged: true,
    })
  })

  it('keeps safe enums and clamps numeric values', () => {
    expect(normalizeVoiceConversationPreferences({
      mode: 'streaming-asr',
      interruptionPolicy: 'vadBargeIn',
      vadThreshold: 10,
      minSpeechDurationMs: -1,
      trailingSilenceMs: 9_000,
      cloudPrivacyAcknowledged: true,
    })).toEqual({
      mode: 'streaming-asr',
      interruptionPolicy: 'vadBargeIn',
      vadThreshold: 0.9,
      minSpeechDurationMs: 100,
      trailingSilenceMs: 3_000,
      cloudPrivacyAcknowledged: true,
    })
  })

  it('rejects tampered persisted enum and numeric values', () => {
    expect(normalizeVoiceConversationPreferences({
      mode: 'always-upload' as never,
      interruptionPolicy: 'always-listen' as never,
      vadThreshold: Number.NaN,
      minSpeechDurationMs: Number.POSITIVE_INFINITY,
    })).toEqual(defaultVoiceConversationPreferences)
  })
})
