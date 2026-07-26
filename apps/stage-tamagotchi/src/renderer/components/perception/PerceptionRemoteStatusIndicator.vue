<script setup lang="ts">
import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  statuses: readonly PerceptionRuntimeStatusWire[]
}>()

const { t } = useI18n()
const descriptions = computed(() => props.statuses.map(status => t('tamagotchi.stage.perception-runtime.remote-indicator-item', {
  source: t(`tamagotchi.stage.perception-runtime.source.${status.sourceKind}`),
  state: t(`tamagotchi.stage.perception-runtime.state.${status.state}`),
})).join(' · '))
</script>

<template>
  <aside class="pointer-events-none relative w-full border border-amber-300 rounded-lg bg-white/95 p-3 text-amber-900 shadow-xl backdrop-blur-xl dark:border-amber-700 dark:bg-neutral-900/95 dark:text-amber-100">
    <div flex items-start gap-2>
      <span mt-1 size-2.5 shrink-0 rounded-full bg-amber-500 />
      <div min-w-0>
        <p text-sm font-semibold>
          {{ t('tamagotchi.stage.perception-runtime.remote-indicator-title') }}
        </p>
        <p mt-0.5 text-xs>
          {{ descriptions }}
        </p>
        <p class="mt-1 text-[11px] opacity-70">
          {{ t('tamagotchi.stage.perception-runtime.remote-indicator-description') }}
        </p>
      </div>
    </div>
  </aside>
</template>
