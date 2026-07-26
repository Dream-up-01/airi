<script setup lang="ts">
import type { GroundedCharacterValue } from '@proj-airi/stage-ui/domains/characterSource'

import { useI18n } from 'vue-i18n'

defineProps<{ value: GroundedCharacterValue<string> }>()
const { t } = useI18n()
</script>

<template>
  <details class="rounded-lg bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-800">
    <summary class="cursor-pointer text-neutral-500">
      {{ t('settings.pages.card.character_source_import.evidence') }}
      · {{ t(`settings.pages.card.character_source_import.support.${value.supportStatus}`) }}
      · {{ t(`settings.pages.card.character_source_import.evidence_status.${value.evidenceValidation}`) }}
    </summary>
    <blockquote v-if="value.quote" class="mt-2 whitespace-pre-wrap border-l-2 border-primary-300 pl-3 text-neutral-700 dark:text-neutral-300">
      {{ value.quote }}
    </blockquote>
    <p v-if="value.evidenceBlockIds.length" class="mt-2 text-neutral-400">
      {{ value.evidenceBlockIds.join(', ') }}
    </p>
  </details>
</template>
