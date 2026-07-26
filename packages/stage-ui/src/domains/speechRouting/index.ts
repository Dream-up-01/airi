export type SpeechOutputContext = 'text-chat' | 'voice-conversation'

/**
 * Stable output selection captured at the start of one assistant response.
 * Provider secrets, local paths, and arbitrary provider options deliberately
 * do not belong here; those remain in the provider configuration store.
 */
export interface SpeechOutputProfile {
  modelId: string
  providerId: string
  voiceId: string
}

export interface SpeechOutputRoutingProfiles {
  textChat: SpeechOutputProfile | null
  voiceConversation: SpeechOutputProfile | null
}

export interface SpeechOutputProfileResolution {
  context: SpeechOutputContext
  profile: SpeechOutputProfile | null
  reason?: 'profile-not-configured'
}

export interface SpeechOutputSelection {
  modelId: string
  providerId: string
  voiceId: string
}

export interface SpeechOutputProviderDefaults {
  modelId?: string
  providerId: string
  voiceId?: string
}

export interface RecoverSpeechOutputProfileInput {
  activeSelection: SpeechOutputSelection
  blockedProviderIds?: readonly string[]
  currentProfile?: SpeechOutputProfile | null
  providerDefaults?: SpeechOutputProviderDefaults
}

export function isSpeechOutputProfile(value: SpeechOutputProfile | null | undefined): value is SpeechOutputProfile {
  return !!value
    && value.providerId.trim().length > 0
    && value.modelId.trim().length > 0
    && value.voiceId.trim().length > 0
}

/**
 * Converts a user-visible speech selection into a safe routing profile. Some
 * providers, such as MiniMax, share one voice catalog across model variants;
 * callers may preserve that provider's current voice while the model control
 * is changing.
 */
export function deriveSpeechOutputProfileFromSelection(
  current: SpeechOutputProfile | null | undefined,
  selection: SpeechOutputSelection,
  preserveCurrentVoice: boolean,
): SpeechOutputProfile | null {
  const providerId = selection.providerId.trim()
  const modelId = selection.modelId.trim()
  const selectedVoiceId = selection.voiceId.trim()
  const voiceId = selectedVoiceId || (
    preserveCurrentVoice && current?.providerId === providerId
      ? current.voiceId.trim()
      : ''
  )

  const candidate = { providerId, modelId, voiceId }
  return isSpeechOutputProfile(candidate) ? candidate : null
}

/**
 * Repairs a missing output route from the active module selection and, only
 * for the same provider, its persisted defaults. Explicit module values win;
 * provider defaults only fill missing model/voice fields.
 */
export function recoverSpeechOutputProfile(
  input: RecoverSpeechOutputProfileInput,
): SpeechOutputProfile | null {
  if (isSpeechOutputProfile(input.currentProfile)) {
    if (input.blockedProviderIds?.includes(input.currentProfile.providerId))
      return null
    return { ...input.currentProfile }
  }

  const providerId = input.activeSelection.providerId.trim()
  if (!providerId || input.blockedProviderIds?.includes(providerId))
    return null

  const matchingDefaults = input.providerDefaults?.providerId.trim() === providerId
    ? input.providerDefaults
    : undefined
  const candidate = {
    providerId,
    modelId: input.activeSelection.modelId.trim() || matchingDefaults?.modelId?.trim() || '',
    voiceId: input.activeSelection.voiceId.trim() || matchingDefaults?.voiceId?.trim() || '',
  }

  return isSpeechOutputProfile(candidate) ? candidate : null
}

export function resolveSpeechOutputProfile(
  context: SpeechOutputContext,
  profiles: SpeechOutputRoutingProfiles,
): SpeechOutputProfileResolution {
  const candidate = context === 'voice-conversation'
    ? profiles.voiceConversation
    : profiles.textChat

  if (!isSpeechOutputProfile(candidate)) {
    return {
      context,
      profile: null,
      reason: 'profile-not-configured',
    }
  }

  return {
    context,
    // Snapshot rather than exposing the persisted ref object to an active turn.
    profile: { ...candidate },
  }
}
