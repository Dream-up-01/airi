import type { VoiceConversationErrorCode } from './session'
import type { VoiceStyleWarningCode } from './style'

export type VoiceTtsCapabilityProfile = 'streaming' | 'rest-aggregated' | 'not-declared'

export interface VoiceConversationDiagnosticsSnapshot {
  inputProviderId?: string
  inputModelId?: string
  inputSupportsStreaming: boolean
  outputProviderId?: string
  outputModelId?: string
  voiceId?: string
  ttsCapability: VoiceTtsCapabilityProfile
  lastErrorCode?: VoiceConversationErrorCode
  asrFirstPartialLatencyMs?: number
  ttsFirstAudioLatencyMs?: number
  styleWarningCodes: VoiceStyleWarningCode[]
  updatedAt: number
}

const errorCodes = new Set<VoiceConversationErrorCode>([
  'illegal_transition',
  'stale_turn',
  'hearing_not_configured',
  'chat_not_configured',
  'speech_not_configured',
  'cloud_tts_privacy_not_acknowledged',
  'permission_denied',
  'asr_error',
  'chat_error',
  'tts_error',
  'playback_error',
  'unknown',
])
const styleWarningCodes = new Set<VoiceStyleWarningCode>([
  'voice-style.unsupported-style',
  'voice-style.unsupported-prosody',
  'voice-style.clamped-rate',
  'voice-style.clamped-pitch',
  'voice-style.clamped-volume',
  'voice-style.unsafe-preferred-style',
])
const ttsCapabilities = new Set<VoiceTtsCapabilityProfile>(['streaming', 'rest-aggregated', 'not-declared'])

function safeConfigurationId(value: unknown, maxLength = 128) {
  if (typeof value !== 'string')
    return undefined

  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  const containsCredentialMarker = /\b(?:api[_-]?key|authorization|bearer|password|secret|token)\b/i.test(normalized)
  const containsTokenLikeValue = /\b(?:ak|sk)-[\w-]{8,}\b/i.test(normalized)
  const containsUrl = /\b(?:file|https?):\/\//i.test(normalized)
  const containsLocalPath = /^[a-z]:[\\/]/i.test(normalized)
    || normalized.startsWith('\\\\')
    || /^\/(?:home|users?|var|tmp|opt|etc)\//i.test(normalized)
    || /^~[\\/]/.test(normalized)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(normalized)
  if (!normalized
    || normalized.length > maxLength
    || hasControlCharacter
    || containsCredentialMarker
    || containsTokenLikeValue
    || containsUrl
    || containsLocalPath) {
    return undefined
  }
  return normalized
}

function safeLatency(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600_000)
    return undefined
  return Math.round(value)
}

export function normalizeVoiceConversationDiagnosticsSnapshot(
  value: unknown,
): VoiceConversationDiagnosticsSnapshot | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const candidate = value as Record<string, unknown>
  if (typeof candidate.inputSupportsStreaming !== 'boolean'
    || typeof candidate.updatedAt !== 'number'
    || !Number.isFinite(candidate.updatedAt)
    || !ttsCapabilities.has(candidate.ttsCapability as VoiceTtsCapabilityProfile)) {
    return undefined
  }

  const lastErrorCode = errorCodes.has(candidate.lastErrorCode as VoiceConversationErrorCode)
    ? candidate.lastErrorCode as VoiceConversationErrorCode
    : undefined
  const warnings = Array.isArray(candidate.styleWarningCodes)
    ? [...new Set(candidate.styleWarningCodes.filter((code): code is VoiceStyleWarningCode => (
        styleWarningCodes.has(code as VoiceStyleWarningCode)
      )))]
    : []

  return {
    inputProviderId: safeConfigurationId(candidate.inputProviderId),
    inputModelId: safeConfigurationId(candidate.inputModelId),
    inputSupportsStreaming: candidate.inputSupportsStreaming,
    outputProviderId: safeConfigurationId(candidate.outputProviderId),
    outputModelId: safeConfigurationId(candidate.outputModelId),
    voiceId: safeConfigurationId(candidate.voiceId, 256),
    ttsCapability: candidate.ttsCapability as VoiceTtsCapabilityProfile,
    lastErrorCode,
    asrFirstPartialLatencyMs: safeLatency(candidate.asrFirstPartialLatencyMs),
    ttsFirstAudioLatencyMs: safeLatency(candidate.ttsFirstAudioLatencyMs),
    styleWarningCodes: warnings,
    updatedAt: Math.round(candidate.updatedAt),
  }
}
