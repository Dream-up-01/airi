<script setup lang="ts">
import type { LocalScreenPerceptionStatus } from '../../services/perception/local-screen-perception-coordinator'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: LocalScreenPerceptionStatus
}>()

const emit = defineEmits<{
  openDetails: []
  pause: []
  stop: []
  toggleSensitivePause: [paused: boolean]
}>()

const { t } = useI18n()
const stateLabel = computed(() => t(`tamagotchi.stage.perception-screen.state.${props.status.state}`))
</script>

<template>
  <aside
    class="pointer-events-auto relative min-w-0 w-full border border-cyan-400/40 rounded-lg bg-white/90 p-3 text-neutral-800 shadow-xl backdrop-blur-xl dark:bg-neutral-900/90 dark:text-neutral-100"
    role="status"
    aria-live="polite"
  >
    <div flex items-center gap-2>
      <span relative size-3 flex>
        <span v-if="status.state === 'running'" absolute h-full w-full inline-flex animate-ping rounded-full bg-cyan-400 opacity-60 />
        <span relative size-3 inline-flex rounded-full :class="status.state === 'running' ? 'bg-cyan-500' : 'bg-amber-400'" />
      </span>
      <strong text-sm>{{ stateLabel }}</strong>
      <span ml-auto rounded-full bg-cyan-500:10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300>
        {{ t('tamagotchi.stage.perception-screen.local-only') }}
      </span>
    </div>

    <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
      {{ t('tamagotchi.stage.perception-screen.indicator-description') }}
    </p>
    <p v-if="status.modelId" mt-1 truncate text-xs opacity-70>
      {{ status.modelId }} · {{ t('tamagotchi.stage.perception-screen.fact-count', { count: status.acceptedFactCount }) }}
    </p>

    <div mt-2 flex flex-wrap gap-2>
      <button
        type="button"
        flex items-center gap-1 border border-cyan-400 rounded-lg px-3 py-1 text-xs text-cyan-700 dark:text-cyan-300
        @click="emit('openDetails')"
      >
        <span i-solar:clipboard-list-outline size-3.5 />
        {{ t('tamagotchi.stage.perception-screen.view-results') }}
      </button>
      <button
        v-if="status.state === 'running'"
        type="button"
        rounded-lg bg-amber-500 px-3 py-1 text-xs text-white
        @click="emit('pause')"
      >
        {{ t('tamagotchi.stage.perception-screen.pause') }}
      </button>
      <button
        v-if="status.state === 'running'"
        type="button"
        border border-neutral-300 rounded-lg px-3 py-1 text-xs dark:border-neutral-700
        @click="emit('toggleSensitivePause', !status.sensitiveSurfacePaused)"
      >
        {{ status.sensitiveSurfacePaused ? t('tamagotchi.stage.perception-screen.leave-privacy-pause') : t('tamagotchi.stage.perception-screen.enter-privacy-pause') }}
      </button>
      <button
        type="button"
        rounded-lg bg-red-500 px-3 py-1 text-xs text-white
        @click="emit('stop')"
      >
        {{ t('tamagotchi.stage.perception-screen.stop') }}
      </button>
    </div>
  </aside>
</template>
