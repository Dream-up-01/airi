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
  interruptionPolicy: 'pushToInterrupt',
  vadThreshold: 0.6,
  minSpeechDurationMs: 250,
  trailingSilenceMs: 800,
  cloudPrivacyAcknowledged: false,
})

const legacyDefaultVoiceConversationPreferences = Object.freeze({
  mode: 'streaming-asr' as const,
  interruptionPolicy: 'disabled' as const,
  vadThreshold: 0.6,
  minSpeechDurationMs: 250,
  trailingSilenceMs: 1_600,
  cloudPrivacyAcknowledged: false,
})

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
 * Migrates only a complete, known v1 default. Persisted values do not carry a
 * schema-level distinction between an omitted field and an explicit choice, so
 * checking every legacy field prevents a user's explicit 1600 ms tail (or a
 * partially persisted profile) from being rewritten on startup.
 */
export function migrateVoiceConversationPreferencesV1(
  value: Partial<VoiceConversationPreferences> | null | undefined,
): VoiceConversationPreferences {
  const normalized = normalizeVoiceConversationPreferences(value)
  if (!isCompleteLegacyDefault(value))
    return normalized

  return {
    ...normalized,
    interruptionPolicy: defaultVoiceConversationPreferences.interruptionPolicy,
    trailingSilenceMs: defaultVoiceConversationPreferences.trailingSilenceMs,
  }
}

function isCompleteLegacyDefault(value: Partial<VoiceConversationPreferences> | null | undefined): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false

  const candidate = value as Record<string, unknown>
  return candidate.mode === legacyDefaultVoiceConversationPreferences.mode
    && candidate.interruptionPolicy === legacyDefaultVoiceConversationPreferences.interruptionPolicy
    && candidate.vadThreshold === legacyDefaultVoiceConversationPreferences.vadThreshold
    && candidate.minSpeechDurationMs === legacyDefaultVoiceConversationPreferences.minSpeechDurationMs
    && candidate.trailingSilenceMs === legacyDefaultVoiceConversationPreferences.trailingSilenceMs
    && candidate.cloudPrivacyAcknowledged === legacyDefaultVoiceConversationPreferences.cloudPrivacyAcknowledged
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
