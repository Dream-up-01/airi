<script setup lang="ts">
import type { VoiceConversationMode, VoiceInterruptionPolicy } from '@proj-airi/stage-ui/domains/voiceConversation'

import { voiceConversationPreferenceBounds } from '@proj-airi/stage-ui/domains/voiceConversation'
import { notifyVoiceSettingsChanged, voiceSettingsStorageKeys } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useVoiceConversationPreferencesStore } from '@proj-airi/stage-ui/stores/voiceConversationPreferences'
import { FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useVoiceConversationPreferencesStore()
const { preferences } = storeToRefs(store)

function updatePreferences(patch: Parameters<typeof store.update>[0]) {
  store.update(patch)
  notifyVoiceSettingsChanged([voiceSettingsStorageKeys.voiceConversationPreferences])
}

const mode = computed({
  get: () => preferences.value.mode,
  set: (value: VoiceConversationMode) => updatePreferences({ mode: value }),
})
const interruptionPolicy = computed({
  get: () => preferences.value.interruptionPolicy,
  set: (value: VoiceInterruptionPolicy) => updatePreferences({ interruptionPolicy: value }),
})
const vadThreshold = computed({
  get: () => preferences.value.vadThreshold,
  set: (value: number) => updatePreferences({ vadThreshold: value }),
})
const minSpeechDurationMs = computed({
  get: () => preferences.value.minSpeechDurationMs,
  set: (value: number) => updatePreferences({ minSpeechDurationMs: value }),
})
const trailingSilenceMs = computed({
  get: () => preferences.value.trailingSilenceMs,
  set: (value: number) => updatePreferences({ trailingSilenceMs: value }),
})
const cloudPrivacyAcknowledged = computed({
  get: () => preferences.value.cloudPrivacyAcknowledged,
  set: (value: boolean) => updatePreferences({ cloudPrivacyAcknowledged: value }),
})
</script>

<template>
  <section class="flex flex-col gap-4 border border-neutral-200 rounded-xl bg-white/60 p-4 dark:border-neutral-700 dark:bg-neutral-900/40">
    <div>
      <h2 class="text-lg text-neutral-700 font-medium dark:text-neutral-200">
        {{ t('settings.pages.modules.hearing.voice-conversation.preferences.title') }}
      </h2>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {{ t('settings.pages.modules.hearing.voice-conversation.preferences.description') }}
      </p>
    </div>

    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium">{{ t('settings.pages.modules.hearing.voice-conversation.preferences.mode') }}</span>
      <select v-model="mode" class="border border-neutral-300 rounded-lg bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
        <option value="vad-turn-taking">{{ t('settings.pages.modules.hearing.voice-conversation.modes.vad') }}</option>
        <option value="streaming-asr">{{ t('settings.pages.modules.hearing.voice-conversation.modes.streaming') }}</option>
        <option value="push-to-talk" disabled>{{ t('settings.pages.modules.hearing.voice-conversation.modes.push-to-talk-unavailable') }}</option>
      </select>
    </label>

    <label class="flex flex-col gap-1 text-sm">
      <span class="font-medium">{{ t('settings.pages.modules.hearing.voice-conversation.preferences.interruption-policy') }}</span>
      <select v-model="interruptionPolicy" class="border border-neutral-300 rounded-lg bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
        <option value="disabled">{{ t('settings.pages.modules.hearing.voice-conversation.interruptions.disabled') }}</option>
        <option value="pushToInterrupt">{{ t('settings.pages.modules.hearing.voice-conversation.interruptions.push') }}</option>
        <option value="vadBargeIn">{{ t('settings.pages.modules.hearing.voice-conversation.interruptions.vad') }}</option>
      </select>
    </label>

    <FieldRange
      v-model="vadThreshold"
      :label="t('settings.pages.modules.hearing.voice-conversation.preferences.vad-threshold')"
      :min="voiceConversationPreferenceBounds.vadThreshold.min"
      :max="voiceConversationPreferenceBounds.vadThreshold.max"
      :step="0.05"
      :format-value="value => value.toFixed(2)"
    />
    <FieldRange
      v-model="minSpeechDurationMs"
      :label="t('settings.pages.modules.hearing.voice-conversation.preferences.min-speech')"
      :min="voiceConversationPreferenceBounds.minSpeechDurationMs.min"
      :max="voiceConversationPreferenceBounds.minSpeechDurationMs.max"
      :step="50"
      :format-value="value => `${value} ms`"
    />
    <FieldRange
      v-model="trailingSilenceMs"
      :label="t('settings.pages.modules.hearing.voice-conversation.preferences.trailing-silence')"
      :min="voiceConversationPreferenceBounds.trailingSilenceMs.min"
      :max="voiceConversationPreferenceBounds.trailingSilenceMs.max"
      :step="50"
      :format-value="value => `${value} ms`"
    />

    <FieldCheckbox
      v-model="cloudPrivacyAcknowledged"
      :label="t('settings.pages.modules.hearing.voice-conversation.preferences.cloud-privacy')"
      :description="t('settings.pages.modules.hearing.voice-conversation.preferences.cloud-privacy-description')"
    />
  </section>
</template>
