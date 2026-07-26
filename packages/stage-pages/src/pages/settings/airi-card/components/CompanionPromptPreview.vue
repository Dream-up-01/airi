<script setup lang="ts">
import type { PromptSection } from '@proj-airi/stage-ui/domains/companion'

import { useI18n } from 'vue-i18n'

defineProps<{
  sections: PromptSection[]
}>()

const { t } = useI18n()
</script>

<template>
  <details>
    <summary :class="['cursor-pointer text-sm font-medium']">
      {{ t('settings.pages.card.companion_import.prompt_preview') }}
    </summary>
    <div :class="['mt-3 flex flex-col gap-3']">
      <section
        v-for="section in sections"
        :key="section.id"
        :class="['rounded-lg bg-neutral-100/80 p-3 dark:bg-neutral-800/70']"
      >
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ section.id }} · {{ section.source }} · P{{ section.priority }}
        </p>
        <pre :class="['mt-2 whitespace-pre-wrap text-sm font-sans']">{{ section.content }}</pre>
      </section>
    </div>
  </details>
</template>
