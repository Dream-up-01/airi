<script setup lang="ts">
import type { QwenCloudControlStatus } from '../../../shared/eventa/perception-cloud'
import type { ProductionScreenSource } from '../../services/perception/production-screen-capture'
import type { QwenCloudCameraStatus } from '../../services/perception/qwen-cloud-camera-coordinator'
import type { QwenCloudScreenStatus } from '../../services/perception/qwen-cloud-screen-coordinator'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: QwenCloudControlStatus | null
  loading: boolean
  errorCode?: string
  validationCompleted: boolean
  screenStatus: QwenCloudScreenStatus
  screenSources: readonly ProductionScreenSource[]
  refreshingScreenSources: boolean
  cameraStatus: QwenCloudCameraStatus
}>()

const emit = defineEmits<{
  refresh: []
  validate: []
  stop: []
  refreshScreenSources: []
  startScreen: [sourceId: string, consentConfirmed: boolean]
  pauseScreen: []
  stopScreen: []
  startCamera: [consentConfirmed: boolean]
  pauseCamera: []
  stopCamera: []
  cameraPrivacyMode: [enabled: boolean]
}>()
const selectedScreenSourceId = defineModel<string>('selectedScreenSourceId', { required: true })
const screenConsentConfirmed = defineModel<boolean>('screenConsentConfirmed', { required: true })
const cameraConsentConfirmed = defineModel<boolean>('cameraConsentConfirmed', { required: true })

const { t } = useI18n()
const budgetLimits = { session: 5, day: 10, month: 50 } as const
const stateLabel = computed(() => t(`tamagotchi.stage.perception-cloud.state.${props.status?.state ?? 'loading'}`))
const readiness = computed(() => props.status
  ? [
      { id: 'workspace', ready: props.status.workspaceConfigured },
      { id: 'api-key', ready: props.status.apiKeyConfigured },
      { id: 'retention', ready: props.status.providerRetentionVerified },
      { id: 'models', ready: props.status.modelAvailabilityVerified },
      { id: 'transport', ready: props.status.providerClientAvailable },
      { id: 'cost-ledger', ready: props.status.costLedgerAvailable },
    ]
  : [])
const budgets = computed(() => props.status
  ? [
      { id: 'session', spent: props.status.cost.sessionSpent, limit: budgetLimits.session },
      { id: 'day', spent: props.status.cost.daySpent, limit: budgetLimits.day },
      { id: 'month', spent: props.status.cost.monthSpent, limit: budgetLimits.month },
    ]
  : [])
const screenRunning = computed(() => props.screenStatus.captureState === 'running')
const canStartScreen = computed(() => props.status?.state === 'ready'
  && !!selectedScreenSourceId.value
  && screenConsentConfirmed.value
  && !screenRunning.value)
const cameraRunning = computed(() => props.cameraStatus.captureState === 'running')
const canStartCamera = computed(() => props.status?.state === 'ready' && cameraConsentConfirmed.value && !cameraRunning.value)
const uploadActive = computed(() => props.screenStatus.uploadActive || props.cameraStatus.uploadActive)
</script>

<template>
  <section class="max-h-[calc(100vh-5rem)] w-[min(28rem,calc(100vw-1rem))] overflow-y-auto border border-neutral-200 rounded-lg bg-white/95 p-4 text-neutral-800 shadow-xl backdrop-blur-xl dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
    <header flex items-start gap-3>
      <div mt-0.5 size-8 flex shrink-0 items-center justify-center rounded-lg bg-blue-500:15 text-blue-600 dark:text-blue-300>
        <div i-solar:cloud-outline size-5 />
      </div>
      <div min-w-0 flex-1>
        <div flex flex-wrap items-center gap-x-2 gap-y-1>
          <h2 whitespace-nowrap text-base font-semibold>
            {{ t('tamagotchi.stage.perception-cloud.title') }}
          </h2>
          <span whitespace-nowrap rounded px-1.5 py-0.5 text-xs :class="status?.state === 'ready' ? 'bg-emerald-500:12 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500:12 text-amber-700 dark:text-amber-300'">
            {{ stateLabel }}
          </span>
        </div>
        <p mt-1 text-xs text-neutral-600 dark:text-neutral-300>
          {{ t('tamagotchi.stage.perception-cloud.endpoint', { region: t('tamagotchi.stage.perception-cloud.region-label') }) }}
        </p>
      </div>
      <button
        type="button"
        size-8 flex shrink-0 items-center justify-center rounded-lg disabled:cursor-wait hover:bg-neutral-500:10 disabled:opacity-50
        :aria-label="t('tamagotchi.stage.perception-cloud.refresh')"
        :title="t('tamagotchi.stage.perception-cloud.refresh')"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <span i-solar:refresh-outline size-4 :class="loading ? 'animate-spin' : ''" />
      </button>
    </header>

    <div mt-4 border rounded-lg p-3 text-xs :class="uploadActive ? 'border-blue-500:30 bg-blue-500:8 text-blue-800 dark:text-blue-200' : 'border-emerald-500:30 bg-emerald-500:8 text-emerald-800 dark:text-emerald-200'">
      {{ t(`tamagotchi.stage.perception-cloud.${uploadActive ? 'upload-active' : 'no-upload'}`) }}
    </div>

    <p v-if="errorCode" mt-3 rounded-lg bg-red-500:10 p-2 text-xs text-red-700 dark:text-red-300>
      {{ t('tamagotchi.stage.perception-cloud.error-with-code', { code: errorCode }) }}
    </p>

    <p v-else-if="validationCompleted" role="status" mt-3 rounded-lg bg-emerald-500:10 p-2 text-xs text-emerald-800 dark:text-emerald-200>
      {{ t('tamagotchi.stage.perception-cloud.validation-complete') }}
    </p>

    <div mt-4>
      <h3 text-xs text-neutral-500 font-semibold uppercase>
        {{ t('tamagotchi.stage.perception-cloud.readiness-title') }}
      </h3>
      <div mt-2 divide-y divide-neutral-200 dark:divide-neutral-800>
        <div v-for="item in readiness" :key="item.id" min-h-9 flex items-center gap-2 py-2 text-xs>
          <span size-2 rounded-full :class="item.ready ? 'bg-emerald-500' : 'bg-amber-500'" />
          <span>{{ t(`tamagotchi.stage.perception-cloud.readiness.${item.id}`) }}</span>
          <span ml-auto :class="item.ready ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'">
            {{ t(`tamagotchi.stage.perception-cloud.readiness-state.${item.ready ? 'ready' : 'pending'}`) }}
          </span>
        </div>
      </div>
    </div>

    <div mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800>
      <h3 text-xs text-neutral-500 font-semibold uppercase>
        {{ t('tamagotchi.stage.perception-cloud.camera-session-title') }}
      </h3>
      <p mt-2 text-xs text-neutral-600 dark:text-neutral-300>
        {{ t('tamagotchi.stage.perception-cloud.camera-mixed-description') }}
      </p>
      <label mt-3 flex items-start gap-2 text-xs>
        <input v-model="cameraConsentConfirmed" type="checkbox" mt-0.5 :disabled="cameraRunning">
        <span>{{ t('tamagotchi.stage.perception-cloud.camera-audio-consent') }}</span>
      </label>
      <label mt-3 flex items-center justify-between gap-3 text-xs>
        <span>{{ t('tamagotchi.stage.perception-cloud.camera-privacy-mode') }}</span>
        <input
          type="checkbox"
          :checked="cameraStatus.privacyMode"
          @change="emit('cameraPrivacyMode', ($event.target as HTMLInputElement).checked)"
        >
      </label>
      <dl class="grid grid-cols-[7rem_1fr]" mt-3 gap-x-3 gap-y-1.5 text-xs>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.capture-state') }}
        </dt>
        <dd>{{ cameraStatus.captureState }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.resolution') }}
        </dt>
        <dd>{{ cameraStatus.resolution }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.windows') }}
        </dt>
        <dd>{{ cameraStatus.completedWindows }} / {{ cameraStatus.submittedWindows }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.facts') }}
        </dt>
        <dd>{{ cameraStatus.acceptedFactCount }}</dd>
      </dl>
      <p v-if="cameraStatus.lastErrorCode" mt-2 text-xs text-red-700 dark:text-red-300>
        {{ t('tamagotchi.stage.perception-cloud.error-with-code', { code: cameraStatus.lastErrorCode }) }}
      </p>
      <div mt-3 flex justify-end gap-2>
        <button
          v-if="!cameraRunning"
          type="button"
          rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50
          :disabled="!canStartCamera"
          @click="emit('startCamera', cameraConsentConfirmed)"
        >
          {{ t('tamagotchi.stage.perception-cloud.start-camera') }}
        </button>
        <template v-else>
          <button type="button" border border-neutral-300 rounded-lg px-3 py-2 text-sm dark:border-neutral-700 @click="emit('pauseCamera')">
            {{ t('tamagotchi.stage.perception-cloud.pause-screen') }}
          </button>
          <button type="button" border border-red-400 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-300 @click="emit('stopCamera')">
            {{ t('tamagotchi.stage.perception-cloud.stop-screen') }}
          </button>
        </template>
      </div>
    </div>

    <div mt-4>
      <div flex items-center justify-between gap-2>
        <h3 text-xs text-neutral-500 font-semibold uppercase>
          {{ t('tamagotchi.stage.perception-cloud.screen-session-title') }}
        </h3>
        <button
          type="button"
          size-7 flex items-center justify-center rounded-lg disabled:cursor-wait hover:bg-neutral-500:10 disabled:opacity-50
          :disabled="refreshingScreenSources || screenRunning"
          :aria-label="t('tamagotchi.stage.perception-cloud.refresh-sources')"
          :title="t('tamagotchi.stage.perception-cloud.refresh-sources')"
          @click="emit('refreshScreenSources')"
        >
          <span i-solar:refresh-outline size-4 :class="refreshingScreenSources ? 'animate-spin' : ''" />
        </button>
      </div>
      <select
        v-model="selectedScreenSourceId"
        mt-2 w-full border border-neutral-300 rounded-lg bg-transparent px-3 py-2 text-sm outline-none dark:border-neutral-700 disabled:opacity-50
        :disabled="screenRunning"
      >
        <option value="">
          {{ t('tamagotchi.stage.perception-cloud.select-screen-source') }}
        </option>
        <option v-for="source in screenSources" :key="source.id" :value="source.id">
          {{ source.name }}
        </option>
      </select>
      <label mt-3 flex items-start gap-2 text-xs>
        <input v-model="screenConsentConfirmed" type="checkbox" mt-0.5 :disabled="screenRunning">
        <span>{{ t('tamagotchi.stage.perception-cloud.screen-audio-consent') }}</span>
      </label>
      <dl class="grid grid-cols-[7rem_1fr]" mt-3 gap-x-3 gap-y-1.5 text-xs>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.capture-state') }}
        </dt>
        <dd>{{ screenStatus.captureState }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.windows') }}
        </dt>
        <dd>{{ screenStatus.completedWindows }} / {{ screenStatus.submittedWindows }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.facts') }}
        </dt>
        <dd>{{ screenStatus.acceptedFactCount }}</dd>
      </dl>
      <p v-if="screenStatus.lastErrorCode" mt-2 text-xs text-red-700 dark:text-red-300>
        {{ t('tamagotchi.stage.perception-cloud.error-with-code', { code: screenStatus.lastErrorCode }) }}
      </p>
      <div mt-3 flex justify-end gap-2>
        <button
          v-if="!screenRunning"
          type="button"
          rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50
          :disabled="!canStartScreen"
          @click="emit('startScreen', selectedScreenSourceId, screenConsentConfirmed)"
        >
          {{ t('tamagotchi.stage.perception-cloud.start-screen') }}
        </button>
        <template v-else>
          <button type="button" border border-neutral-300 rounded-lg px-3 py-2 text-sm dark:border-neutral-700 @click="emit('pauseScreen')">
            {{ t('tamagotchi.stage.perception-cloud.pause-screen') }}
          </button>
          <button type="button" border border-red-400 rounded-lg px-3 py-2 text-sm text-red-700 dark:text-red-300 @click="emit('stopScreen')">
            {{ t('tamagotchi.stage.perception-cloud.stop-screen') }}
          </button>
        </template>
      </div>
    </div>

    <div mt-4>
      <h3 text-xs text-neutral-500 font-semibold uppercase>
        {{ t('tamagotchi.stage.perception-cloud.models-title') }}
      </h3>
      <dl class="grid grid-cols-[6rem_1fr]" mt-2 gap-x-3 gap-y-2 text-xs>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.screen-model') }}
        </dt>
        <dd min-w-0 break-all font-mono>
          {{ t('tamagotchi.stage.perception-cloud.screen-route-value') }}
        </dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.camera-model') }}
        </dt>
        <dd min-w-0 break-all font-mono>
          qwen3.5-omni-flash-realtime
        </dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.output') }}
        </dt>
        <dd>{{ t('tamagotchi.stage.perception-cloud.text-only-manual') }}</dd>
        <dt text-neutral-500>
          {{ t('tamagotchi.stage.perception-cloud.retention') }}
        </dt>
        <dd>{{ t('tamagotchi.stage.perception-cloud.retention-value') }}</dd>
      </dl>
    </div>

    <div mt-4>
      <h3 text-xs text-neutral-500 font-semibold uppercase>
        {{ t('tamagotchi.stage.perception-cloud.budget-title') }}
      </h3>
      <div grid grid-cols-3 mt-2 divide-x divide-neutral-200 dark:divide-neutral-800>
        <div v-for="budget in budgets" :key="budget.id" px-2 text-center first:pl-0 last:pr-0>
          <div text-xs text-neutral-500>
            {{ t(`tamagotchi.stage.perception-cloud.budget.${budget.id}`) }}
          </div>
          <div mt-1 text-sm font-medium>
            ¥{{ budget.spent.toFixed(2) }} / ¥{{ budget.limit.toFixed(2) }}
          </div>
        </div>
      </div>
    </div>

    <div mt-5 flex justify-end gap-2>
      <button
        type="button"
        border border-neutral-300 rounded-lg px-3 py-2 text-sm disabled:cursor-wait dark:border-neutral-700 disabled:opacity-50
        :disabled="loading"
        @click="emit('validate')"
      >
        {{ t('tamagotchi.stage.perception-cloud.validate') }}
      </button>
      <button
        type="button"
        border border-red-400 rounded-lg px-3 py-2 text-sm text-red-700 disabled:cursor-wait dark:text-red-300 disabled:opacity-50
        :disabled="loading || status?.state === 'stopped'"
        @click="emit('stop')"
      >
        {{ t('tamagotchi.stage.perception-cloud.stop') }}
      </button>
    </div>
  </section>
</template>
