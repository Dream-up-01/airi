<script setup lang="ts">
import type { PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'

import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'
import type { LocalScreenPerceptionStatus } from '../../services/perception/local-screen-perception-coordinator'
import type { ProductionScreenSource } from '../../services/perception/production-screen-capture'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LocalScreenPerceptionFacts from './LocalScreenPerceptionFacts.vue'

const props = defineProps<{
  sources: readonly ProductionScreenSource[]
  status: LocalScreenPerceptionStatus
  refreshing: boolean
  errorCode?: string
  remoteStatuses: readonly PerceptionRuntimeStatusWire[]
  observability: PerceptionObservabilitySnapshot | null
}>()

const emit = defineEmits<{
  refresh: []
  start: [sourceId: string, consentConfirmed: boolean]
  pause: []
  stop: []
  toggleSensitivePause: [paused: boolean]
  confirmFact: [factId: string]
  retractFact: [factId: string]
  clearFacts: []
}>()

const selectedSourceId = defineModel<string>('selectedSourceId', { default: '' })
const consentConfirmed = defineModel<boolean>('consentConfirmed', { default: false })
const { t } = useI18n()

const isBusy = computed(() => props.status.state === 'starting' || props.status.state === 'stopping')
const hasRemoteOwner = computed(() => props.remoteStatuses.length > 0)
const canStart = computed(() => selectedSourceId.value.length > 0 && consentConfirmed.value && !isBusy.value && !hasRemoteOwner.value && props.status.state !== 'running')
const remoteSourceLabels = computed(() => [...new Set(props.remoteStatuses.map(status => t(`tamagotchi.stage.perception-runtime.source.${status.sourceKind}`)))].join(', '))
const errorLabel = computed(() => props.errorCode
  ? t('tamagotchi.stage.perception-screen.error-with-code', { code: props.errorCode })
  : '')
</script>

<template>
  <section class="max-h-[calc(100vh-5rem)] w-[min(28rem,calc(100vw-1rem))] overflow-y-auto border border-neutral-200 rounded-2xl bg-white/95 p-4 text-neutral-800 shadow-2xl backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
    <header flex items-start gap-3>
      <div mt-0.5 size-8 flex shrink-0 items-center justify-center rounded-xl bg-cyan-500:15 text-cyan-600 dark:text-cyan-300>
        <div i-solar:monitor-camera-outline size-5 />
      </div>
      <div min-w-0>
        <h2 text-base font-semibold>
          {{ t('tamagotchi.stage.perception-screen.title') }}
        </h2>
        <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
          {{ t('tamagotchi.stage.perception-screen.description') }}
        </p>
      </div>
    </header>

    <div mt-4 rounded-xl bg-cyan-500:8 p-3 text-xs text-cyan-800 dark:text-cyan-200>
      {{ t('tamagotchi.stage.perception-screen.privacy-notice') }}
    </div>

    <div v-if="hasRemoteOwner" mt-3 rounded-xl bg-amber-500:10 p-3 text-xs text-amber-800 dark:text-amber-200>
      {{ t('tamagotchi.stage.perception-runtime.remote-read-only', { sources: remoteSourceLabels }) }}
    </div>

    <label mt-4 block text-xs font-medium for="local-screen-source">
      {{ t('tamagotchi.stage.perception-screen.source-label') }}
    </label>
    <div mt-1 flex gap-2>
      <select
        id="local-screen-source"
        v-model="selectedSourceId"
        min-w-0 flex-1 border border-neutral-300 rounded-xl bg-transparent px-3 py-2 text-sm dark:border-neutral-700
        :disabled="status.state === 'running' || isBusy || hasRemoteOwner"
      >
        <option value="">
          {{ t('tamagotchi.stage.perception-screen.select-source') }}
        </option>
        <option v-for="source in sources" :key="source.id" :value="source.id">
          {{ source.name }}
        </option>
      </select>
      <button
        type="button"
        border border-neutral-300 rounded-xl px-3 text-sm dark:border-neutral-700
        :disabled="refreshing || status.state === 'running' || hasRemoteOwner"
        @click="emit('refresh')"
      >
        {{ refreshing ? t('tamagotchi.stage.perception-screen.refreshing') : t('tamagotchi.stage.perception-screen.refresh') }}
      </button>
    </div>

    <p v-if="sources.length === 0 && !refreshing" mt-2 text-xs opacity-70>
      {{ t('tamagotchi.stage.perception-screen.no-sources') }}
    </p>

    <label v-if="status.state !== 'running'" mt-4 flex items-start gap-2 text-xs :class="hasRemoteOwner ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
      <input v-model="consentConfirmed" type="checkbox" mt-0.5 :disabled="hasRemoteOwner">
      <span>{{ t('tamagotchi.stage.perception-screen.consent') }}</span>
    </label>

    <label v-else mt-4 flex cursor-pointer items-start gap-2 text-xs>
      <input
        :checked="status.sensitiveSurfacePaused"
        type="checkbox"
        mt-0.5
        @change="emit('toggleSensitivePause', ($event.target as HTMLInputElement).checked)"
      >
      <span>{{ t('tamagotchi.stage.perception-screen.sensitive-pause') }}</span>
    </label>

    <p v-if="errorLabel" mt-3 rounded-lg bg-red-500:10 p-2 text-xs text-red-700 dark:text-red-300>
      {{ errorLabel }}
    </p>

    <div v-if="status.state === 'running' || status.state === 'paused'" class="text-[11px]" grid grid-cols-2 mt-3 gap-2>
      <div rounded-lg bg-neutral-500:7 p-2>
        {{ t('tamagotchi.stage.perception-screen.capture-profile', { resolution: '1280×720', cadence: '0–1 FPS' }) }}
      </div>
      <div rounded-lg bg-neutral-500:7 p-2>
        {{ t('tamagotchi.stage.perception-screen.capture-counts', {
          attempts: status.captureAttemptCount,
          accepted: status.acceptedFrameCount,
          dropped: status.gateDroppedFrameCount + status.analyzerReplacedFrameCount,
          facts: status.inferenceFactCount,
        }) }}
      </div>
    </div>

    <LocalScreenPerceptionFacts
      v-if="observability"
      :snapshot="observability"
      @confirm="emit('confirmFact', $event)"
      @retract="emit('retractFact', $event)"
      @clear="emit('clearFacts')"
    />

    <div mt-4 flex justify-end gap-2>
      <button
        v-if="status.state === 'running'"
        type="button"
        border border-amber-400 rounded-xl px-3 py-2 text-sm text-amber-700 dark:text-amber-300
        @click="emit('pause')"
      >
        {{ t('tamagotchi.stage.perception-screen.pause') }}
      </button>
      <button
        v-if="status.state === 'running' || status.state === 'paused' || status.state === 'failed'"
        type="button"
        border border-red-400 rounded-xl px-3 py-2 text-sm text-red-700 dark:text-red-300
        @click="emit('stop')"
      >
        {{ t('tamagotchi.stage.perception-screen.stop') }}
      </button>
      <button
        v-if="status.state !== 'running'"
        type="button"
        rounded-xl bg-cyan-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40
        :disabled="!canStart"
        @click="emit('start', selectedSourceId, consentConfirmed)"
      >
        {{ isBusy ? t('tamagotchi.stage.perception-screen.starting') : t('tamagotchi.stage.perception-screen.start') }}
      </button>
    </div>
  </section>
</template>
