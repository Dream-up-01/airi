<script setup lang="ts">
import type { ModelSettingsRuntimeSnapshot } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import type { AsrTranscriptAccumulator, VoiceConversationCancelReason, VoiceConversationErrorCode } from '@proj-airi/stage-ui/domains/voiceConversation'

import type { ModelSettingsRuntimeChannelEvent } from '../../shared/model-settings-runtime'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { tryCatch } from '@moeru/std'
import { toWav } from '@proj-airi/audio'
import { electron } from '@proj-airi/electron-eventa'
import {
  useElectronEventaInvoke,
  useElectronMouseAroundWindowBorder,
  useElectronMouseInElement,
  useElectronMouseInWindow,
  useElectronRelativeMouse,
} from '@proj-airi/electron-vueuse'
import { IS_DEV } from '@proj-airi/stage-shared'
import { useModelStore, useThreeSceneIsTransparentAtPoint } from '@proj-airi/stage-ui-three'
import { HoloCoupon } from '@proj-airi/stage-ui/components'
import {
  createEmptyModelSettingsRuntimeSnapshot,
  resolveComponentStateToRuntimePhase,
} from '@proj-airi/stage-ui/components/scenarios/settings/model-settings/runtime'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useCanvasPixelIsTransparentAtPoint } from '@proj-airi/stage-ui/composables/canvas-alpha'
import { recoverSpeechOutputProfile } from '@proj-airi/stage-ui/domains/speechRouting'
import {
  createAsrTranscriptAccumulator,
  createVoicePlaybackEchoGateState,
  isVoicePlaybackEchoBlocked,
  normalizeAsrTranscript,
  reduceAsrTranscriptSegment,
  releaseVoicePlaybackEchoGateForUserInterrupt,
  resolveVoiceConversationSetupIssue,
  updateVoicePlaybackEchoGate,
  voicePlaybackEchoBlockRemainingMs,
} from '@proj-airi/stage-ui/domains/voiceConversation'
import { extractMessageText } from '@proj-airi/stage-ui/libs/chat-sync/wire-message'
import {
  onVoiceRuntimeDiagnosticsRequested,
  publishVoiceRuntimeDiagnostics,
} from '@proj-airi/stage-ui/services/voice-runtime-diagnostics'
import { onVoiceSettingsChanged } from '@proj-airi/stage-ui/services/voice-settings-sync'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import {
  GPT_SOVITS_LOCAL_PROVIDER_ID,
  QWEN3_ASR_LOCAL_PROVIDER_ID,
  SENSEVOICE_LOCAL_DEFAULT_MODEL,
  SENSEVOICE_LOCAL_PROVIDER_ID,
  useProvidersStore,
} from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'
import { useSpeechOutputRoutingStore } from '@proj-airi/stage-ui/stores/speech-output-routing'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { useVoiceConversationPreferencesStore } from '@proj-airi/stage-ui/stores/voiceConversationPreferences'
import { useVoiceConversationRecoveryDraftStore } from '@proj-airi/stage-ui/stores/voiceConversationRecoveryDraft'
import { useVoiceStyleRuntimeStore } from '@proj-airi/stage-ui/stores/voiceStyleRuntime'
import { refDebounced, useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, shallowRef, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlsIsland from '../components/stage-islands/controls-island/index.vue'
import ResourceStatusIsland from '../components/stage-islands/resource-status-island/index.vue'
import StatusIsland from '../components/stage-islands/status-island/index.vue'
import VoiceRecoveryDraftPanel from '../components/voice/VoiceRecoveryDraftPanel.vue'

import { electronOpenOnboarding, electronOpenSettings } from '../../shared/eventa'
import { modelSettingsRuntimeSnapshotChannelName } from '../../shared/model-settings-runtime'
import { useChatSyncStore } from '../stores/chat-sync'
import { useControlsIslandStore } from '../stores/controls-island'
import { useStageWindowLifecycleStore } from '../stores/stage-window-lifecycle'
import { shouldSampleStageTransparency } from '../utils/stage-three-transparency'

const controlsIslandRef = ref<InstanceType<typeof ControlsIsland>>()
const statusIslandRef = ref<InstanceType<typeof StatusIsland>>()
const voiceStatusRef = ref<HTMLElement>()
const widgetStageRef = ref<InstanceType<typeof WidgetStage>>()
const stageCanvas = toRef(() => widgetStageRef.value?.canvasElement())
const componentStateStage = ref<'pending' | 'loading' | 'mounted'>('pending')
const stageMounted = computed(() => componentStateStage.value === 'mounted')
const isLoading = computed(() => !stageMounted.value)

const isIgnoringMouseEvents = ref(false)
const shouldFadeOnCursorWithin = ref(false)
const { t } = useI18n()

const onboardingStore = useOnboardingStore()
const openOnboarding = useElectronEventaInvoke(electronOpenOnboarding)
const openSettings = useElectronEventaInvoke(electronOpenSettings)

const { isOutside: isOutsideWindow } = useElectronMouseInWindow()
const { isOutside } = useElectronMouseInElement(controlsIslandRef)
const { isOutside: isOutsideStatusIsland } = useElectronMouseInElement(statusIslandRef)
const { isOutside: isOutsideVoiceStatus } = useElectronMouseInElement(voiceStatusRef)
const isOutsideFor250Ms = refDebounced(isOutside, 250)
const isOutsideStatusIslandFor250Ms = refDebounced(isOutsideStatusIsland, 250)

function safeRuntimeErrorName(error: unknown) {
  if (error instanceof Error)
    return error.name || 'Error'
  return typeof error === 'string' ? 'StringError' : 'UnknownError'
}
const { x: relativeMouseX, y: relativeMouseY } = useElectronRelativeMouse()
// NOTICE: In real-world use cases of Fade on Hover feature, the cursor may move around the edge of the
// model rapidly, causing flickering effects when checking pixel transparency strictly.
// Here we use render-target pixel sampling to keep detection aligned with the actual render output.
const isTransparentByPixels = useCanvasPixelIsTransparentAtPoint(
  stageCanvas,
  relativeMouseX,
  relativeMouseY,
  { regionRadius: 25 },
)
const isTransparentByThree = useThreeSceneIsTransparentAtPoint(
  widgetStageRef,
  relativeMouseX,
  relativeMouseY,
  { regionRadius: 25 },
)

const settingsStore = useSettings()
const { stageModelRenderer, stageModelSelectedUrl } = storeToRefs(settingsStore)
const modelStore = useModelStore()
const { sceneMutationLocked, scenePhase } = storeToRefs(modelStore)
const { stagePaused } = storeToRefs(useStageWindowLifecycleStore())
const { fadeOnHoverEnabled } = storeToRefs(useControlsIslandStore())
const modelSettingsRuntimeOwnerInstanceId = `tamagotchi-main-stage:${Math.random().toString(36).slice(2, 10)}`
const { data: modelSettingsRuntimeChannelEvent, post: postModelSettingsRuntimeChannelEvent } = useBroadcastChannel<ModelSettingsRuntimeChannelEvent, ModelSettingsRuntimeChannelEvent>({ name: modelSettingsRuntimeSnapshotChannelName })
const shouldUseThreeTransparencyHitTest = computed(() => shouldSampleStageTransparency({
  componentState: componentStateStage.value,
  fadeOnHoverEnabled: fadeOnHoverEnabled.value,
  stageModelRenderer: stageModelRenderer.value,
  stagePaused: stagePaused.value,
}))
const isTransparent = computed(() => {
  if (stagePaused.value || componentStateStage.value !== 'mounted' || !fadeOnHoverEnabled.value)
    return true

  if (stageModelRenderer.value === 'vrm')
    return shouldUseThreeTransparencyHitTest.value ? isTransparentByThree.value : true

  if (stageModelRenderer.value === 'live2d')
    return isTransparentByPixels.value

  return true
})

const { isNearAnyBorder: isAroundWindowBorder } = useElectronMouseAroundWindowBorder({ threshold: 10 })
const isAroundWindowBorderFor250Ms = refDebounced(isAroundWindowBorder, 250)

const setIgnoreMouseEvents = useElectronEventaInvoke(electron.window.setIgnoreMouseEvents)

const { pause, resume } = watch(isTransparent, (transparent) => {
  shouldFadeOnCursorWithin.value = fadeOnHoverEnabled.value && !transparent
}, { immediate: true })

const hearingDialogOpen = computed(() => controlsIslandRef.value?.hearingDialogOpen ?? false)

const modelSettingsRuntimeSnapshot = computed<ModelSettingsRuntimeSnapshot>(() => {
  const hasModel = !!stageModelSelectedUrl.value

  if (stageModelRenderer.value === 'live2d') {
    const phase = resolveComponentStateToRuntimePhase(componentStateStage.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
      renderer: 'live2d',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'vrm') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
      renderer: 'vrm',
      phase: hasModel ? scenePhase.value : 'no-model',
      controlsLocked: hasModel
        ? (!stageMounted.value || sceneMutationLocked.value)
        : false,
      previewAvailable: hasModel,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'spine') {
    const phase = resolveComponentStateToRuntimePhase(componentStateStage.value, { hasModel })

    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
      renderer: 'spine',
      phase,
      controlsLocked: hasModel ? phase !== 'mounted' : false,
      previewAvailable: hasModel,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  if (stageModelRenderer.value === 'godot') {
    return createEmptyModelSettingsRuntimeSnapshot({
      ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
      renderer: 'godot',
      phase: hasModel ? 'mounted' : 'no-model',
      controlsLocked: false,
      previewAvailable: false,
      canCapturePreview: false,
      updatedAt: Date.now(),
    })
  }

  return createEmptyModelSettingsRuntimeSnapshot({
    ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
    updatedAt: Date.now(),
  })
})

watch([isOutsideFor250Ms, isOutsideStatusIslandFor250Ms, isOutsideVoiceStatus, isAroundWindowBorderFor250Ms, isOutsideWindow, isTransparent, hearingDialogOpen, fadeOnHoverEnabled, stagePaused], () => {
  if (stagePaused.value) {
    isIgnoringMouseEvents.value = false
    shouldFadeOnCursorWithin.value = false
    setIgnoreMouseEvents([false, { forward: true }])
    pause()
    return
  }

  if (hearingDialogOpen.value) {
    // Hearing dialog/drawer is open; keep window interactive
    isIgnoringMouseEvents.value = false
    shouldFadeOnCursorWithin.value = false
    setIgnoreMouseEvents([false, { forward: true }])
    pause()
    return
  }

  // The voice interruption control is time-sensitive. Electron forwards the
  // first pointer move while click-through is enabled; react to that move
  // immediately so a normal move-and-click cannot pass through the window.
  const insideControls = !isOutsideFor250Ms.value || !isOutsideStatusIslandFor250Ms.value || !isOutsideVoiceStatus.value
  const nearBorder = isAroundWindowBorderFor250Ms.value

  if (insideControls || nearBorder) {
    // Inside interactive controls or near resize border: do NOT ignore events
    isIgnoringMouseEvents.value = false
    shouldFadeOnCursorWithin.value = false
    setIgnoreMouseEvents([false, { forward: true }])
    pause()
  }
  else {
    const fadeEnabled = fadeOnHoverEnabled.value
    // Otherwise allow click-through while we fade UI based on transparency (when enabled)
    isIgnoringMouseEvents.value = fadeEnabled
    shouldFadeOnCursorWithin.value = fadeEnabled && !isOutsideWindow.value && !isTransparent.value
    setIgnoreMouseEvents([fadeEnabled, { forward: true }])
    if (fadeEnabled)
      resume()
    else
      pause()
  }
})

// Emit runtime snapshot on change and on request from settings panel
watch(modelSettingsRuntimeSnapshot, (snapshot) => {
  postModelSettingsRuntimeChannelEvent({ type: 'snapshot', snapshot })
}, { immediate: true })

watch(modelSettingsRuntimeChannelEvent, (event) => {
  if (event?.type !== 'request-current')
    return

  postModelSettingsRuntimeChannelEvent({ type: 'snapshot', snapshot: modelSettingsRuntimeSnapshot.value })
})

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { stream, enabled, microphonePermission } = storeToRefs(settingsAudioDeviceStore)
const { askPermission } = settingsAudioDeviceStore
const hearingStore = useHearingStore()
const {
  activeTranscriptionModel,
  activeTranscriptionProvider,
  configured: hearingConfigured,
} = storeToRefs(hearingStore)

// Qwen3-ASR and GPT-SoVITS are deliberately session-activated. A marker in
// sessionStorage prevents renderer reloads from undoing a choice made during
// the current desktop session while still restoring cold-start defaults after
// the Electron window is recreated.
const localVoiceStartupDefaultsMarker = 'airi/local-voice-startup-defaults-applied'
const shouldApplyLocalVoiceStartupDefaults = sessionStorage.getItem(localVoiceStartupDefaultsMarker) !== 'true'
if (shouldApplyLocalVoiceStartupDefaults && activeTranscriptionProvider.value === QWEN3_ASR_LOCAL_PROVIDER_ID) {
  activeTranscriptionProvider.value = SENSEVOICE_LOCAL_PROVIDER_ID
  activeTranscriptionModel.value = SENSEVOICE_LOCAL_DEFAULT_MODEL
  hearingStore.activeCustomModelName = SENSEVOICE_LOCAL_DEFAULT_MODEL
}
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForRecording, transcribeForMediaStream, stopStreamingTranscription } = hearingPipeline
const { error: hearingError, finalizesOnVadEnd, supportsStreamInput } = storeToRefs(hearingPipeline)
const consciousnessStore = useConsciousnessStore()
const {
  configured: chatConfigured,
} = storeToRefs(consciousnessStore)
const speechStore = useSpeechStore()
const {
  activeSpeechModel,
  activeSpeechProvider,
  activeSpeechVoiceId,
  configured: speechConfigured,
} = storeToRefs(speechStore)
const speechOutputRoutingStore = useSpeechOutputRoutingStore()
const providersStore = useProvidersStore()
const activeSpeechProviderConfig = providersStore.getProviderConfig(activeSpeechProvider.value)
const recoveredVoiceOutputProfile = recoverSpeechOutputProfile({
  currentProfile: speechOutputRoutingStore.profileFor('voice-conversation').profile,
  activeSelection: {
    providerId: activeSpeechProvider.value,
    modelId: activeSpeechModel.value,
    voiceId: activeSpeechVoiceId.value,
  },
  providerDefaults: {
    providerId: activeSpeechProvider.value,
    modelId: typeof activeSpeechProviderConfig.model === 'string' ? activeSpeechProviderConfig.model : undefined,
    voiceId: typeof activeSpeechProviderConfig.voice === 'string' ? activeSpeechProviderConfig.voice : undefined,
  },
  // This local service is intentionally session-activated and must not be
  // resurrected from persisted defaults during a cold start.
  blockedProviderIds: [GPT_SOVITS_LOCAL_PROVIDER_ID],
})
if (recoveredVoiceOutputProfile
  && !speechOutputRoutingStore.profileFor('voice-conversation').profile) {
  activeSpeechModel.value = recoveredVoiceOutputProfile.modelId
  activeSpeechVoiceId.value = recoveredVoiceOutputProfile.voiceId
  speechOutputRoutingStore.setProfile('voice-conversation', recoveredVoiceOutputProfile)
}
const effectiveVoiceOutputProfile = computed(() => {
  const routedProfile = speechOutputRoutingStore.profileFor('voice-conversation').profile
  if (routedProfile)
    return routedProfile

  const configuredProfiles = speechOutputRoutingStore.profiles
  if (configuredProfiles.textChat || configuredProfiles.voiceConversation)
    return null

  if (!speechConfigured.value)
    return null

  return {
    providerId: activeSpeechProvider.value,
    modelId: activeSpeechModel.value,
    voiceId: activeSpeechVoiceId.value,
  }
})
const stopVoiceSettingsSync = onVoiceSettingsChanged((keys) => {
  for (const key of keys) {
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: localStorage.getItem(key),
      storageArea: localStorage,
    }))
  }
})
if (shouldApplyLocalVoiceStartupDefaults) {
  if (activeSpeechProvider.value === GPT_SOVITS_LOCAL_PROVIDER_ID) {
    activeSpeechProvider.value = 'speech-noop'
    activeSpeechModel.value = ''
    activeSpeechVoiceId.value = ''
    speechStore.activeSpeechVoice = undefined
  }

  if (speechOutputRoutingStore.profiles.textChat?.providerId === GPT_SOVITS_LOCAL_PROVIDER_ID)
    speechOutputRoutingStore.clearProfile('text-chat')
  if (speechOutputRoutingStore.profiles.voiceConversation?.providerId === GPT_SOVITS_LOCAL_PROVIDER_ID)
    speechOutputRoutingStore.clearProfile('voice-conversation')

  sessionStorage.setItem(localVoiceStartupDefaultsMarker, 'true')
}
const chatSyncStore = useChatSyncStore()
const chatSessionStore = useChatSessionStore()
const { activeSessionId: activeChatSessionId } = storeToRefs(chatSessionStore)
const voiceConversationStore = useVoiceConversationStore()
const voiceConversationPreferencesStore = useVoiceConversationPreferencesStore()
const { preferences: voiceConversationPreferences } = storeToRefs(voiceConversationPreferencesStore)
const voiceRecoveryDraftStore = useVoiceConversationRecoveryDraftStore()
const { draft: voiceRecoveryDraft } = storeToRefs(voiceRecoveryDraftStore)
const { latestResolution: latestVoiceStyleResolution } = storeToRefs(useVoiceStyleRuntimeStore())
const speechOutputControlStore = useSpeechOutputControlStore()
const { latestStopAcknowledgement } = storeToRefs(speechOutputControlStore)
const { nowSpeaking } = storeToRefs(useSpeakingStore())
const shouldUseStreamInput = computed(() => voiceConversationPreferences.value.mode === 'streaming-asr'
  && supportsStreamInput.value
  && !!stream.value)
const currentVoiceMode = computed(() => shouldUseStreamInput.value ? 'streaming-asr' : 'vad-turn-taking')
const voiceSetupIssue = computed(() => resolveVoiceConversationSetupIssue({
  hearingConfigured: hearingConfigured.value,
  chatConfigured: chatConfigured.value,
  speechConfigured: !!effectiveVoiceOutputProfile.value,
  requiresCloudPrivacyAcknowledgement: effectiveVoiceOutputProfile.value?.providerId === 'minimax-speech',
  cloudPrivacyAcknowledged: voiceConversationPreferences.value.cloudPrivacyAcknowledged,
}))
const voiceDiagnosticsSnapshot = computed(() => {
  const entries = voiceConversationStore.timeline
  const speechStart = entries.findLast(entry => entry.name === 'voice.vad.speech_start')
  const asrPartial = speechStart?.turnId
    ? entries.find(entry => entry.turnId === speechStart.turnId && entry.name === 'voice.asr.first_partial')
    : undefined
  const ttsRequest = entries.findLast(entry => entry.name === 'voice.tts.first_request')
  const ttsAudio = ttsRequest?.turnId
    ? entries.find(entry => entry.turnId === ttsRequest.turnId && entry.name === 'voice.tts.first_audio')
    : undefined

  return {
    inputProviderId: activeTranscriptionProvider.value || undefined,
    inputModelId: activeTranscriptionModel.value || undefined,
    inputSupportsStreaming: supportsStreamInput.value,
    outputProviderId: effectiveVoiceOutputProfile.value?.providerId,
    outputModelId: effectiveVoiceOutputProfile.value?.modelId,
    voiceId: effectiveVoiceOutputProfile.value?.voiceId,
    ttsCapability: effectiveVoiceOutputProfile.value?.providerId === 'minimax-speech' ? 'rest-aggregated' as const : 'not-declared' as const,
    lastErrorCode: voiceConversationStore.session?.lastErrorCode,
    asrFirstPartialLatencyMs: speechStart && asrPartial ? asrPartial.at - speechStart.at : undefined,
    ttsFirstAudioLatencyMs: ttsRequest && ttsAudio ? ttsAudio.at - ttsRequest.at : undefined,
    styleWarningCodes: latestVoiceStyleResolution.value?.warnings.map(warning => warning.code) ?? [],
    updatedAt: Date.now(),
  }
})
const stopVoiceDiagnosticsRequest = onVoiceRuntimeDiagnosticsRequested(() => {
  publishVoiceRuntimeDiagnostics(voiceDiagnosticsSnapshot.value)
})
watch(voiceDiagnosticsSnapshot, snapshot => publishVoiceRuntimeDiagnostics(snapshot), { deep: true, immediate: true })
const voiceProviderSnapshot = computed(() => ({
  inputProviderId: activeTranscriptionProvider.value || undefined,
  inputModelId: activeTranscriptionModel.value || undefined,
  outputProviderId: effectiveVoiceOutputProfile.value?.providerId,
  outputModelId: effectiveVoiceOutputProfile.value?.modelId,
  voiceId: effectiveVoiceOutputProfile.value?.voiceId,
}))

watch(voiceProviderSnapshot, (next, previous) => {
  if (!previous || JSON.stringify(next) === JSON.stringify(previous))
    return

  void handleVoiceProviderSwitch(next)
}, { deep: true })

watch(microphonePermission, (permission) => {
  if (permission.state === 'requesting') {
    voiceConversationStore.beginPermissionRequest({
      sessionId: permission.requestId ?? createVoiceRuntimeId('voice-session'),
      mode: currentVoiceMode.value,
      ...voiceProviderSnapshot.value,
      now: permission.updatedAt,
    })
    return
  }

  if (permission.state === 'granted') {
    voiceConversationStore.grantPermission(permission.updatedAt)
    return
  }

  if (permission.state === 'denied') {
    const canApplyRevocation = !['idle', 'stopped', 'failed'].includes(voiceConversationStore.state)
    if (voiceConversationStore.state === 'requesting-permission'
      || (permission.failureReason === 'revoked' && canApplyRevocation)) {
      voiceConversationStore.denyPermission({
        at: permission.updatedAt,
        revoked: permission.failureReason === 'revoked',
      })
    }
    return
  }

  if (permission.state === 'failed' && voiceConversationStore.state === 'requesting-permission') {
    voiceConversationStore.dispatch({
      type: 'fail',
      code: 'asr_error',
      reason: 'asr-error',
      at: permission.updatedAt,
    })
  }
}, { flush: 'sync', immediate: true })
const voiceStatusVisible = computed(() => enabled.value || voiceConversationStore.state !== 'idle')
const canInterruptVoiceConversation = computed(() => voiceConversationStore.state === 'speaking'
  && voiceConversationPreferences.value.interruptionPolicy === 'pushToInterrupt')
const voicePrimaryActionLabel = computed(() => enabled.value
  ? t('tamagotchi.stage.voice.actions.stop')
  : t('tamagotchi.stage.voice.actions.start'))
const voiceStatusLabel = computed(() => t(`tamagotchi.stage.voice.state.${voiceConversationStore.state}`))
const voiceFailureDescriptionKey = computed(() => {
  const errorCode = voiceConversationStore.session?.lastErrorCode
  switch (errorCode) {
    case 'hearing_not_configured':
      return 'tamagotchi.stage.voice.description.hearing-not-configured'
    case 'chat_not_configured':
      return 'tamagotchi.stage.voice.description.chat-not-configured'
    case 'speech_not_configured':
      return 'tamagotchi.stage.voice.description.speech-not-configured'
    case 'cloud_tts_privacy_not_acknowledged':
      return 'tamagotchi.stage.voice.description.cloud-privacy-not-acknowledged'
    case 'permission_denied':
      return 'tamagotchi.stage.voice.description.permission-denied'
    case 'asr_error':
      return 'tamagotchi.stage.voice.description.asr-error'
    case 'chat_error':
      return 'tamagotchi.stage.voice.description.chat-error'
    case 'tts_error':
    case 'playback_error':
      return 'tamagotchi.stage.voice.description.tts-error'
    default:
      return 'tamagotchi.stage.voice.description.failed'
  }
})
const voiceStatusDescription = computed(() => {
  if (voiceConversationStore.state === 'failed')
    return t(voiceFailureDescriptionKey.value)
  if (!enabled.value)
    return t('tamagotchi.stage.voice.description.disabled')
  if (voiceConversationStore.state === 'speaking')
    return t('tamagotchi.stage.voice.description.speaking')
  if (!supportsStreamInput.value)
    return t('tamagotchi.stage.voice.description.recording')
  return t('tamagotchi.stage.voice.description.streaming')
})
const voiceFailureSettingsAction = computed(() => {
  if (voiceConversationStore.state !== 'failed')
    return

  const errorCode = voiceConversationStore.session?.lastErrorCode
  switch (errorCode) {
    case 'chat_not_configured':
    case 'chat_error':
      return {
        label: t('tamagotchi.stage.voice.actions.configure-chat'),
        route: '/settings/modules/consciousness',
      }
    case 'speech_not_configured':
    case 'cloud_tts_privacy_not_acknowledged':
    case 'tts_error':
    case 'playback_error':
      return {
        label: t('tamagotchi.stage.voice.actions.configure-speech'),
        route: '/settings/modules/speech',
      }
    default:
      return {
        label: t('tamagotchi.stage.voice.actions.configure-hearing'),
        route: '/settings/modules/hearing',
      }
  }
})
const voiceStatusToneClass = computed(() => {
  switch (voiceConversationStore.state) {
    case 'failed':
      return 'border-red-300/70 bg-red-50/85 text-red-900 dark:border-red-500/40 dark:bg-red-950/80 dark:text-red-100'
    case 'speaking':
      return 'border-primary-300/70 bg-primary-50/85 text-primary-900 dark:border-primary-500/40 dark:bg-primary-950/80 dark:text-primary-100'
    case 'speech-detected':
    case 'transcribing':
      return 'border-amber-300/70 bg-amber-50/85 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/80 dark:text-amber-100'
    default:
      return 'border-neutral-200/80 bg-white/80 text-neutral-900 dark:border-neutral-800/80 dark:bg-neutral-950/80 dark:text-neutral-100'
  }
})

const VAD_SAMPLE_RATE = 16_000
const { init: initVAD, dispose: disposeVAD, start: startVAD, stop: stopVAD } = useVAD(workletUrl, {
  threshold: () => voiceConversationPreferences.value.vadThreshold,
  minSilenceDurationMs: () => voiceConversationPreferences.value.trailingSilenceMs,
  minSpeechDurationMs: () => voiceConversationPreferences.value.minSpeechDurationMs,
  onSpeechStart: () => {
    void handleSpeechStart()
  },
  onSpeechEnd: () => {
    void handleSpeechEnd()
  },
  onSpeechReady: ({ buffer, duration }) => {
    void handleVadSpeechReady(buffer, duration)
  },
})

const audioInteractionStarting = ref(false)
const activeAsrTranscript = shallowRef<AsrTranscriptAccumulator | null>(null)
const lastVoiceFinalTranscript = shallowRef<{ text: string, at: number } | null>(null)
const voicePlaybackEchoGate = shallowRef(createVoicePlaybackEchoGateState())
let nextVoiceTurnSequence = 0
let streamingAsrGeneration = 0
let streamingAsrLifecycle: Promise<void> = Promise.resolve()
let vadLifecycle: Promise<void> = Promise.resolve()
let echoGateResumeTimer: ReturnType<typeof setTimeout> | undefined
let automaticVoiceInputSuspended = false
let activeVoiceInputStream: MediaStream | undefined
let asrFirstPartialTurnId: string | undefined
let voiceProviderSwitchGeneration = 0
let voiceInterruptGeneration = 0

async function handleVoiceProviderSwitch(next: typeof voiceProviderSnapshot.value) {
  const generation = ++voiceProviderSwitchGeneration
  voiceRecoveryDraftStore.clear()
  speechOutputControlStore.requestStopSpeaking('provider-switch')
  streamingAsrGeneration += 1
  activeAsrTranscript.value = null
  asrFirstPartialTurnId = undefined
  activeVoiceInputStream = undefined
  voiceConversationStore.applyProviderSwitch({ ...next, now: Date.now() })

  await Promise.allSettled([
    enqueueVadLifecycle(stopVAD),
    enqueueStreamingAsrLifecycle(async () => {
      await stopStreamingTranscription(true)
    }),
  ])

  if (generation !== voiceProviderSwitchGeneration || !enabled.value || !stream.value)
    return

  await startAudioInteraction()
}

// Caption overlay broadcast channel
type CaptionChannelEvent
  = | { type: 'caption-speaker', text: string }
    | { type: 'caption-assistant', text: string }
const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })

function postCaptionSafely(event: CaptionChannelEvent) {
  try {
    postCaption(event)
  }
  catch (error) {
    console.warn('[Main Page] Caption channel is unavailable; continuing the voice turn without overlay updates.', {
      errorName: safeRuntimeErrorName(error),
    })
  }
}

function createVoiceRuntimeId(prefix: string) {
  nextVoiceTurnSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${nextVoiceTurnSequence.toString(36)}`
}

function findVoiceUserMessage(
  sessionId: string,
  candidateTexts: readonly string[],
  fromIndex = 0,
) {
  const normalizedCandidates = new Set(candidateTexts.map(text => text.trim()).filter(Boolean))
  const messages = chatSessionStore.getSessionMessages(sessionId)
  for (let index = messages.length - 1; index >= fromIndex; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || !normalizedCandidates.has(extractMessageText(message).trim()))
      continue

    return { id: message.id, index }
  }
}

function replaceVoiceConversationSession(mode: 'streaming-asr' | 'vad-turn-taking', listeningImmediately: boolean) {
  voiceConversationStore.start({
    sessionId: createVoiceRuntimeId('voice-session'),
    mode,
    ...voiceProviderSnapshot.value,
    listeningImmediately,
  })
}

function startVoiceListeningSession(mode: 'streaming-asr' | 'vad-turn-taking') {
  if (voiceConversationStore.state === 'listening')
    return

  if (voiceConversationStore.state === 'interrupted') {
    voiceConversationStore.dispatch({ type: 'interruption-ready' })
    return
  }

  if (['speech-detected', 'transcribing', 'user-turn-ready', 'thinking', 'speaking'].includes(voiceConversationStore.state))
    return

  replaceVoiceConversationSession(mode, true)
}

async function failVoiceConversationStart(
  errorCode: VoiceConversationErrorCode,
  cancelReason: VoiceConversationCancelReason,
) {
  if (voiceConversationStore.state !== 'failed') {
    if (!voiceConversationStore.session || voiceConversationStore.state === 'stopped')
      replaceVoiceConversationSession(currentVoiceMode.value, false)

    voiceConversationStore.dispatch({ type: 'fail', code: errorCode, reason: cancelReason })
  }

  enabled.value = false
}

watch(voiceSetupIssue, (issue) => {
  if (!enabled.value || issue?.code !== 'cloud_tts_privacy_not_acknowledged')
    return

  speechOutputControlStore.requestStopSpeaking('voice-stop')
  void failVoiceConversationStart(issue.errorCode, issue.cancelReason)
})

function openVoiceFailureSettings() {
  const action = voiceFailureSettingsAction.value
  if (action)
    openSettings({ route: action.route })
}

function beginVoiceTurn(mode: 'streaming-asr' | 'vad-turn-taking') {
  startVoiceListeningSession(mode)
  const turnId = createVoiceRuntimeId('voice-turn')
  asrFirstPartialTurnId = undefined
  activeAsrTranscript.value = createAsrTranscriptAccumulator(turnId)
  voiceConversationStore.dispatch({ type: 'speech-start', turnId })
  return turnId
}

function ensureVoiceTurn(mode: 'streaming-asr' | 'vad-turn-taking') {
  const current = activeAsrTranscript.value
  if (current && voiceConversationStore.isCurrentTurn(current.turnId))
    return current.turnId

  return beginVoiceTurn(mode)
}

function markVoiceTurnTranscribing(turnId: string) {
  if (voiceConversationStore.state === 'speech-detected')
    voiceConversationStore.dispatch({ type: 'asr-start', turnId })
}

async function dropActiveVoiceTurnAndResumeListening(mode: 'streaming-asr' | 'vad-turn-taking') {
  activeAsrTranscript.value = null
  voiceConversationStore.stop('unknown')
  startVoiceListeningSession(mode)

  if (mode === 'streaming-asr'
    && finalizesOnVadEnd.value
    && enabled.value
    && stream.value
    && !shouldIgnoreAutomaticVoiceInput()) {
    await startStreamingAsr(stream.value)
  }
}

function shouldIgnoreAutomaticVoiceInput() {
  return automaticVoiceInputSuspended
    || !!voiceRecoveryDraft.value
    || isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value)
}

function canStartAutomaticVoiceTurn() {
  return !['speech-detected', 'transcribing', 'user-turn-ready', 'thinking', 'speaking'].includes(voiceConversationStore.state)
}

function isRecentDuplicateVoiceFinal(text: string) {
  const previous = lastVoiceFinalTranscript.value
  if (!previous)
    return false

  return previous.text === text && Date.now() - previous.at < 2_000
}

async function sendFinalVoiceTranscript(turnId: string, text: string) {
  if (isRecentDuplicateVoiceFinal(text)) {
    console.info('[Main Page] Dropping duplicate final voice transcript.', { textLength: text.length })
    return
  }

  lastVoiceFinalTranscript.value = { text, at: Date.now() }
  postCaptionSafely({ type: 'caption-speaker', text })
  voiceConversationStore.dispatch({ type: 'chat-ingested', turnId })
  const sessionIdBeforeIngest = activeChatSessionId.value
  const messageCountBeforeIngest = sessionIdBeforeIngest
    ? chatSessionStore.getSessionMessages(sessionIdBeforeIngest).length
    : 0

  try {
    console.info('[Main Page] Sending final voice transcript to chat.', { textLength: text.length })
    await chatSyncStore.requestIngest({ text })
    voiceRecoveryDraftStore.clear()
  }
  catch (err) {
    const sessionId = sessionIdBeforeIngest || activeChatSessionId.value
    const failedMessage = sessionId
      ? findVoiceUserMessage(sessionId, [text], messageCountBeforeIngest)
      : undefined
    if (sessionId) {
      voiceRecoveryDraftStore.retain({
        draftId: createVoiceRuntimeId('voice-recovery'),
        sessionId,
        turnId,
        failedMessageId: failedMessage?.id,
        text,
      })
    }
    voiceConversationStore.dispatch({ type: 'fail', code: 'chat_error', reason: 'chat-error' })
    await suspendAutomaticVoiceInputForPlayback()
    console.error('[Main Page] Failed to send chat from voice.', { errorName: safeRuntimeErrorName(err) })
  }
}

async function retryVoiceRecoveryDraft() {
  const draft = voiceRecoveryDraft.value
  if (!draft || !voiceRecoveryDraftStore.beginRetry())
    return

  // Found by code review 2026-07-26 (M2 voice review): `dispatch` never
  // throws — on a rejected transition (e.g. `stale_turn` after a provider
  // switch replaced the session and detached `activeTurnId`) it keeps the
  // previous session and only records the failure in `lastTransitionError`;
  // it returns `null` solely when no session exists at all
  // (`packages/stage-ui/src/stores/voiceConversation.ts:77-91`). Ignoring the
  // result sent the retry as if the voice turn were re-attached while the
  // session/UI correlation was already broken.
  const sessionAfterRetryDispatch = voiceConversationStore.dispatch({ type: 'chat-retry', turnId: draft.turnId })
  const voiceTurnReattached = sessionAfterRetryDispatch !== null
    && voiceConversationStore.lastTransitionError === null
  if (!voiceTurnReattached) {
    console.warn('[Main Page] Voice turn could not be re-attached for chat retry; sending without voice correlation.', {
      state: voiceConversationStore.state,
      errorCode: voiceConversationStore.lastTransitionError?.code,
    })
  }

  const currentMessages = chatSessionStore.getSessionMessages(draft.sessionId)
  const messageIndexById = draft.failedMessageId
    ? currentMessages.findIndex(message => message.id === draft.failedMessageId)
    : -1
  const fallbackMessage = findVoiceUserMessage(
    draft.sessionId,
    [draft.originalText, draft.text],
  )
  const sourceIndex = messageIndexById >= 0 ? messageIndexById : fallbackMessage?.index

  try {
    if (sourceIndex === undefined) {
      await chatSyncStore.requestIngest({
        text: draft.text,
        sessionId: draft.sessionId,
      })
    }
    else {
      await chatSyncStore.requestRetry({
        sessionId: draft.sessionId,
        index: sourceIndex,
        sourceMessageId: draft.failedMessageId,
        replacementText: draft.text,
      })
    }

    voiceRecoveryDraftStore.clear()

    if (!voiceTurnReattached && enabled.value) {
      // Degraded retry semantics: the message was still sent (user intent
      // first), but with no active voice turn none of the turn-scoped
      // llm/tts/playback events fire (Stage.vue notifiers guard on
      // `activeTurnId`/`isCurrentTurn`), so the session would otherwise stay
      // 'stopped'/'failed' while voice mode is still on — contradicting the
      // UI. Re-open listening via the page's existing recovery pattern
      // (`discardVoiceRecoveryDraft` and `interruptVoiceConversation` both
      // call `startVoiceListeningSession(currentVoiceMode.value)` followed by
      // `resumeAutomaticVoiceInputAfterPlayback()`); the detached session has
      // no turn left to cancel, so no extra `stop` dispatch is needed, and
      // `startVoiceListeningSession` is a no-op if the machine is already
      // listening or busy. The echo gate then times microphone recovery
      // around the assistant's audible reply.
      startVoiceListeningSession(currentVoiceMode.value)
      void resumeAutomaticVoiceInputAfterPlayback()
    }
  }
  catch (error) {
    const failedMessage = findVoiceUserMessage(
      draft.sessionId,
      [draft.text],
      sourceIndex ?? 0,
    )
    voiceRecoveryDraftStore.failRetry(failedMessage?.id)
    voiceConversationStore.dispatch({ type: 'fail', code: 'chat_error', reason: 'chat-error' })
    console.error('[Main Page] Failed to retry recovered voice chat.', { errorName: safeRuntimeErrorName(error) })
  }
}

function discardVoiceRecoveryDraft() {
  voiceRecoveryDraftStore.clear()
  if (!enabled.value)
    return

  voiceConversationStore.stop('chat-error')
  startVoiceListeningSession(currentVoiceMode.value)
  void resumeAutomaticVoiceInputAfterPlayback()
}

async function consumeFinalAsrTranscript(
  mode: 'streaming-asr' | 'vad-turn-taking',
  text: string,
  source: 'stream' | 'recording',
  expectedTurnId?: string,
) {
  if (expectedTurnId
    && (activeAsrTranscript.value?.turnId !== expectedTurnId || !voiceConversationStore.isCurrentTurn(expectedTurnId))) {
    console.info('[Main Page] Dropping stale ASR result after the voice turn changed:', { source })
    return
  }

  if (shouldIgnoreAutomaticVoiceInput()) {
    console.info('[Main Page] Dropping ASR transcript while assistant playback is active:', { source })
    // Found by code review 2026-07-26 (M2 voice review): returning without
    // releasing an already-opened turn left the session stuck in
    // speech-detected/transcribing with that turn active, so
    // `canStartAutomaticVoiceTurn()` rejected every future microphone turn.
    // Releasing here cannot interrupt assistant playback:
    // - a matching accumulator turn implies the state is
    //   speech-detected/transcribing: `activeAsrTranscript` is always cleared
    //   right after the `asr-final` dispatch at the end of this function,
    //   before `chat-ingested` can move the machine into thinking/speaking;
    // - `dropActiveVoiceTurnAndResumeListening` only mutates state-machine
    //   state (the store performs no audio/microphone side effects, see
    //   `packages/stage-ui/src/stores/voiceConversation.ts:44-50`), and its
    //   streaming-ASR restart is guarded by `!shouldIgnoreAutomaticVoiceInput()`
    //   (line 752 above), which evaluates false inside this branch, so the
    //   microphone stays closed;
    // - the echo gate derives `assistantResponseActive` solely from the
    //   'speaking' state (`packages/stage-ui/src/domains/voiceConversation/echo-gate.ts:44`),
    //   which this stop -> listening release never leaves from.
    if (activeAsrTranscript.value?.turnId && voiceConversationStore.isCurrentTurn(activeAsrTranscript.value.turnId))
      await dropActiveVoiceTurnAndResumeListening(mode)
    return
  }

  if (!activeAsrTranscript.value && !canStartAutomaticVoiceTurn()) {
    console.info('[Main Page] Dropping ASR transcript while voice session is busy:', { source, state: voiceConversationStore.state })
    return
  }

  const normalizedText = normalizeAsrTranscript(text)
  if (!normalizedText) {
    const turnId = activeAsrTranscript.value?.turnId
    activeAsrTranscript.value = null

    if (turnId && voiceConversationStore.isCurrentTurn(turnId)) {
      if (hearingError.value) {
        voiceConversationStore.dispatch({ type: 'fail', code: 'asr_error', reason: 'asr-error' })
      }
      else {
        voiceConversationStore.stop('unknown')
        startVoiceListeningSession(mode)
      }
    }
    return
  }

  if (isRecentDuplicateVoiceFinal(normalizedText)) {
    console.info('[Main Page] Dropping recent duplicate ASR transcript before opening a voice turn:', { source })
    // Found by code review 2026-07-26 (M2 voice review): when the duplicate
    // final arrives for a turn that `beginVoiceTurn` already opened (the user
    // repeats the same short phrase within 2 seconds), a plain return kept the
    // session in speech-detected/transcribing with that turn active,
    // `canStartAutomaticVoiceTurn()` stayed false, and no new microphone turn
    // could ever start. Release the held turn and resume listening exactly
    // like the other drop branches below.
    if (activeAsrTranscript.value?.turnId && voiceConversationStore.isCurrentTurn(activeAsrTranscript.value.turnId))
      await dropActiveVoiceTurnAndResumeListening(mode)
    return
  }

  const turnId = expectedTurnId ?? ensureVoiceTurn(mode)
  const current = activeAsrTranscript.value ?? createAsrTranscriptAccumulator(turnId)
  const result = reduceAsrTranscriptSegment(current, {
    segmentId: createVoiceRuntimeId(`asr-${source}`),
    turnId,
    text: normalizedText,
    isFinal: true,
  })

  activeAsrTranscript.value = result.accumulator
  if (!result.ok) {
    console.info('[Main Page] Dropping stale ASR transcript:', { source, reason: result.reason })
    await dropActiveVoiceTurnAndResumeListening(mode)
    return
  }

  if (!result.accepted) {
    console.info('[Main Page] Dropping ASR transcript:', { source, reason: result.reason })
    await dropActiveVoiceTurnAndResumeListening(mode)
    return
  }

  if (!result.finalText) {
    await dropActiveVoiceTurnAndResumeListening(mode)
    return
  }

  markVoiceTurnTranscribing(turnId)
  voiceConversationStore.dispatch({ type: 'asr-final', turnId }, { textLength: result.finalText.length })
  activeAsrTranscript.value = null
  await sendFinalVoiceTranscript(turnId, result.finalText)
}

function handleStreamingSentenceEnd(delta: string) {
  if (shouldIgnoreAutomaticVoiceInput())
    return

  const text = normalizeAsrTranscript(delta)
  if (!text)
    return

  const turnId = activeAsrTranscript.value?.turnId
    ?? (canStartAutomaticVoiceTurn() ? beginVoiceTurn('streaming-asr') : undefined)
  if (!turnId || !voiceConversationStore.isCurrentTurn(turnId))
    return

  const current = activeAsrTranscript.value ?? createAsrTranscriptAccumulator(turnId)
  const result = reduceAsrTranscriptSegment(current, {
    segmentId: createVoiceRuntimeId('asr-stream-partial'),
    turnId,
    text,
    isFinal: false,
  })

  if (!result.ok || !result.accepted)
    return

  activeAsrTranscript.value = result.accumulator
  if (asrFirstPartialTurnId !== turnId) {
    asrFirstPartialTurnId = turnId
    voiceConversationStore.dispatch({ type: 'asr-first-partial', turnId }, { textLength: text.length })
  }
  console.info('[Main Page] Received partial streaming transcription.', { textLength: text.length })
  postCaptionSafely({ type: 'caption-speaker', text: result.partialText ?? text })
}

function handleStreamingSpeechEnd(text: string) {
  const turnId = activeAsrTranscript.value?.turnId
  if (!turnId || shouldIgnoreAutomaticVoiceInput())
    return

  console.info('[Main Page] Streaming speech ended with one final transcript.', { textLength: text.length })
  void consumeFinalAsrTranscript('streaming-asr', text, 'stream', turnId)
}

async function handleSpeechStart() {
  if (shouldIgnoreAutomaticVoiceInput()) {
    console.info('[Main Page] Ignoring VAD speech start while assistant playback is active')
    return
  }

  if (!canStartAutomaticVoiceTurn()) {
    console.info('[Main Page] Ignoring VAD speech start while voice session is busy:', voiceConversationStore.state)
    return
  }

  beginVoiceTurn(currentVoiceMode.value)

  if (shouldUseStreamInput.value) {
    console.info('Speech detected - transcription session should already be active')
  }
}

function toggleVoiceConversation() {
  if (enabled.value) {
    speechOutputControlStore.requestStopSpeaking('voice-stop')
    enabled.value = false
    stopAudioInteraction('user-stop')
    return
  }

  enabled.value = !enabled.value
}

async function waitForAssistantPlaybackToStop(requestId: number, timeoutMs = 2_500) {
  if (latestStopAcknowledgement.value?.requestId === requestId && !nowSpeaking.value)
    return true

  return await new Promise<boolean>((resolve) => {
    let settled = false
    let stopWatching: (() => void) | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (stopped: boolean) => {
      if (settled)
        return
      settled = true
      if (timeout)
        clearTimeout(timeout)
      stopWatching?.()
      resolve(stopped)
    }
    stopWatching = watch(
      [latestStopAcknowledgement, nowSpeaking],
      ([acknowledgement, speaking]) => acknowledgement?.requestId === requestId && !speaking && finish(true),
      { flush: 'sync', immediate: true },
    )
    if (settled)
      stopWatching()
    else
      timeout = setTimeout(finish, timeoutMs, false)
  })
}

async function interruptVoiceConversation() {
  const generation = ++voiceInterruptGeneration
  const stopRequestId = speechOutputControlStore.requestStopSpeaking('voice-interrupt')
  activeAsrTranscript.value = null

  if (voiceConversationStore.activeTurnId && (voiceConversationStore.state === 'thinking' || voiceConversationStore.state === 'speaking'))
    voiceConversationStore.dispatch({ type: 'interrupt', reason: 'user-interrupt' })

  // Stage owns the audio sink. Its stop watcher and playback manager can settle
  // after Vue's next render tick, so wait for the authoritative speaking signal
  // instead of reopening the microphone against still-audible output.
  const playbackStopped = await waitForAssistantPlaybackToStop(stopRequestId)
  if (generation !== voiceInterruptGeneration)
    return
  if (!playbackStopped) {
    voiceConversationStore.dispatch({ type: 'fail', code: 'playback_error', reason: 'playback-error' })
    console.warn('[Main Page] Push-to-interrupt could not confirm playback stopped before resuming input')
    return
  }

  clearEchoGateResumeTimer()
  voicePlaybackEchoGate.value = releaseVoicePlaybackEchoGateForUserInterrupt()
  startVoiceListeningSession(currentVoiceMode.value)
  await resumeAutomaticVoiceInputAfterPlayback()
}

async function handleSpeechEnd() {
  if (shouldUseStreamInput.value) {
    const turnId = activeAsrTranscript.value?.turnId
    if (turnId && voiceConversationStore.isCurrentTurn(turnId))
      voiceConversationStore.dispatch({ type: 'speech-end', turnId })

    if (finalizesOnVadEnd.value) {
      await enqueueStreamingAsrLifecycle(async () => {
        await stopStreamingTranscription(false)
      })
    }
    return
  }

  const turnId = activeAsrTranscript.value?.turnId
  if (turnId && voiceConversationStore.isCurrentTurn(turnId))
    voiceConversationStore.dispatch({ type: 'speech-end', turnId })
}

async function handleVadSpeechReady(buffer: Float32Array, duration: number) {
  if (shouldUseStreamInput.value || shouldIgnoreAutomaticVoiceInput())
    return

  const turnId = activeAsrTranscript.value?.turnId
  if (!turnId || !voiceConversationStore.isCurrentTurn(turnId)) {
    console.info('[Main Page] Dropping VAD speech buffer without a current voice turn.')
    return
  }

  const sampleBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const recording = new Blob([toWav(sampleBuffer, VAD_SAMPLE_RATE)], { type: 'audio/wav' })
  console.info('[Main Page] Transcribing buffered VAD speech.', {
    durationMs: Math.round(duration),
    recordingSize: recording.size,
  })

  const text = await transcribeForRecording(recording)
  await consumeFinalAsrTranscript('vad-turn-taking', text ?? '', 'recording', turnId)
}

function clearEchoGateResumeTimer() {
  if (!echoGateResumeTimer)
    return

  clearTimeout(echoGateResumeTimer)
  echoGateResumeTimer = undefined
}

function enqueueStreamingAsrLifecycle(operation: () => Promise<void>) {
  const next = streamingAsrLifecycle
    .catch(() => undefined)
    .then(operation)
  streamingAsrLifecycle = next
  return next
}

function enqueueVadLifecycle(operation: () => Promise<void>) {
  const next = vadLifecycle
    .catch(() => undefined)
    .then(operation)
  vadLifecycle = next
  return next
}

async function startStreamingAsr(currentStream: MediaStream) {
  const generation = ++streamingAsrGeneration
  await enqueueStreamingAsrLifecycle(async () => {
    if (generation !== streamingAsrGeneration || isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value))
      return

    await transcribeForMediaStream(currentStream, {
      onSentenceEnd: (delta) => {
        if (generation === streamingAsrGeneration)
          handleStreamingSentenceEnd(delta)
      },
      onSpeechEnd: (text) => {
        if (generation === streamingAsrGeneration)
          handleStreamingSpeechEnd(text)
      },
    })

    if (generation !== streamingAsrGeneration || isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value))
      await stopStreamingTranscription(true)
  })
}

async function suspendAutomaticVoiceInputForPlayback() {
  if (automaticVoiceInputSuspended)
    return

  automaticVoiceInputSuspended = true
  streamingAsrGeneration += 1
  activeAsrTranscript.value = null
  console.info('[Main Page] Suspending automatic voice input for assistant playback echo control')

  await Promise.allSettled([
    enqueueVadLifecycle(stopVAD),
    enqueueStreamingAsrLifecycle(async () => {
      await stopStreamingTranscription(true)
    }),
  ])
  activeVoiceInputStream = undefined
}

async function resumeAutomaticVoiceInputAfterPlayback() {
  if (!enabled.value || !stream.value || voiceRecoveryDraft.value || isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value))
    return

  if (!automaticVoiceInputSuspended && activeVoiceInputStream === stream.value)
    return

  automaticVoiceInputSuspended = false
  console.info('[Main Page] Resuming automatic voice input after assistant playback echo tail')

  try {
    await enqueueVadLifecycle(async () => {
      if (!stream.value || isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value))
        return
      await startVAD(stream.value)
      if (voiceConversationStore.state === 'listening')
        voiceConversationStore.dispatch({ type: 'vad-started' })
      activeVoiceInputStream = stream.value
    })
    if (shouldUseStreamInput.value)
      await startStreamingAsr(stream.value)
  }
  catch (error) {
    console.error('[Main Page] Failed to resume voice input after assistant playback.', {
      errorName: safeRuntimeErrorName(error),
    })
  }
}

async function syncAutomaticVoiceInputWithPlayback() {
  clearEchoGateResumeTimer()

  voicePlaybackEchoGate.value = updateVoicePlaybackEchoGate(voicePlaybackEchoGate.value, {
    audiblePlayback: nowSpeaking.value,
    voiceConversationState: voiceConversationStore.state,
  })

  if (voicePlaybackEchoGate.value.audiblePlayback || voicePlaybackEchoGate.value.assistantResponseActive) {
    await suspendAutomaticVoiceInputForPlayback()
    return
  }

  const remainingMs = voicePlaybackEchoBlockRemainingMs(voicePlaybackEchoGate.value)
  if (remainingMs > 0) {
    echoGateResumeTimer = setTimeout(() => {
      echoGateResumeTimer = undefined
      void resumeAutomaticVoiceInputAfterPlayback()
    }, remainingMs)
    return
  }

  await resumeAutomaticVoiceInputAfterPlayback()
}

async function startAudioInteraction() {
  if (audioInteractionStarting.value)
    return

  if (stream.value
    && activeVoiceInputStream === stream.value
    && !shouldIgnoreAutomaticVoiceInput()) {
    console.info('[Main Page] Voice input is already attached to the current microphone stream')
    return
  }

  // A microphone/device retoggle replaces the MediaStream. The identity guard above
  // skips duplicate watcher starts while still allowing a genuinely new stream here.
  audioInteractionStarting.value = true
  try {
    console.info('[Main Page] Starting audio interaction...')

    await vadLifecycle.catch(() => undefined)
    await initVAD()

    if (stream.value && !isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value)) {
      automaticVoiceInputSuspended = false
      console.info('[Main Page] VAD initialized successfully, starting with stream input')
      await enqueueVadLifecycle(async () => {
        if (stream.value && !isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value)) {
          await startVAD(stream.value)
          if (voiceConversationStore.state === 'listening')
            voiceConversationStore.dispatch({ type: 'vad-started' })
          activeVoiceInputStream = stream.value
        }
      })
    }
    else if (isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value)) {
      automaticVoiceInputSuspended = true
      console.info('[Main Page] Deferring microphone ingestion until assistant playback and echo tail end')
      void syncAutomaticVoiceInputWithPlayback()
    }

    if (shouldUseStreamInput.value) {
      console.info('[Main Page] Starting streaming transcription...', {
        supportsStreamInput: supportsStreamInput.value,
        hasStream: !!stream.value,
      })

      if (!stream.value) {
        console.warn('[Main Page] Stream not available despite shouldUseStreamInput being true')
        return
      }

      startVoiceListeningSession('streaming-asr')

      // Sentence deltas stay UI-only; the correlated speech-end callback is
      // the only event allowed to create a chat turn.
      if (!isVoicePlaybackEchoBlocked(voicePlaybackEchoGate.value))
        await startStreamingAsr(stream.value)

      console.info('[Main Page] Streaming transcription started successfully')
    }
    else if (stream.value) {
      startVoiceListeningSession('vad-turn-taking')
      console.warn('[Main Page] Not starting streaming transcription:', {
        shouldUseStreamInput: shouldUseStreamInput.value,
        hasStream: !!stream.value,
        supportsStreamInput: supportsStreamInput.value,
      })
    }
    else {
      console.info('[Main Page] Waiting for the microphone stream before starting a voice session')
    }
  }
  catch (e) {
    console.error('Audio interaction init failed:', e)
  }
  finally {
    audioInteractionStarting.value = false
  }
}

function cleanupAudioInteraction() {
  tryCatch(() => {
    clearEchoGateResumeTimer()
    streamingAsrGeneration += 1
    audioInteractionStarting.value = false
    automaticVoiceInputSuspended = false
    activeVoiceInputStream = undefined
    activeAsrTranscript.value = null
    asrFirstPartialTurnId = undefined
    void enqueueStreamingAsrLifecycle(async () => {
      await stopStreamingTranscription(true)
    })
    void enqueueVadLifecycle(async () => {
      await stopVAD()
      disposeVAD()
    })
  })
}

function stopAudioInteraction(reason: 'user-stop' | 'page-dispose' = 'user-stop') {
  voiceRecoveryDraftStore.clear()
  voiceConversationStore.stop(reason)
  cleanupAudioInteraction()
}

watch(enabled, async (val) => {
  console.info('[Main Page] Audio enabled changed:', val, 'stream available:', !!stream.value)
  if (val) {
    const setupIssue = voiceSetupIssue.value
    if (setupIssue) {
      await failVoiceConversationStart(setupIssue.errorCode, setupIssue.cancelReason)
      return
    }

    try {
      await askPermission()
      await startAudioInteraction()
    }
    catch (error) {
      const permissionDenied = error instanceof DOMException
        && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
      await failVoiceConversationStart(
        permissionDenied ? 'permission_denied' : 'asr_error',
        permissionDenied ? 'permission-denied' : 'asr-error',
      )
      console.error('[Main Page] Unable to start microphone input.', { errorName: safeRuntimeErrorName(error) })
    }
  }
  else {
    if (voiceConversationStore.state === 'failed')
      cleanupAudioInteraction()
    else
      stopAudioInteraction('user-stop')
  }
}, { immediate: true })

onMounted(() => {
  if (onboardingStore.needsOnboarding) {
    openOnboarding()
  }
})

onBeforeUnmount(() => {
  postModelSettingsRuntimeChannelEvent({
    type: 'owner-gone',
    ownerInstanceId: modelSettingsRuntimeOwnerInstanceId,
  })
})

onUnmounted(() => {
  stopVoiceSettingsSync()
  stopVoiceDiagnosticsRequest()
  stopAudioInteraction('page-dispose')
})

watch(stream, async (currentStream) => {
  if (!enabled.value || !currentStream || audioInteractionStarting.value)
    return

  // NOTICE: The controls-island mic toggle and device changes can replace the underlying MediaStream
  // without reloading the page. When that happens, VAD may successfully restart against the new stream,
  // but any existing transcription transport is still bound to the old one. Always allow the page to
  // re-run `startAudioInteraction()` for a newly available stream unless startup is already underway.
  console.info('[Main Page] Stream became available, ensuring audio interaction is started')
  await startAudioInteraction()
})

watch(
  [nowSpeaking, () => voiceConversationStore.state],
  () => {
    void syncAutomaticVoiceInputWithPlayback()
  },
  { immediate: true },
)

// Assistant caption is broadcast from Stage.vue via the same channel

const cursorPosition = computed(() => ({
  x: relativeMouseX.value,
  y: relativeMouseY.value,
}))
</script>

<template>
  <div
    max-h="[100vh]"
    max-w="[100vw]"
    flex="~ col"
    relative z-2 h-full overflow-hidden rounded-xl
    transition="opacity duration-500 ease-in-out"
  >
    <!-- Stage is always in DOM so TresCanvas can measure dimensions -->
    <div
      :class="[
        'relative h-full w-full items-end gap-2',
        'transition-opacity duration-250 ease-in-out',
      ]"
    >
      <div
        :class="[
          shouldFadeOnCursorWithin ? 'op-0' : 'op-100',
          'absolute',
          'top-0 left-0 w-full h-full',
          'overflow-hidden',
          'rounded-2xl',
          'transition-opacity duration-250 ease-in-out',
        ]"
      >
        <StatusIsland v-if="IS_DEV" ref="statusIslandRef" />
        <ResourceStatusIsland />
        <WidgetStage
          ref="widgetStageRef"
          v-model:state="componentStateStage"
          h-full w-full
          flex-1
          :cursor-position="cursorPosition"
          :paused="stagePaused"
        />
        <HoloCoupon />
        <Teleport to="#stage-status-overlay-stack">
          <div
            v-if="voiceStatusVisible"
            ref="voiceStatusRef"
            class="pointer-events-auto relative max-w-72 w-full border rounded-lg px-3 py-2 shadow-xl backdrop-blur-md"
            :class="voiceStatusToneClass"
          >
            <div class="flex items-start gap-2">
              <div class="mt-1 size-2.5 shrink-0 rounded-full bg-current opacity-70" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">
                  {{ voiceStatusLabel }}
                </div>
                <div class="mt-0.5 text-xs opacity-75">
                  {{ voiceStatusDescription }}
                </div>
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs text-white font-medium transition-colors dark:bg-white hover:bg-neutral-700 dark:text-neutral-950 dark:hover:bg-neutral-200"
                :aria-label="voicePrimaryActionLabel"
                @click.stop="toggleVoiceConversation"
              >
                {{ voicePrimaryActionLabel }}
              </button>
              <button
                v-if="voiceFailureSettingsAction"
                type="button"
                class="rounded-lg bg-red-700 px-2.5 py-1 text-xs text-white font-medium transition-colors dark:bg-red-300 hover:bg-red-600 dark:text-red-950 dark:hover:bg-red-200"
                :aria-label="voiceFailureSettingsAction.label"
                @click.stop="openVoiceFailureSettings"
              >
                {{ voiceFailureSettingsAction.label }}
              </button>
              <button
                v-else-if="canInterruptVoiceConversation"
                type="button"
                class="rounded-lg bg-primary-600 px-2.5 py-1 text-xs text-white font-medium transition-colors hover:bg-primary-500"
                :aria-label="t('tamagotchi.stage.voice.actions.interrupt')"
                @click.stop="interruptVoiceConversation"
              >
                {{ t('tamagotchi.stage.voice.actions.interrupt') }}
              </button>
            </div>
          </div>
          <VoiceRecoveryDraftPanel
            v-if="voiceRecoveryDraft"
            class="pointer-events-auto relative max-w-80 w-full"
            :draft="voiceRecoveryDraft"
            @edit="voiceRecoveryDraftStore.edit"
            @retry="retryVoiceRecoveryDraft"
            @discard="discardVoiceRecoveryDraft"
          />
        </Teleport>
        <ControlsIsland
          ref="controlsIslandRef"
        />
      </div>
    </div>
    <!-- Loading overlay sits on top, does not hide the stage -->
    <div v-show="isLoading" class="absolute left-0 top-0 z-99 h-full w-full flex cursor-grab items-center justify-center overflow-hidden">
      <div
        :class="[
          'absolute h-24 w-full overflow-hidden rounded-xl',
          'flex items-center justify-center',
          'bg-white/80 dark:bg-neutral-950/80',
          'backdrop-blur-md',
        ]"
      >
        <div
          :class="[
            'drag-region',
            'absolute left-0 top-0',
            'h-full w-full flex items-center justify-center',
            'text-1.5rem text-primary-600 dark:text-primary-400 font-normal',
            'select-none',
            'animate-flash animate-duration-5s animate-count-infinite',
          ]"
        >
          Loading...
        </div>
      </div>
    </div>
  </div>
  <Transition
    enter-active-class="transition-opacity duration-250"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-250"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="false"
      class="absolute left-0 top-0 z-99 h-full w-full flex cursor-grab items-center justify-center overflow-hidden drag-region"
    >
      <div
        class="absolute h-32 w-full flex items-center justify-center overflow-hidden rounded-xl"
        bg="white/80 dark:neutral-950/80" backdrop-blur="md"
      >
        <div class="wall absolute top-0 h-8" />
        <div class="absolute left-0 top-0 h-full w-full flex animate-flash animate-duration-5s animate-count-infinite select-none items-center justify-center text-1.5rem text-primary-400 font-normal drag-region">
          DRAG HERE TO MOVE
        </div>
        <div class="wall absolute bottom-0 h-8 drag-region" />
      </div>
    </div>
  </Transition>
  <Transition
    enter-active-class="transition-opacity duration-250 ease-in-out"
    enter-from-class="opacity-50"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-250 ease-in-out"
    leave-from-class="opacity-100"
    leave-to-class="opacity-50"
  >
    <div v-if="isAroundWindowBorderFor250Ms && !isLoading" class="pointer-events-none absolute left-0 top-0 z-999 h-full w-full">
      <div
        :class="[
          'b-primary/50',
          'h-full w-full animate-flash animate-duration-3s animate-count-infinite b-4 rounded-2xl',
        ]"
      />
    </div>
  </Transition>
</template>

<style scoped>
@keyframes wall-move {
  0% {
    transform: translateX(calc(var(--wall-width) * -2));
  }
  100% {
    transform: translateX(calc(var(--wall-width) * 1));
  }
}

.wall {
  --at-apply: text-primary-300;

  --wall-width: 8px;
  animation: wall-move 1s linear infinite;
  background-image: repeating-linear-gradient(
    45deg,
    currentColor,
    currentColor var(--wall-width),
    #ff00 var(--wall-width),
    #ff00 calc(var(--wall-width) * 2)
  );
  width: calc(100% + 4 * var(--wall-width));
}
</style>

<route lang="yaml">
meta:
  layout: stage
</route>
