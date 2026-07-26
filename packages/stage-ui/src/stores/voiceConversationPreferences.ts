import type { VoiceConversationPreferences } from '../domains/voiceConversation'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'

import {
  defaultVoiceConversationPreferences,
  migrateVoiceConversationPreferencesV1,
  normalizeVoiceConversationPreferences,
} from '../domains/voiceConversation'

const storageKey = 'settings/voice-conversation/preferences-v2'
const legacyStorageKey = 'settings/voice-conversation/preferences-v1'

function readLegacyPreferences(): VoiceConversationPreferences {
  if (typeof localStorage === 'undefined')
    return { ...defaultVoiceConversationPreferences }

  try {
    const stored = localStorage.getItem(legacyStorageKey)
    if (!stored)
      return { ...defaultVoiceConversationPreferences }

    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ...defaultVoiceConversationPreferences }

    return migrateVoiceConversationPreferencesV1(parsed as Partial<VoiceConversationPreferences>)
  }
  catch {
    return { ...defaultVoiceConversationPreferences }
  }
}

export const useVoiceConversationPreferencesStore = defineStore('voice-conversation-preferences', () => {
  const persisted = useLocalStorageManualReset<VoiceConversationPreferences>(storageKey, readLegacyPreferences())

  function normalizePersistedPreferences() {
    const normalized = normalizeVoiceConversationPreferences(persisted.value)
    if (JSON.stringify(normalized) !== JSON.stringify(persisted.value))
      persisted.value = normalized
  }

  normalizePersistedPreferences()
  watch(persisted, normalizePersistedPreferences, { deep: true })

  const preferences = computed(() => normalizeVoiceConversationPreferences(persisted.value))

  function update(patch: Partial<VoiceConversationPreferences>) {
    persisted.value = normalizeVoiceConversationPreferences({
      ...persisted.value,
      ...patch,
    })
  }

  function reset() {
    persisted.reset()
    normalizePersistedPreferences()
  }

  return {
    preferences,
    update,
    reset,
  }
})
