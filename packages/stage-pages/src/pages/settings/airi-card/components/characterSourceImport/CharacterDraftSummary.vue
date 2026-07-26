<script setup lang="ts">
import type { CharacterDraft } from '@proj-airi/stage-ui/domains/characterSource'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ draft: CharacterDraft }>()
const emit = defineEmits<{
  (e: 'back'): void
  (e: 'confirm'): void
}>()

const { t } = useI18n()

const acceptedPersonality = computed(() =>
  props.draft.personality.filter(value => value.evidenceValidation === 'verified' && (value.supportStatus === 'explicit' || value.userConfirmed)),
)
const allGroundedValues = computed(() => [
  props.draft.name,
  props.draft.nickname,
  props.draft.description,
  props.draft.scenario,
  ...props.draft.personality,
  ...props.draft.story,
  ...props.draft.relationships,
  ...props.draft.greetings,
  ...props.draft.messageExamples,
].filter(value => value !== undefined))
const pendingInferred = computed(() => {
  const groundedCount = allGroundedValues.value.filter(value => value.supportStatus === 'inferred' && !value.userConfirmed).length
  const confirmedFactIds = new Set(props.draft.confirmedFactIds)
  const loreFactIds = new Set(props.draft.loreEntries.flatMap(entry => entry.sourceFactIds))
  const loreCount = props.draft.facts.filter(fact => loreFactIds.has(fact.factId)
    && fact.supportStatus === 'inferred'
    && fact.evidenceValidation === 'verified'
    && !confirmedFactIds.has(fact.factId)).length
  return groundedCount + loreCount
})
const loreEntryCount = computed(() => props.draft.loreEntries.length)
const warningCount = computed(() => new Set([
  ...props.draft.warningCodes,
  ...props.draft.exportWarningCodes,
]).size)
const blockingCount = computed(() => props.draft.blockingReasonCodes.length)
const unclassifiedCount = computed(() => props.draft.unclassifiedBlockIds.length)
</script>

<template>
  <div :class="['flex flex-col gap-6 p-6']">
    <h2 class="text-xl font-medium">
      {{ t('settings.pages.card.character_source_import.summary_title') }}
    </h2>

    <!-- Summary rows -->
    <dl :class="['flex flex-col gap-2 rounded-xl bg-neutral-50 p-4 text-sm dark:bg-neutral-800']">
      <div class="flex justify-between">
        <dt class="text-neutral-500">
          {{ t('settings.pages.card.name') }}
        </dt>
        <dd class="font-medium">
          {{ draft.name?.value ?? '—' }}
        </dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-neutral-500">
          {{ t('settings.pages.card.personality') }}
        </dt>
        <dd>{{ acceptedPersonality.length }} {{ t('settings.pages.card.character_source_import.items') }}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-neutral-500">
          {{ t('settings.pages.card.character_source_import.lore_entries') }}
        </dt>
        <dd>{{ loreEntryCount }}</dd>
      </div>
      <div v-if="pendingInferred > 0" class="flex justify-between text-amber-600 dark:text-amber-400">
        <dt>{{ t('settings.pages.card.character_source_import.unconfirmed_inferred') }}</dt>
        <dd>{{ pendingInferred }}</dd>
      </div>
      <div v-if="warningCount > 0" class="flex justify-between text-red-500">
        <dt>{{ t('settings.pages.card.character_source_import.warnings') }}</dt>
        <dd>{{ warningCount }}</dd>
      </div>
      <div v-if="blockingCount > 0" class="flex justify-between text-red-600">
        <dt>{{ t('settings.pages.card.character_source_import.blocking_issues') }}</dt>
        <dd>{{ blockingCount }}</dd>
      </div>
      <div v-if="unclassifiedCount > 0" class="flex justify-between text-amber-600 dark:text-amber-400">
        <dt>{{ t('settings.pages.card.character_source_import.unclassified_blocks') }}</dt>
        <dd>{{ unclassifiedCount }}</dd>
      </div>
    </dl>

    <details v-if="draft.unclassifiedExcerpts.length" class="rounded-xl bg-neutral-50 p-4 text-sm dark:bg-neutral-800">
      <summary class="cursor-pointer font-medium">
        {{ t('settings.pages.card.character_source_import.review_unclassified') }}
      </summary>
      <div class="mt-3 flex flex-col gap-3">
        <blockquote
          v-for="excerpt in draft.unclassifiedExcerpts"
          :key="excerpt.blockId"
          class="whitespace-pre-wrap border-l-2 border-amber-300 pl-3 text-neutral-600 dark:text-neutral-300"
        >
          {{ excerpt.text }}
        </blockquote>
      </div>
    </details>

    <p :class="['text-xs text-neutral-400']">
      {{ t('settings.pages.card.character_source_import.not_activated_notice') }}
    </p>

    <!-- Actions -->
    <div :class="['flex justify-end gap-3']">
      <button
        :class="['rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700']"
        @click="emit('back')"
      >
        {{ t('settings.pages.card.character_source_import.back') }}
      </button>
      <button
        :class="['rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600']"
        :disabled="blockingCount > 0"
        @click="emit('confirm')"
      >
        {{ t('settings.pages.card.character_source_import.create_card') }}
      </button>
    </div>
  </div>
</template>
