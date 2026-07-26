<script setup lang="ts">
import type { CharacterExtractionJob } from '@proj-airi/stage-ui/domains/characterSource'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ job: CharacterExtractionJob | null }>()
const emit = defineEmits<{ (e: 'cancel'): void }>()
const { t } = useI18n()

const stateLabel = computed(() => {
  const s = props.job?.state
  if (!s)
    return t('settings.pages.card.character_source_import.state.idle')
  const map: Record<string, string> = {
    'reading': t('settings.pages.card.character_source_import.state.reading'),
    'segmenting': t('settings.pages.card.character_source_import.state.segmenting'),
    'discovering-candidates': t('settings.pages.card.character_source_import.state.discovering_candidates'),
    'awaiting-character-selection': t('settings.pages.card.character_source_import.state.awaiting_selection'),
    'extracting': t('settings.pages.card.character_source_import.state.extracting'),
    'merging': t('settings.pages.card.character_source_import.state.merging'),
    'reviewing': t('settings.pages.card.character_source_import.state.reviewing'),
    'completed': t('settings.pages.card.character_source_import.state.completed'),
    'failed': t('settings.pages.card.character_source_import.state.failed'),
    'cancelled': t('settings.pages.card.character_source_import.state.cancelled'),
  }
  return map[s] ?? s
})

const progress = computed(() => {
  const j = props.job
  if (!j || j.totalUnits === 0)
    return 0
  return Math.round((j.completedUnits / j.totalUnits) * 100)
})

const isFailed = computed(() => props.job?.state === 'failed')
const errorCode = computed(() => props.job?.state === 'failed' ? props.job.errorCode : '')
const isCancellable = computed(() =>
  props.job?.state !== 'completed'
  && props.job?.state !== 'failed'
  && props.job?.state !== 'cancelled',
)
</script>

<template>
  <div :class="['flex flex-col gap-6 p-6']">
    <h2 class="text-xl font-medium">
      {{ t('settings.pages.card.character_source_import.analyzing') }}
    </h2>

    <!-- Phase label -->
    <p class="text-sm text-primary-600 font-medium dark:text-primary-400">
      {{ stateLabel }}
    </p>
    <dl v-if="job" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
      <dt>{{ t('settings.pages.card.character_source_import.provider_label') }}</dt>
      <dd class="truncate">
        {{ job.metadata.providerId }} / {{ job.metadata.modelId }}
      </dd>
      <dt>{{ t('settings.pages.card.character_source_import.retry_count') }}</dt>
      <dd>{{ job.metadata.retryCount }}</dd>
    </dl>

    <!-- Progress bar -->
    <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
      <div
        class="h-full bg-primary-500 transition-all duration-300"
        :style="{ width: `${progress}%` }"
      />
    </div>
    <p class="text-right text-xs text-neutral-400">
      {{ job?.completedUnits ?? 0 }} / {{ job?.totalUnits ?? 0 }}
    </p>

    <!-- Error detail -->
    <p v-if="isFailed" class="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
      {{ t('settings.pages.card.character_source_import.error') }}:
      {{ t(`settings.pages.card.character_source_import.errors.${errorCode}`) }}
    </p>

    <!-- Candidate selector slot (overlays when awaiting selection) -->
    <slot />

    <!-- Cancel -->
    <div class="flex justify-end">
      <button
        v-if="isCancellable"
        :class="['rounded-lg px-4 py-2 text-sm text-neutral-500 hover:text-red-500']"
        @click="emit('cancel')"
      >
        {{ t('settings.pages.card.cancel') }}
      </button>
    </div>
  </div>
</template>
