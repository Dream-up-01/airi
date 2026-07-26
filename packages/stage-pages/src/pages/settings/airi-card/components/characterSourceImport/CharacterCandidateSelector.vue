<script setup lang="ts">
import type { CharacterCandidate } from '@proj-airi/stage-ui/domains/characterSource'

import { useI18n } from 'vue-i18n'

defineProps<{
  candidates: CharacterCandidate[]
  evidenceByCandidate: Record<string, Array<{ blockId: string, text: string }>>
}>()
const emit = defineEmits<{ (e: 'select', candidateId: string): void }>()
const { t } = useI18n()
</script>

<template>
  <div :class="['mt-4 flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700']">
    <p class="text-sm font-medium">
      {{ t('settings.pages.card.character_source_import.select_candidate') }}
    </p>
    <p class="text-xs text-neutral-400">
      {{ t('settings.pages.card.character_source_import.select_candidate_hint') }}
    </p>

    <div :class="['flex flex-col gap-2']">
      <button
        v-for="c in candidates"
        :key="c.candidateId"
        :class="[
          'flex flex-col items-start gap-1 rounded-lg border border-neutral-200 p-3 text-left',
          'hover:border-primary-400 hover:bg-primary-50 dark:border-neutral-700 dark:hover:border-primary-600 dark:hover:bg-primary-950/20',
        ]"
        @click="emit('select', c.candidateId)"
      >
        <span class="font-medium">{{ c.name }}</span>
        <span v-if="c.aliases.length" class="text-xs text-neutral-400">
          {{ c.aliases.join(' / ') }}
        </span>
        <span class="text-xs text-neutral-400">
          {{ t('settings.pages.card.character_source_import.evidence_blocks', { count: c.evidenceBlockIds.length }) }}
          · {{ c.ambiguity }}
        </span>
        <blockquote
          v-for="evidence in evidenceByCandidate[c.candidateId] ?? []"
          :key="evidence.blockId"
          class="line-clamp-3 mt-1 whitespace-pre-wrap border-l-2 border-primary-200 pl-2 text-xs text-neutral-500 dark:text-neutral-400"
        >
          {{ evidence.text }}
        </blockquote>
      </button>
    </div>
  </div>
</template>
