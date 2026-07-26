<script setup lang="ts">
import type { LocalCameraPerceptionStatus } from '../../services/perception/local-camera-perception-coordinator'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: LocalCameraPerceptionStatus
}>()
const emit = defineEmits<{ pause: [], stop: [] }>()
const { t } = useI18n()
const stateLabel = computed(() => t(`tamagotchi.stage.perception-camera.state.${props.status.state}`))
const analyzerNames = ['mediapipe', 'opencv', 'yolo'] as const
</script>

<template>
  <aside
    class="pointer-events-auto relative min-w-0 w-full border border-emerald-400/40 rounded-lg bg-white/90 p-3 text-neutral-800 shadow-xl backdrop-blur-xl dark:bg-neutral-900/90 dark:text-neutral-100"
    role="status"
    aria-live="polite"
  >
    <div flex items-center gap-2>
      <span relative size-3 flex>
        <span v-if="status.state === 'running'" absolute h-full w-full inline-flex animate-ping rounded-full bg-emerald-400 opacity-60 />
        <span relative size-3 inline-flex rounded-full :class="status.state === 'running' ? 'bg-emerald-500' : 'bg-amber-400'" />
      </span>
      <strong text-sm>{{ stateLabel }}</strong>
      <span ml-auto rounded-full bg-emerald-500:10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300>{{ t('tamagotchi.stage.perception-camera.local-only') }}</span>
    </div>
    <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
      {{ t('tamagotchi.stage.perception-camera.indicator-description') }}
    </p>
    <div mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs>
      <span v-for="analyzer in analyzerNames" :key="analyzer" flex items-center gap-1>
        <span size-1.5 rounded-full :class="status.analyzers[analyzer] === 'ready' ? 'bg-emerald-500' : status.analyzers[analyzer] === 'degraded' || status.analyzers[analyzer] === 'failed' ? 'bg-amber-500' : 'bg-neutral-400'" />
        {{ t(`tamagotchi.stage.perception-camera.analyzer.${analyzer}`) }}
        <span opacity-60>{{ t(`tamagotchi.stage.perception-camera.analyzer-state.${status.analyzers[analyzer]}`) }}</span>
      </span>
    </div>
    <p mt-1 text-xs opacity-60>
      {{ t('tamagotchi.stage.perception-camera.capture-counts', { observations: status.observationCount, dropped: status.droppedFrameCount, facts: status.acceptedFactCount }) }}
    </p>
    <div mt-2 flex gap-2>
      <button v-if="status.state === 'running'" type="button" rounded-lg bg-amber-500 px-3 py-1 text-xs text-white @click="emit('pause')">
        {{ t('tamagotchi.stage.perception-camera.pause') }}
      </button>
      <button type="button" rounded-lg bg-red-500 px-3 py-1 text-xs text-white @click="emit('stop')">
        {{ t('tamagotchi.stage.perception-camera.stop') }}
      </button>
    </div>
  </aside>
</template>
