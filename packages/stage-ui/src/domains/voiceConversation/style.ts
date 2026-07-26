import type { CompanionRiskLevel, CompanionScenario, ConversationPolicyResult } from '../companion/policy'
import type { VoiceConversationMode, VoiceStyleDirective } from './session'

export type VoiceStyleWarningCode
  = | 'voice-style.unsupported-style'
    | 'voice-style.unsupported-prosody'
    | 'voice-style.clamped-rate'
    | 'voice-style.clamped-pitch'
    | 'voice-style.clamped-volume'
    | 'voice-style.unsafe-preferred-style'

export interface VoiceStyleWarning {
  code: VoiceStyleWarningCode
  message: string
}

export interface VoiceProviderStyleCapabilities {
  supportsStyle?: boolean
  supportsProsody?: boolean
  rate?: { min: number, max: number }
  pitchShift?: { min: number, max: number }
  volume?: { min: number, max: number }
}

export interface DeriveVoiceStyleDirectiveOptions {
  policy?: Pick<ConversationPolicyResult, 'risk' | 'scenario'>
  preferredStyle?: VoiceStyleDirective['style']
  mode?: VoiceConversationMode
  speechBinding?: Pick<VoiceStyleDirective, 'pitchShift' | 'rate' | 'volume'>
  userPreferences?: Pick<VoiceStyleDirective, 'pitchShift' | 'rate' | 'volume'>
  providerCapabilities?: VoiceProviderStyleCapabilities
}

export interface VoiceStyleResolution {
  directive: VoiceStyleDirective
  warnings: VoiceStyleWarning[]
}

/**
 * Derives bounded TTS delivery hints from trusted policy state.
 *
 * This helper intentionally ignores assistant text. Model output may choose
 * words, but it must not inject SSML tags, provider options, hidden tool
 * claims, or unsafe emotional escalation through the voice layer.
 */
export function deriveVoiceStyleDirective(
  options: DeriveVoiceStyleDirectiveOptions = {},
): VoiceStyleResolution {
  const risk: CompanionRiskLevel = options.policy?.risk ?? 'none'
  const scenario: CompanionScenario = options.policy?.scenario ?? 'casual'
  const warnings: VoiceStyleWarning[] = []
  let directive = baseDirectiveForPolicy(risk, scenario, options.preferredStyle, options.mode)
  directive = applyTrustedProsodyPreferences(
    directive,
    risk,
    options.speechBinding,
    options.userPreferences,
  )

  if (risk === 'crisis' && options.preferredStyle === 'playful') {
    warnings.push({
      code: 'voice-style.unsafe-preferred-style',
      message: 'Playful delivery is disabled for crisis support.',
    })
  }

  const capabilities = options.providerCapabilities
  if (capabilities?.supportsStyle === false && directive.style !== 'neutral') {
    warnings.push({
      code: 'voice-style.unsupported-style',
      message: 'Provider does not declare emotional style support; style was degraded.',
    })
    directive = {
      ...directive,
      style: risk === 'crisis' ? 'warm' : 'neutral',
    }
  }

  if (capabilities?.supportsProsody === false) {
    if (directive.rate != null || directive.pitchShift != null || directive.volume != null) {
      warnings.push({
        code: 'voice-style.unsupported-prosody',
        message: 'Provider does not declare prosody support; numeric prosody hints were removed.',
      })
    }
    directive = {
      style: directive.style,
      pace: directive.pace,
      energy: directive.energy,
    }
  }
  else if (capabilities) {
    const rate = clampOptional(directive.rate, capabilities.rate)
    const pitchShift = clampOptional(directive.pitchShift, capabilities.pitchShift)
    const volume = clampOptional(directive.volume, capabilities.volume)

    if (rate.changed) {
      warnings.push({
        code: 'voice-style.clamped-rate',
        message: 'Rate hint was clamped to provider capability bounds.',
      })
    }
    if (pitchShift.changed) {
      warnings.push({
        code: 'voice-style.clamped-pitch',
        message: 'Pitch hint was clamped to provider capability bounds.',
      })
    }
    if (volume.changed) {
      warnings.push({
        code: 'voice-style.clamped-volume',
        message: 'Volume hint was clamped to provider capability bounds.',
      })
    }

    directive = {
      ...directive,
      rate: rate.value,
      pitchShift: pitchShift.value,
      volume: volume.value,
    }
  }

  return {
    directive,
    warnings,
  }
}

function baseDirectiveForPolicy(
  risk: CompanionRiskLevel,
  scenario: CompanionScenario,
  preferredStyle: VoiceStyleDirective['style'] | undefined,
  mode: VoiceConversationMode | undefined,
): VoiceStyleDirective {
  if (risk === 'crisis') {
    return {
      style: 'comforting',
      pace: 'slow',
      energy: 'low',
      rate: 0.92,
      volume: 0.92,
    }
  }

  switch (scenario) {
    case 'venting':
      return {
        style: 'comforting',
        pace: 'slow',
        energy: 'low',
        rate: 0.96,
      }
    case 'study':
      return {
        style: 'serious',
        pace: 'normal',
        energy: 'normal',
      }
    case 'advice':
      return {
        style: 'warm',
        pace: 'normal',
        energy: 'normal',
      }
    case 'relationship':
      return {
        style: 'warm',
        pace: 'normal',
        energy: 'low',
      }
    case 'casual':
      return {
        style: preferredStyle ?? (mode === 'push-to-talk' ? 'neutral' : 'warm'),
        pace: 'normal',
        energy: preferredStyle === 'playful' || preferredStyle === 'cheerful' ? 'high' : 'normal',
      }
    case 'crisis':
      return {
        style: 'comforting',
        pace: 'slow',
        energy: 'low',
        rate: 0.92,
        volume: 0.92,
      }
  }
}

function applyTrustedProsodyPreferences(
  directive: VoiceStyleDirective,
  risk: CompanionRiskLevel,
  speechBinding: DeriveVoiceStyleDirectiveOptions['speechBinding'],
  userPreferences: DeriveVoiceStyleDirectiveOptions['userPreferences'],
): VoiceStyleDirective {
  const preferredRate = firstFinite(userPreferences?.rate, speechBinding?.rate, directive.rate)
  const preferredPitch = firstFinite(userPreferences?.pitchShift, speechBinding?.pitchShift, directive.pitchShift)
  const preferredVolume = firstFinite(userPreferences?.volume, speechBinding?.volume, directive.volume)

  return {
    ...directive,
    // Global safety bounds apply before provider-specific bounds. Crisis
    // support never becomes faster/louder because of a card or local slider.
    rate: clampNumber(preferredRate, 0.5, risk === 'crisis' ? 1 : 2),
    pitchShift: clampNumber(preferredPitch, -100, 100),
    volume: clampNumber(preferredVolume, 0.5, risk === 'crisis' ? 1 : 1.5),
  }
}

function firstFinite(...values: Array<number | undefined>) {
  return values.find(value => typeof value === 'number' && Number.isFinite(value))
}

function clampNumber(value: number | undefined, min: number, max: number) {
  if (value === undefined)
    return undefined
  return Math.min(max, Math.max(min, value))
}

export function voiceStyleCapabilitiesForProvider(
  providerId: string,
  modelId: string,
): VoiceProviderStyleCapabilities {
  if (providerId === 'minimax-speech' && /^speech-(?:2\.8|2\.6|02|01)-(?:hd|turbo)$/.test(modelId)) {
    return {
      supportsStyle: true,
      supportsProsody: true,
      rate: { min: 0.5, max: 2 },
      pitchShift: { min: -12, max: 12 },
      volume: { min: 0.1, max: 10 },
    }
  }

  if ((providerId === 'alibaba-cloud-model-studio' && modelId === 'cosyvoice-v2')
    || ['elevenlabs', 'microsoft-speech', 'azure-speech'].includes(providerId)) {
    return {
      supportsStyle: false,
      supportsProsody: true,
      rate: { min: 0.5, max: 2 },
      pitchShift: { min: -100, max: 100 },
      volume: { min: 0.5, max: 1.5 },
    }
  }

  return {
    supportsStyle: false,
    supportsProsody: false,
  }
}

function clampOptional(
  value: number | undefined,
  bounds: { min: number, max: number } | undefined,
): { value: number | undefined, changed: boolean } {
  if (value == null || !bounds)
    return { value, changed: false }

  const next = Math.min(bounds.max, Math.max(bounds.min, value))
  return {
    value: next,
    changed: next !== value,
  }
}
