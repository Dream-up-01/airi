<script setup lang="ts">
import { isValidMiniMaxVoiceId } from '@proj-airi/stage-ui/libs/minimax-voice-clone'
import { Button, FieldInput } from '@proj-airi/ui'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  registerVoice: (voiceId: string) => Promise<void>
}>()

const { t } = useI18n()
const voiceId = shallowRef('')
const errorCode = shallowRef<string>()
const isRegistering = shallowRef(false)

async function register() {
  const normalizedVoiceId = voiceId.value.trim()
  if (!isValidMiniMaxVoiceId(normalizedVoiceId)) {
    errorCode.value = 'invalid-voice-id'
    return
  }

  errorCode.value = undefined
  isRegistering.value = true
  try {
    await props.registerVoice(normalizedVoiceId)
    voiceId.value = ''
  }
  catch {
    errorCode.value = 'registration-failed'
  }
  finally {
    isRegistering.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4 border border-neutral-200 rounded-xl p-5 dark:border-neutral-800">
    <div class="flex flex-col gap-1">
      <h3 class="text-base font-semibold">
        {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.existing.title') }}
      </h3>
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.existing.description') }}
      </p>
    </div>

    <FieldInput
      v-model="voiceId"
      :label="t('settings.pages.providers.provider.minimax-speech.settings.clone.existing.voice_id_label')"
      :description="t('settings.pages.providers.provider.minimax-speech.settings.clone.existing.voice_id_description')"
      required
    />

    <p v-if="errorCode" class="text-sm text-red-600 dark:text-red-300">
      {{ t(`settings.pages.providers.provider.minimax-speech.settings.clone.existing.errors.${errorCode}`) }}
    </p>

    <Button :loading="isRegistering" :disabled="isRegistering || !voiceId.trim()" size="lg" @click="register">
      {{ t('settings.pages.providers.provider.minimax-speech.settings.clone.existing.submit') }}
    </Button>
  </section>
</template>
