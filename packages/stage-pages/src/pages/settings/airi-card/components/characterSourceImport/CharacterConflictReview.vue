<script setup lang="ts">
import type { CharacterConflict, CharacterFact } from '@proj-airi/stage-ui/domains/characterSource'

import { useI18n } from 'vue-i18n'

const props = defineProps<{ conflicts: CharacterConflict[], facts: CharacterFact[] }>()
const emit = defineEmits<{
  resolve: [conflictId: string, decision: { status: CharacterConflict['status'], selectedFactIds?: string[] }]
}>()
const { t } = useI18n()

function conflictFacts(conflict: CharacterConflict): CharacterFact[] {
  return conflict.factIds.map(factId => props.facts.find(fact => fact.factId === factId)).filter((fact): fact is CharacterFact => Boolean(fact))
}
</script>

<template>
  <section class="flex flex-col gap-4 border-b border-neutral-200 p-6 dark:border-neutral-700">
    <h2 class="text-xl font-medium">
      {{ t('settings.pages.card.character_source_import.conflicts_title') }}
    </h2>
    <p class="text-sm text-neutral-500">
      {{ t('settings.pages.card.character_source_import.conflicts_hint') }}
    </p>
    <article
      v-for="conflict in conflicts.filter(value => value.status === 'unresolved')"
      :key="conflict.conflictId"
      class="border border-amber-200 rounded-xl bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <p class="mb-3 text-sm text-amber-700 font-medium dark:text-amber-400">
        {{ t('settings.pages.card.character_source_import.conflict_category', { category: conflict.category }) }}
      </p>
      <div class="flex flex-col gap-2">
        <button
          v-for="fact in conflictFacts(conflict)"
          :key="fact.factId"
          class="rounded-lg bg-white p-3 text-left text-sm shadow dark:bg-neutral-800 hover:bg-primary-50"
          @click="emit('resolve', conflict.conflictId, { status: 'keep-one', selectedFactIds: [fact.factId] })"
        >
          <span class="block font-medium">{{ fact.value }}</span>
          <span class="mt-1 block text-xs text-neutral-500">{{ fact.quote }}</span>
        </button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="rounded-lg bg-white px-3 py-1.5 text-xs shadow dark:bg-neutral-800" @click="emit('resolve', conflict.conflictId, { status: 'keep-both' })">
          {{ t('settings.pages.card.character_source_import.keep_both') }}
        </button>
        <button class="rounded-lg bg-white px-3 py-1.5 text-xs shadow dark:bg-neutral-800 hover:bg-red-50" @click="emit('resolve', conflict.conflictId, { status: 'discard-all' })">
          {{ t('settings.pages.card.character_source_import.discard_all') }}
        </button>
      </div>
    </article>
  </section>
</template>
