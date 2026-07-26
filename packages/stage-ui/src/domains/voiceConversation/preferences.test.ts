import { describe, expect, it } from 'vitest'

import {
  defaultVoiceConversationPreferences,
  migrateVoiceConversationPreferencesV1,
  normalizeVoiceConversationPreferences,
} from './preferences'

describe('voice conversation preferences', () => {
  it('uses conservative defaults', () => {
    expect(normalizeVoiceConversationPreferences(undefined)).toEqual(defaultVoiceConversationPreferences)
    expect(defaultVoiceConversationPreferences.interruptionPolicy).toBe('disabled')
    expect(defaultVoiceConversationPreferences.trailingSilenceMs).toBe(1_600)
    expect(defaultVoiceConversationPreferences.cloudPrivacyAcknowledged).toBe(false)
  })

  it('migrates only the legacy VAD tail default while preserving other preferences', () => {
    expect(migrateVoiceConversationPreferencesV1({
      mode: 'vad-turn-taking',
      interruptionPolicy: 'pushToInterrupt',
      vadThreshold: 0.7,
      minSpeechDurationMs: 300,
      trailingSilenceMs: 800,
      cloudPrivacyAcknowledged: true,
    })).toEqual({
      mode: 'vad-turn-taking',
      interruptionPolicy: 'pushToInterrupt',
      vadThreshold: 0.7,
      minSpeechDurationMs: 300,
      trailingSilenceMs: 1_600,
      cloudPrivacyAcknowledged: true,
    })

    expect(migrateVoiceConversationPreferencesV1({ trailingSilenceMs: 1_200 }).trailingSilenceMs).toBe(1_200)
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
