<script setup lang="ts">
import type { PerceptionObservabilitySnapshot, PerceptionSamplingRate } from '@proj-airi/stage-ui/domains/perception'

import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'
import type { LocalCameraPerceptionStatus } from '../../services/perception/local-camera-perception-coordinator'

import { PERCEPTION_SAMPLING_RATES } from '@proj-airi/stage-ui/domains/perception'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LocalScreenPerceptionFacts from './LocalScreenPerceptionFacts.vue'

const props = defineProps<{
  status: LocalCameraPerceptionStatus
  remoteStatuses: readonly PerceptionRuntimeStatusWire[]
  observability: PerceptionObservabilitySnapshot | null
}>()

const emit = defineEmits<{
  start: [consentConfirmed: boolean]
  pause: []
  stop: []
  confirmFact: [factId: string]
  retractFact: [factId: string]
  clearFacts: []
}>()

const consentConfirmed = defineModel<boolean>('consentConfirmed', { default: false })
const samplingRate = defineModel<PerceptionSamplingRate>('samplingRate', { required: true })
const { t } = useI18n()
const isBusy = computed(() => props.status.state === 'starting' || props.status.state === 'stopping')
const hasRemoteOwner = computed(() => props.remoteStatuses.length > 0)
const remoteSourceLabels = computed(() => [...new Set(props.remoteStatuses.map(status => t(`tamagotchi.stage.perception-runtime.source.${status.sourceKind}`)))].join(', '))
const analyzerNames = ['mediapipe', 'opencv', 'yolo'] as const
</script>

<template>
  <section class="max-h-[calc(100vh-5rem)] w-[min(28rem,calc(100vw-1rem))] overflow-y-auto border border-neutral-200 rounded-2xl bg-white/95 p-4 text-neutral-800 shadow-2xl backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
    <header flex items-start gap-3>
      <div mt-0.5 size-8 flex shrink-0 items-center justify-center rounded-xl bg-emerald-500:15 text-emerald-600 dark:text-emerald-300>
        <div i-solar:camera-outline size-5 />
      </div>
      <div min-w-0>
        <h2 text-base font-semibold>
          {{ t('tamagotchi.stage.perception-camera.title') }}
        </h2>
        <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
          {{ t('tamagotchi.stage.perception-camera.description') }}
        </p>
      </div>
    </header>

    <div mt-4 rounded-xl bg-emerald-500:8 p-3 text-xs text-emerald-800 dark:text-emerald-200>
      {{ t('tamagotchi.stage.perception-camera.privacy-notice') }}
    </div>

    <div v-if="hasRemoteOwner" mt-3 rounded-xl bg-amber-500:10 p-3 text-xs text-amber-800 dark:text-amber-200>
      {{ t('tamagotchi.stage.perception-runtime.remote-read-only', { sources: remoteSourceLabels }) }}
    </div>

    <div grid mt-4 gap-2>
      <div
        v-for="analyzer in analyzerNames"
        :key="analyzer"
        flex items-center gap-2 rounded-xl bg-neutral-500:7 px-3 py-2 text-xs
      >
        <span size-2 rounded-full :class="status.analyzers[analyzer] === 'ready' ? 'bg-emerald-500' : status.analyzers[analyzer] === 'degraded' || status.analyzers[analyzer] === 'failed' ? 'bg-amber-500' : 'bg-neutral-400'" />
        <span font-medium>{{ t(`tamagotchi.stage.perception-camera.analyzer.${analyzer}`) }}</span>
        <span ml-auto opacity-70>{{ t(`tamagotchi.stage.perception-camera.analyzer-state.${status.analyzers[analyzer]}`) }}</span>
        <span v-if="status.analyzerErrorCodes[analyzer]" max-w-36 truncate font-mono opacity-60 :title="status.analyzerErrorCodes[analyzer]">
          {{ status.analyzerErrorCodes[analyzer] }}
        </span>
      </div>
    </div>

    <label mt-4 block text-xs font-medium for="local-camera-sampling-rate">
      {{ t('tamagotchi.stage.perception-camera.sampling-rate') }}
    </label>
    <select
      id="local-camera-sampling-rate"
      v-model.number="samplingRate"
      mt-1 w-full border border-neutral-300 rounded-xl bg-transparent px-3 py-2 text-sm dark:border-neutral-700
    >
      <option v-for="rate in PERCEPTION_SAMPLING_RATES" :key="rate" :value="rate">
        {{ t('tamagotchi.stage.perception-camera.sampling-rate-option', { rate }) }}
      </option>
    </select>

    <label v-if="status.state !== 'running'" mt-4 flex items-start gap-2 text-xs :class="hasRemoteOwner ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
      <input v-model="consentConfirmed" type="checkbox" mt-0.5 :disabled="hasRemoteOwner">
      <span>{{ t('tamagotchi.stage.perception-camera.consent') }}</span>
    </label>

    <p v-if="status.lastErrorCode" mt-3 rounded-lg bg-red-500:10 p-2 text-xs text-red-700 dark:text-red-300>
      {{ t('tamagotchi.stage.perception-camera.error-with-code', { code: status.lastErrorCode }) }}
    </p>

    <div v-if="status.state === 'running' || status.state === 'paused'" grid grid-cols-2 mt-3 gap-2 text-xs>
      <div rounded-lg bg-neutral-500:7 p-2>
        {{ t('tamagotchi.stage.perception-camera.capture-profile', { rate: status.samplingRate }) }}
      </div>
      <div rounded-lg bg-neutral-500:7 p-2>
        {{ t('tamagotchi.stage.perception-camera.capture-counts', { observations: status.observationCount, dropped: status.droppedFrameCount, facts: status.acceptedFactCount }) }}
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
        {{ t('tamagotchi.stage.perception-camera.pause') }}
      </button>
      <button
        v-if="status.state === 'running' || status.state === 'paused' || status.state === 'failed'"
        type="button"
        border border-red-400 rounded-xl px-3 py-2 text-sm text-red-700 dark:text-red-300
        @click="emit('stop')"
      >
        {{ t('tamagotchi.stage.perception-camera.stop') }}
      </button>
      <button
        v-if="status.state !== 'running'"
        type="button"
        rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40
        :disabled="!consentConfirmed || isBusy || hasRemoteOwner"
        @click="emit('start', consentConfirmed)"
      >
        {{ isBusy ? t('tamagotchi.stage.perception-camera.starting') : t('tamagotchi.stage.perception-camera.start') }}
      </button>
    </div>
  </section>
</template>
