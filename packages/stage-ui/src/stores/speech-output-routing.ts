import type {
  SpeechOutputContext,
  SpeechOutputProfile,
  SpeechOutputRoutingProfiles,
} from '../domains/speechRouting'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { resolveSpeechOutputProfile } from '../domains/speechRouting'

const typedChatStorageKey = 'settings/speech/output-profile/text-chat'
const voiceConversationStorageKey = 'settings/speech/output-profile/voice-conversation'

function sanitizeProfile(value: unknown): SpeechOutputProfile | null {
  if (!value || typeof value !== 'object')
    return null

  const candidate = value as Record<string, unknown>
  if (typeof candidate.providerId !== 'string'
    || typeof candidate.modelId !== 'string'
    || typeof candidate.voiceId !== 'string') {
    return null
  }

  const providerId = candidate.providerId.trim()
  const modelId = candidate.modelId.trim()
  const voiceId = candidate.voiceId.trim()
  if (!providerId || !modelId || !voiceId)
    return null

  return { providerId, modelId, voiceId }
}

const speechOutputProfileSerializer = {
  read(value: string): SpeechOutputProfile | null {
    try {
      return sanitizeProfile(JSON.parse(value))
    }
    catch {
      // Migrate profiles written by the old null-inferred VueUse serializer,
      // which stored objects as the literal string "[object Object]".
      return null
    }
  },
  write(value: SpeechOutputProfile | null): string {
    return JSON.stringify(sanitizeProfile(value))
  },
}

/**
 * Persists only provider/model/voice identifiers for the two user-facing
 * speech contexts. It intentionally does not persist API keys, local paths,
 * model style prompts, or active response text.
 */
export const useSpeechOutputRoutingStore = defineStore('speech-output-routing', () => {
  const storageOptions = { serializer: speechOutputProfileSerializer }
  const textChatProfile = useLocalStorageManualReset<SpeechOutputProfile | null>(typedChatStorageKey, null, storageOptions)
  const voiceConversationProfile = useLocalStorageManualReset<SpeechOutputProfile | null>(voiceConversationStorageKey, null, storageOptions)

  const profiles = computed<SpeechOutputRoutingProfiles>(() => ({
    textChat: sanitizeProfile(textChatProfile.value),
    voiceConversation: sanitizeProfile(voiceConversationProfile.value),
  }))

  function profileFor(context: SpeechOutputContext) {
    return resolveSpeechOutputProfile(context, profiles.value)
  }

  function setProfile(context: SpeechOutputContext, profile: SpeechOutputProfile | null) {
    const next = sanitizeProfile(profile)
    if (context === 'text-chat') {
      textChatProfile.value = next
      return
    }
    voiceConversationProfile.value = next
  }

  function clearProfile(context: SpeechOutputContext) {
    setProfile(context, null)
  }

  function resetState() {
    textChatProfile.reset()
    voiceConversationProfile.reset()
  }

  return {
    textChatProfile,
    voiceConversationProfile,
    profiles,
    profileFor,
    setProfile,
    clearProfile,
    resetState,
  }
})
