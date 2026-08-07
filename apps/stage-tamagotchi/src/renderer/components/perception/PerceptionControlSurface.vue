<script setup lang="ts">
import type { PerceptionSourceKind } from '../../../shared/perceptionDeepLink'

import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import CloudPerceptionPolicyPanel from './CloudPerceptionPolicyPanel.vue'
import LocalCameraPerceptionPanel from './LocalCameraPerceptionPanel.vue'
import LocalScreenPerceptionPanel from './LocalScreenPerceptionPanel.vue'
import MinecraftPerceptionPanel from './MinecraftPerceptionPanel.vue'

import {
  pairingRequestQueryParam,
  perceptionSourceQueryParam,
  resolvePerceptionSourceKind,
} from '../../../shared/perceptionDeepLink'
import { useLocalCameraPerception } from '../../composables/perception/use-local-camera-perception'
import { useLocalScreenPerception } from '../../composables/perception/use-local-screen-perception'
import { useMinecraftPerception } from '../../composables/perception/use-minecraft-perception'
import { useQwenCloudControl } from '../../composables/perception/use-qwen-cloud-control'
import { useQwenCloudPerception } from '../../composables/perception/use-qwen-cloud-perception'

const emit = defineEmits<{ started: [] }>()
const perception = useLocalScreenPerception()
const cameraPerception = useLocalCameraPerception()
const minecraftPerception = useMinecraftPerception()
const qwenCloudControl = useQwenCloudControl()
const qwenCloudPerception = useQwenCloudPerception()
const minecraftStore = minecraftPerception.store
const { t } = useI18n()
const route = useRoute()
const selectedSourceId = shallowRef('')
const consentConfirmed = shallowRef(false)
const cameraConsentConfirmed = shallowRef(false)
// Out-of-band surfaces (the pairing notification) deep-link here with the tab
// they need. The main stage window renders the same surface without any query,
// so an absent or unknown value keeps the previous default.
const activeSourceKind = shallowRef<PerceptionSourceKind>(
  resolvePerceptionSourceKind(route.query[perceptionSourceQueryParam]) ?? 'screen',
)
const isPausingAll = shallowRef(false)
const cloudValidationCompleted = shallowRef(false)
const cloudScreenSourceId = shallowRef('')
const cloudScreenFrameConsentConfirmed = shallowRef(false)
const cloudScreenAudioConsentConfirmed = shallowRef(false)
const cloudCameraFrameConsentConfirmed = shallowRef(false)
const cloudCameraAudioConsentConfirmed = shallowRef(false)
const hasActiveSources = computed(() => perception.status.value.state === 'running'
  || cameraPerception.status.value.state === 'running'
  || qwenCloudPerception.screenStatus.value.captureState === 'running'
  || qwenCloudPerception.cameraStatus.value.captureState === 'running'
  || (minecraftStore.perceptionEnabled && !minecraftStore.perceptionPaused))

onMounted(() => {
  void perception.refreshSources()
})

watch(() => perception.status.value.state, (state) => {
  if (state === 'idle' || state === 'failed')
    consentConfirmed.value = false
})

watch(() => cameraPerception.status.value.state, (state) => {
  if (state === 'idle' || state === 'failed')
    cameraConsentConfirmed.value = false
})

watch(() => [qwenCloudPerception.screenStatus.value.captureState, qwenCloudPerception.screenStatus.value.state] as const, ([captureState, state]) => {
  if (captureState === 'idle' || captureState === 'paused' || captureState === 'failed' || state === 'stopping' || state === 'failed')
    clearCloudScreenConsent()
})

watch(() => [qwenCloudPerception.cameraStatus.value.captureState, qwenCloudPerception.cameraStatus.value.state] as const, ([captureState, state]) => {
  if (captureState === 'idle' || captureState === 'paused' || captureState === 'failed' || state === 'stopping' || state === 'failed')
    clearCloudCameraConsent()
})

// A deep link that arrives while this surface is already mounted must still move
// the tab. Deliberately not `immediate`: the initial value is applied once above,
// so only a *new* deep link overrides a tab the user picked manually. The pairing
// request id is part of the key because two notifications for different requests
// otherwise produce the same query and would not trigger navigation at all.
watch(
  () => [route.query[perceptionSourceQueryParam], route.query[pairingRequestQueryParam]],
  ([source]) => {
    const kind = resolvePerceptionSourceKind(source)
    if (kind)
      selectSourceKind(kind)
  },
)

async function startScreen(sourceId: string, confirmed: boolean): Promise<void> {
  await perception.start(sourceId, confirmed)
  if (perception.status.value.state === 'running')
    emit('started')
}

async function startCamera(confirmed: boolean): Promise<void> {
  await cameraPerception.start(confirmed)
  if (cameraPerception.status.value.state === 'running')
    emit('started')
}

async function stopScreen(): Promise<void> {
  await perception.stop()
  consentConfirmed.value = false
}

async function stopCamera(): Promise<void> {
  await cameraPerception.stop()
  cameraConsentConfirmed.value = false
}

function clearCloudScreenConsent(): void {
  cloudScreenFrameConsentConfirmed.value = false
  cloudScreenAudioConsentConfirmed.value = false
}

function clearCloudCameraConsent(): void {
  cloudCameraFrameConsentConfirmed.value = false
  cloudCameraAudioConsentConfirmed.value = false
}

async function pauseCloudScreen(): Promise<void> {
  clearCloudScreenConsent()
  try {
    await qwenCloudPerception.pauseScreen()
  }
  finally {
    clearCloudScreenConsent()
  }
}

async function stopCloudScreen(): Promise<void> {
  clearCloudScreenConsent()
  try {
    await qwenCloudPerception.stopScreen()
  }
  finally {
    clearCloudScreenConsent()
  }
}

async function pauseCloudCamera(): Promise<void> {
  clearCloudCameraConsent()
  try {
    await qwenCloudPerception.pauseCamera()
  }
  finally {
    clearCloudCameraConsent()
  }
}

async function stopCloudCamera(): Promise<void> {
  clearCloudCameraConsent()
  try {
    await qwenCloudPerception.stopCamera()
  }
  finally {
    clearCloudCameraConsent()
  }
}

function selectSourceKind(kind: PerceptionSourceKind): void {
  activeSourceKind.value = kind
  if (kind === 'screen' && perception.sources.value.length === 0)
    void perception.refreshSources()
  if (kind === 'cloud' && qwenCloudPerception.screenSources.value.length === 0)
    void qwenCloudPerception.refreshScreenSources()
}

async function pauseAll(): Promise<void> {
  if (isPausingAll.value)
    return

  isPausingAll.value = true
  try {
    const pending: Promise<void>[] = []
    if (perception.status.value.state === 'running')
      pending.push(perception.pause())
    if (cameraPerception.status.value.state === 'running')
      pending.push(cameraPerception.pause())
    if (qwenCloudPerception.screenStatus.value.captureState === 'running')
      pending.push(pauseCloudScreen())
    if (qwenCloudPerception.cameraStatus.value.captureState === 'running')
      pending.push(pauseCloudCamera())
    if (minecraftStore.perceptionEnabled && !minecraftStore.perceptionPaused)
      pending.push(minecraftPerception.pause())
    await Promise.all(pending)
  }
  finally {
    isPausingAll.value = false
  }
}

async function refreshCloud(): Promise<void> {
  cloudValidationCompleted.value = false
  await qwenCloudControl.refresh()
}

async function validateCloud(): Promise<void> {
  cloudValidationCompleted.value = false
  await qwenCloudControl.validate()
  cloudValidationCompleted.value = qwenCloudControl.lastErrorCode.value === undefined
}

async function stopCloud(): Promise<void> {
  cloudValidationCompleted.value = false
  clearCloudScreenConsent()
  clearCloudCameraConsent()
  await Promise.allSettled([
    qwenCloudPerception.stopScreen(),
    qwenCloudPerception.stopCamera(),
  ])
  await qwenCloudControl.stop()
}
</script>

<template>
  <div>
    <div v-if="hasActiveSources" class="mb-2 flex justify-end">
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs text-white shadow-lg disabled:cursor-wait disabled:opacity-60"
        :disabled="isPausingAll"
        @click="pauseAll"
      >
        <span i-solar:pause-circle-outline size-4 />
        {{ t('tamagotchi.stage.perception-control.pause-all') }}
      </button>
    </div>
    <nav class="grid grid-cols-4 mb-2 rounded-lg bg-white/95 p-1 text-xs shadow-lg backdrop-blur-xl dark:bg-neutral-900/95">
      <button type="button" class="flex-1 rounded-lg px-3 py-2" :class="activeSourceKind === 'screen' ? 'bg-cyan-500 text-white' : 'text-neutral-600 dark:text-neutral-300'" @click="selectSourceKind('screen')">
        {{ t('tamagotchi.stage.perception-screen.tab') }}
      </button>
      <button type="button" class="flex-1 rounded-lg px-3 py-2" :class="activeSourceKind === 'camera' ? 'bg-emerald-500 text-white' : 'text-neutral-600 dark:text-neutral-300'" @click="selectSourceKind('camera')">
        {{ t('tamagotchi.stage.perception-camera.tab') }}
      </button>
      <button type="button" class="flex-1 rounded-lg px-3 py-2" :class="activeSourceKind === 'minecraft' ? 'bg-lime-600 text-white' : 'text-neutral-600 dark:text-neutral-300'" @click="selectSourceKind('minecraft')">
        {{ t('tamagotchi.stage.perception-minecraft.tab') }}
      </button>
      <button type="button" class="flex-1 rounded-lg px-3 py-2" :class="activeSourceKind === 'cloud' ? 'bg-blue-600 text-white' : 'text-neutral-600 dark:text-neutral-300'" @click="selectSourceKind('cloud')">
        {{ t('tamagotchi.stage.perception-cloud.tab') }}
      </button>
    </nav>

    <LocalScreenPerceptionPanel
      v-if="activeSourceKind === 'screen'"
      v-model:selected-source-id="selectedSourceId"
      v-model:consent-confirmed="consentConfirmed"
      :sampling-rate="perception.samplingRate.value"
      :sources="perception.sources.value"
      :status="perception.status.value"
      :refreshing="perception.isRefreshingSources.value"
      :error-code="perception.uiErrorCode.value"
      :remote-statuses="perception.remoteStatuses.value"
      :observability="perception.observability.value"
      @refresh="perception.refreshSources"
      @start="startScreen"
      @pause="perception.pause"
      @stop="stopScreen"
      @toggle-sensitive-pause="perception.setSensitiveSurfacePaused"
      @confirm-fact="perception.confirmFact"
      @retract-fact="perception.retractFact"
      @clear-facts="perception.clearFacts"
      @update:sampling-rate="perception.setSamplingRate"
    />
    <LocalCameraPerceptionPanel
      v-else-if="activeSourceKind === 'camera'"
      v-model:consent-confirmed="cameraConsentConfirmed"
      :sampling-rate="cameraPerception.samplingRate.value"
      :status="cameraPerception.status.value"
      :remote-statuses="cameraPerception.remoteStatuses.value"
      :observability="cameraPerception.observability.value"
      @start="startCamera"
      @pause="cameraPerception.pause"
      @stop="stopCamera"
      @confirm-fact="cameraPerception.confirmFact"
      @retract-fact="cameraPerception.retractFact"
      @clear-facts="cameraPerception.clearFacts"
      @update:sampling-rate="cameraPerception.setSamplingRate"
    />
    <MinecraftPerceptionPanel v-else-if="activeSourceKind === 'minecraft'" />
    <CloudPerceptionPolicyPanel
      v-else
      v-model:selected-screen-source-id="cloudScreenSourceId"
      v-model:screen-frame-consent-confirmed="cloudScreenFrameConsentConfirmed"
      v-model:screen-audio-consent-confirmed="cloudScreenAudioConsentConfirmed"
      v-model:camera-frame-consent-confirmed="cloudCameraFrameConsentConfirmed"
      v-model:camera-audio-consent-confirmed="cloudCameraAudioConsentConfirmed"
      :screen-sampling-rate="perception.samplingRate.value"
      :camera-sampling-rate="cameraPerception.samplingRate.value"
      :status="qwenCloudControl.status.value"
      :loading="qwenCloudControl.isLoading.value"
      :error-code="qwenCloudControl.lastErrorCode.value"
      :validation-completed="cloudValidationCompleted"
      :screen-status="qwenCloudPerception.screenStatus.value"
      :screen-sources="qwenCloudPerception.screenSources.value"
      :refreshing-screen-sources="qwenCloudPerception.isRefreshingSources.value"
      :camera-status="qwenCloudPerception.cameraStatus.value"
      @refresh="refreshCloud"
      @validate="validateCloud"
      @stop="stopCloud"
      @refresh-screen-sources="qwenCloudPerception.refreshScreenSources"
      @start-screen="qwenCloudPerception.startScreen"
      @pause-screen="pauseCloudScreen"
      @stop-screen="stopCloudScreen"
      @start-camera="qwenCloudPerception.startCamera"
      @pause-camera="pauseCloudCamera"
      @stop-camera="stopCloudCamera"
      @camera-privacy-mode="qwenCloudPerception.setCameraPrivacyMode"
      @update:screen-sampling-rate="perception.setSamplingRate"
      @update:camera-sampling-rate="cameraPerception.setSamplingRate"
    />
  </div>
</template>
