import type { VoiceConversationMode, VoiceInterruptionPolicy } from './session'

export interface VoiceConversationPreferences {
  mode: VoiceConversationMode
  interruptionPolicy: VoiceInterruptionPolicy
  vadThreshold: number
  minSpeechDurationMs: number
  trailingSilenceMs: number
  cloudPrivacyAcknowledged: boolean
}

export const voiceConversationPreferenceBounds = {
  vadThreshold: { min: 0.1, max: 0.9 },
  minSpeechDurationMs: { min: 100, max: 3_000 },
  trailingSilenceMs: { min: 200, max: 3_000 },
} as const

export const defaultVoiceConversationPreferences: Readonly<VoiceConversationPreferences> = Object.freeze({
  mode: 'streaming-asr',
  interruptionPolicy: 'disabled',
  vadThreshold: 0.6,
  minSpeechDurationMs: 250,
  trailingSilenceMs: 1_600,
  cloudPrivacyAcknowledged: false,
})

const legacyDefaultTrailingSilenceMs = 800

const modes = new Set<VoiceConversationMode>(['push-to-talk', 'vad-turn-taking', 'streaming-asr'])
const interruptionPolicies = new Set<VoiceInterruptionPolicy>(['disabled', 'pushToInterrupt', 'vadBargeIn'])

export function normalizeVoiceConversationPreferences(
  value: Partial<VoiceConversationPreferences> | null | undefined,
): VoiceConversationPreferences {
  return {
    mode: modes.has(value?.mode as VoiceConversationMode)
      ? value!.mode as VoiceConversationMode
      : defaultVoiceConversationPreferences.mode,
    interruptionPolicy: interruptionPolicies.has(value?.interruptionPolicy as VoiceInterruptionPolicy)
      ? value!.interruptionPolicy as VoiceInterruptionPolicy
      : defaultVoiceConversationPreferences.interruptionPolicy,
    vadThreshold: clampNumber(value?.vadThreshold, voiceConversationPreferenceBounds.vadThreshold, defaultVoiceConversationPreferences.vadThreshold),
    minSpeechDurationMs: clampNumber(value?.minSpeechDurationMs, voiceConversationPreferenceBounds.minSpeechDurationMs, defaultVoiceConversationPreferences.minSpeechDurationMs),
    trailingSilenceMs: clampNumber(value?.trailingSilenceMs, voiceConversationPreferenceBounds.trailingSilenceMs, defaultVoiceConversationPreferences.trailingSilenceMs),
    cloudPrivacyAcknowledged: value?.cloudPrivacyAcknowledged === true,
  }
}

/**
 * Preserves explicit v1 preferences while moving the old 800 ms VAD default to
 * the safer natural-pause default. A later explicit 800 ms choice in v2 remains
 * untouched because this migration only runs while creating v2 storage.
 */
export function migrateVoiceConversationPreferencesV1(
  value: Partial<VoiceConversationPreferences> | null | undefined,
): VoiceConversationPreferences {
  const normalized = normalizeVoiceConversationPreferences(value)
  return normalized.trailingSilenceMs === legacyDefaultTrailingSilenceMs
    ? { ...normalized, trailingSilenceMs: defaultVoiceConversationPreferences.trailingSilenceMs }
    : normalized
}

function clampNumber(
  value: number | undefined,
  bounds: { min: number, max: number },
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fallback

  return Math.min(bounds.max, Math.max(bounds.min, value))
}
