import type { PerceptionContextProjection, PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'
import type { ComputedRef, InjectionKey } from 'vue'

import type { ProductionScreenSource } from '../../services/perception/production-screen-capture'
import type { QwenCloudCameraStatus } from '../../services/perception/qwen-cloud-camera-coordinator'
import type { QwenCloudScreenStatus } from '../../services/perception/qwen-cloud-screen-coordinator'
import type { LocalCameraPerceptionContext } from './use-local-camera-perception'
import type { PerceptionSamplingSettings } from './use-perception-sampling-settings'
import type { QwenCloudControlContext } from './use-qwen-cloud-control'

import { defaultPerceptionSamplingRate } from '@proj-airi/stage-ui/domains/perception'
import {
  createVoicePlaybackEchoGateState,
  isVoicePlaybackEchoBlocked,
  updateVoicePlaybackEchoGate,
} from '@proj-airi/stage-ui/domains/voiceConversation'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { createPerceptionContextMessage } from '@proj-airi/stage-ui/stores/chat/context-providers'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { computed, inject, onScopeDispose, provide, shallowRef, watch } from 'vue'

import { productionPerceptionOwnerProvider } from '../../services/perception/production-perception-owner'
import { createGenerationScopedLocalCameraLease, QwenCloudCameraCoordinator } from '../../services/perception/qwen-cloud-camera-coordinator'
import { acquireAbortableCloudMicrophone, QwenCloudScreenCoordinator } from '../../services/perception/qwen-cloud-screen-coordinator'
import { createPerceptionSamplingSettings } from './use-perception-sampling-settings'

const CLOUD_SCREEN_CONTEXT_SOURCE_ID = 'system:trusted-perception:screen-cloud'
const CLOUD_CAMERA_CONTEXT_SOURCE_ID = 'system:trusted-perception:camera-cloud'

export interface QwenCloudPerceptionContext {
  screenStatus: ComputedRef<QwenCloudScreenStatus>
  screenSources: ComputedRef<readonly ProductionScreenSource[]>
  isRefreshingSources: ComputedRef<boolean>
  observability: ComputedRef<PerceptionObservabilitySnapshot | null>
  cameraStatus: ComputedRef<QwenCloudCameraStatus>
  cameraObservability: ComputedRef<PerceptionObservabilitySnapshot | null>
  refreshScreenSources: () => Promise<void>
  startScreen: (sourceId: string, frameConsentConfirmed: boolean, audioConsentConfirmed: boolean) => Promise<void>
  pauseScreen: () => Promise<void>
  stopScreen: () => Promise<void>
  startCamera: (frameConsentConfirmed: boolean, audioConsentConfirmed: boolean) => Promise<void>
  pauseCamera: () => Promise<void>
  stopCamera: () => Promise<void>
  setCameraPrivacyMode: (enabled: boolean) => void
}

const qwenCloudPerceptionKey: InjectionKey<QwenCloudPerceptionContext> = Symbol('qwen-cloud-perception')

export function provideQwenCloudPerception(
  control: QwenCloudControlContext,
  localCamera: LocalCameraPerceptionContext,
  options: { samplingSettings?: PerceptionSamplingSettings } = {},
): QwenCloudPerceptionContext {
  const samplingSettings = options.samplingSettings ?? createPerceptionSamplingSettings()
  const audioDevices = useSettingsAudioDevice()
  const speaking = useSpeakingStore()
  const voiceConversation = useVoiceConversationStore()
  const chatContext = useChatContextStore()
  const screenStatus = shallowRef<QwenCloudScreenStatus>(initialStatus())
  const screenSources = shallowRef<ProductionScreenSource[]>([])
  const isRefreshingSources = shallowRef(false)
  const observability = shallowRef<PerceptionObservabilitySnapshot | null>(null)
  const cameraStatus = shallowRef<QwenCloudCameraStatus>(initialCameraStatus())
  const cameraObservability = shallowRef<PerceptionObservabilitySnapshot | null>(null)
  const echoGate = shallowRef(createVoicePlaybackEchoGateState())
  let projectionTimer: ReturnType<typeof setTimeout> | undefined

  watch([() => speaking.nowSpeaking, () => voiceConversation.state], ([audiblePlayback, state]) => {
    echoGate.value = updateVoicePlaybackEchoGate(echoGate.value, {
      audiblePlayback,
      voiceConversationState: state,
    })
  }, { immediate: true })

  function syncProjection(projection: PerceptionContextProjection | null): void {
    if (projectionTimer)
      clearTimeout(projectionTimer)
    projectionTimer = undefined
    if (!projection) {
      chatContext.retractContextSource(CLOUD_SCREEN_CONTEXT_SOURCE_ID)
      return
    }
    chatContext.ingestContextMessage(createPerceptionContextMessage(projection, CLOUD_SCREEN_CONTEXT_SOURCE_ID))
    projectionTimer = setTimeout(() => chatContext.retractContextSource(CLOUD_SCREEN_CONTEXT_SOURCE_ID), Math.max(0, projection.expiresAt - Date.now()))
  }

  let cameraProjectionTimer: ReturnType<typeof setTimeout> | undefined
  function syncCameraProjection(projection: PerceptionContextProjection | null): void {
    if (cameraProjectionTimer)
      clearTimeout(cameraProjectionTimer)
    cameraProjectionTimer = undefined
    if (!projection) {
      chatContext.retractContextSource(CLOUD_CAMERA_CONTEXT_SOURCE_ID)
      return
    }
    chatContext.ingestContextMessage(createPerceptionContextMessage(projection, CLOUD_CAMERA_CONTEXT_SOURCE_ID))
    cameraProjectionTimer = setTimeout(() => chatContext.retractContextSource(CLOUD_CAMERA_CONTEXT_SOURCE_ID), Math.max(0, projection.expiresAt - Date.now()))
  }

  const coordinator = new QwenCloudScreenCoordinator({
    ownerProvider: productionPerceptionOwnerProvider,
    acquireMicrophone: (grant, signal) => acquireAbortableCloudMicrophone(audioDevices.acquirePerceptionStream(grant), signal),
    isAudioAllowed: () => !isVoicePlaybackEchoBlocked(echoGate.value),
    samplingRate: samplingSettings.screen.value,
    onStatus: status => screenStatus.value = status,
    onProjection: syncProjection,
    onObservability: snapshot => observability.value = snapshot,
  })
  const cameraCoordinator = new QwenCloudCameraCoordinator({
    getLocalStatus: () => localCamera.status.value,
    startLocalMixed: async (signal) => {
      await localCamera.startMixed(true, signal)
      const status = localCamera.status.value
      if (status.state !== 'running' || status.processingMode !== 'mixed' || !status.sessionId || status.generation < 1)
        throw new Error('cloud-camera-local-lane-unavailable')
      const lease = createGenerationScopedLocalCameraLease({
        sessionId: status.sessionId,
        generation: status.generation,
        getStatus: () => localCamera.status.value,
        stop: localCamera.stop,
      })
      if (signal.aborted) {
        await lease.release()
        throw new Error('cloud-camera-local-start-cancelled')
      }
      return lease
    },
    stopLocalGeneration: async (sessionId, generation) => {
      await createGenerationScopedLocalCameraLease({
        sessionId,
        generation,
        getStatus: () => localCamera.status.value,
        stop: localCamera.stop,
      }).release()
    },
    subscribeFrames: localCamera.subscribeFrames,
    acquireMicrophone: (grant, signal) => acquireAbortableCloudMicrophone(audioDevices.acquirePerceptionStream(grant), signal),
    getPersonPresent: () => localCamera.observability.value?.facts.some(fact => fact.state === 'accepted' && fact.category === 'person.presence' && fact.safeValue === true) === true,
    isAudioAllowed: () => !isVoicePlaybackEchoBlocked(echoGate.value),
    samplingRate: samplingSettings.camera.value,
    onStatus: status => cameraStatus.value = status,
    onProjection: syncCameraProjection,
    onObservability: snapshot => cameraObservability.value = snapshot,
  })
  const stopScreenSamplingWatch = watch(samplingSettings.screen, rate => coordinator.setSamplingRate(rate))
  const stopCameraSamplingWatch = watch(samplingSettings.camera, rate => cameraCoordinator.setSamplingRate(rate))

  watch(() => localCamera.status.value, (status) => {
    if (cameraStatus.value.captureState !== 'running')
      return
    if (!cameraCoordinator.isUsingLocalStatus(status))
      void cameraCoordinator.stop('source-ended')
  })

  async function refreshScreenSources(): Promise<void> {
    if (isRefreshingSources.value)
      return
    isRefreshingSources.value = true
    try {
      screenSources.value = await coordinator.listSources()
    }
    finally {
      isRefreshingSources.value = false
    }
  }

  async function startScreen(sourceId: string, frameConsentConfirmed: boolean, audioConsentConfirmed: boolean): Promise<void> {
    if (control.status.value?.state !== 'ready') {
      screenStatus.value = { ...screenStatus.value, state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-readiness-blocked' }
      return
    }
    await coordinator.start(sourceId, frameConsentConfirmed, audioConsentConfirmed)
  }

  async function startCamera(frameConsentConfirmed: boolean, audioConsentConfirmed: boolean): Promise<void> {
    if (control.status.value?.state !== 'ready') {
      cameraStatus.value = { ...cameraStatus.value, state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-readiness-blocked' }
      return
    }
    await cameraCoordinator.start(frameConsentConfirmed, audioConsentConfirmed)
  }

  const context: QwenCloudPerceptionContext = {
    screenStatus: computed(() => screenStatus.value),
    screenSources: computed(() => screenSources.value as readonly ProductionScreenSource[]),
    isRefreshingSources: computed(() => isRefreshingSources.value),
    observability: computed(() => observability.value),
    cameraStatus: computed(() => cameraStatus.value),
    cameraObservability: computed(() => cameraObservability.value),
    refreshScreenSources,
    startScreen,
    pauseScreen: () => coordinator.pause(),
    stopScreen: () => coordinator.stop(),
    startCamera,
    pauseCamera: () => cameraCoordinator.pause(),
    stopCamera: () => cameraCoordinator.stop(),
    setCameraPrivacyMode: enabled => cameraCoordinator.setPrivacyMode(enabled),
  }
  provide(qwenCloudPerceptionKey, context)
  onScopeDispose(() => {
    if (projectionTimer)
      clearTimeout(projectionTimer)
    if (cameraProjectionTimer)
      clearTimeout(cameraProjectionTimer)
    chatContext.retractContextSource(CLOUD_SCREEN_CONTEXT_SOURCE_ID)
    chatContext.retractContextSource(CLOUD_CAMERA_CONTEXT_SOURCE_ID)
    stopScreenSamplingWatch()
    stopCameraSamplingWatch()
    void coordinator.stop('unmount')
    void cameraCoordinator.stop('unmount')
  })
  return context
}

function initialCameraStatus(): QwenCloudCameraStatus {
  return {
    state: 'idle',
    captureState: 'idle',
    generation: 0,
    uploadActive: false,
    acceptedAudioChunks: 0,
    droppedAudioChunks: 0,
    submittedWindows: 0,
    completedWindows: 0,
    droppedFrames: 0,
    acceptedFactCount: 0,
    resolution: '640x360',
    privacyMode: false,
    samplingRate: defaultPerceptionSamplingRate('camera'),
  }
}

export function useQwenCloudPerception(): QwenCloudPerceptionContext {
  const context = inject(qwenCloudPerceptionKey)
  if (!context)
    throw new Error('qwen_cloud_perception_not_provided')
  return context
}

function initialStatus(): QwenCloudScreenStatus {
  return {
    state: 'idle',
    captureState: 'idle',
    generation: 0,
    uploadActive: false,
    acceptedAudioChunks: 0,
    droppedAudioChunks: 0,
    submittedWindows: 0,
    completedWindows: 0,
    droppedFrames: 0,
    acceptedFactCount: 0,
    samplingRate: defaultPerceptionSamplingRate('screen'),
  }
}
