<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  state: 'off' | 'waiting' | 'running' | 'paused' | 'failed'
  serviceConnected: boolean
  acceptedFactCount: number
}>()

const emit = defineEmits<{ pause: [], resume: [], stop: [] }>()
const { t } = useI18n()
</script>

<template>
  <aside
    class="pointer-events-auto relative min-w-0 w-full border border-lime-500/40 rounded-lg bg-white/90 p-3 text-neutral-800 shadow-xl backdrop-blur-xl dark:bg-neutral-900/90 dark:text-neutral-100"
    role="status"
    aria-live="polite"
  >
    <div flex items-center gap-2>
      <span relative size-3 flex>
        <span v-if="state === 'running'" absolute h-full w-full inline-flex animate-ping rounded-full bg-lime-400 opacity-60 />
        <span relative size-3 inline-flex rounded-full :class="state === 'running' ? 'bg-lime-500' : 'bg-amber-400'" />
      </span>
      <strong text-sm>{{ t(`tamagotchi.stage.perception-minecraft.state.${state}`) }}</strong>
      <span ml-auto rounded-full bg-lime-500:10 px-2 py-0.5 text-xs text-lime-800 dark:text-lime-300>
        {{ t('tamagotchi.stage.perception-minecraft.local-structured') }}
      </span>
    </div>
    <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
      {{ t('tamagotchi.stage.perception-minecraft.indicator-description') }}
    </p>
    <p mt-1 text-xs opacity-65>
      {{ t('tamagotchi.stage.perception-minecraft.indicator-status', { connected: serviceConnected ? t('tamagotchi.stage.perception-minecraft.connected') : t('tamagotchi.stage.perception-minecraft.disconnected'), facts: acceptedFactCount }) }}
    </p>
    <div mt-2 flex gap-2>
      <button v-if="state === 'running' || state === 'waiting'" type="button" rounded-lg bg-amber-500 px-3 py-1 text-xs text-white @click="emit('pause')">
        {{ t('tamagotchi.stage.perception-minecraft.pause') }}
      </button>
      <button v-if="state === 'paused'" type="button" rounded-lg bg-lime-600 px-3 py-1 text-xs text-white @click="emit('resume')">
        {{ t('tamagotchi.stage.perception-minecraft.resume') }}
      </button>
      <button type="button" rounded-lg bg-red-500 px-3 py-1 text-xs text-white @click="emit('stop')">
        {{ t('tamagotchi.stage.perception-minecraft.stop') }}
      </button>
    </div>
  </aside>
</template>
