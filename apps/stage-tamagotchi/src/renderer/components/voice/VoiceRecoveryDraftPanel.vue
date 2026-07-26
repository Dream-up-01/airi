<script setup lang="ts">
import type { VoiceConversationRecoveryDraft } from '@proj-airi/stage-ui/domains/voiceConversation'

import { VOICE_RECOVERY_DRAFT_MAX_CHARACTERS } from '@proj-airi/stage-ui/domains/voiceConversation'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  draft: VoiceConversationRecoveryDraft
}>()

const emit = defineEmits<{
  edit: [text: string]
  retry: []
  discard: []
}>()

const { t } = useI18n()
const retrying = computed(() => props.draft.status === 'retrying')
const canRetry = computed(() => !retrying.value && !!props.draft.text.trim())

function onInput(event: Event) {
  emit('edit', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <section
    class="border border-amber-300/70 rounded-2xl bg-amber-50/90 p-3 text-amber-950 shadow-xl backdrop-blur-md dark:border-amber-500/40 dark:bg-amber-950/90 dark:text-amber-50"
    :aria-label="t('tamagotchi.stage.voice.recovery.title')"
  >
    <div class="text-sm font-medium">
      {{ t('tamagotchi.stage.voice.recovery.title') }}
    </div>
    <p class="mt-1 text-xs opacity-75">
      {{ t('tamagotchi.stage.voice.recovery.description') }}
    </p>
    <textarea
      class="mt-2 min-h-20 w-full resize-y border border-amber-300/60 rounded-xl bg-white/80 px-2.5 py-2 text-sm outline-none dark:border-amber-600/50 focus:border-amber-500 dark:bg-neutral-950/70"
      :value="draft.text"
      :maxlength="VOICE_RECOVERY_DRAFT_MAX_CHARACTERS"
      :disabled="retrying"
      :aria-label="t('tamagotchi.stage.voice.recovery.editor-label')"
      @input="onInput"
    />
    <div class="mt-2 flex gap-2">
      <button
        type="button"
        class="rounded-lg bg-amber-700 px-2.5 py-1 text-xs text-white font-medium transition-colors disabled:cursor-not-allowed dark:bg-amber-300 hover:bg-amber-600 dark:text-amber-950 disabled:opacity-50 dark:hover:bg-amber-200"
        :disabled="!canRetry"
        @click="emit('retry')"
      >
        {{ retrying ? t('tamagotchi.stage.voice.recovery.retrying') : t('tamagotchi.stage.voice.recovery.retry') }}
      </button>
      <button
        type="button"
        class="rounded-lg bg-neutral-700 px-2.5 py-1 text-xs text-white font-medium transition-colors disabled:cursor-not-allowed dark:bg-neutral-200 hover:bg-neutral-600 dark:text-neutral-950 disabled:opacity-50 dark:hover:bg-white"
        :disabled="retrying"
        @click="emit('discard')"
      >
        {{ t('tamagotchi.stage.voice.recovery.discard') }}
      </button>
    </div>
  </section>
</template>
