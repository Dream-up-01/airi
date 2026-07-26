import type { PerceptionConsentGrant } from '../../domains/perception'
import type { SharedMicrophoneLease } from '../../services/perception'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'

import { useAudioDevice } from '../../composables/audio'
import { parsePerceptionConsentGrant } from '../../domains/perception'
import { SharedMicrophoneCaptureOwner } from '../../services/perception'

export type MicrophonePermissionLifecycleState = 'idle' | 'requesting' | 'granted' | 'denied' | 'failed'
export type MicrophonePermissionFailureReason = 'request-denied' | 'revoked' | 'device-unavailable'

export interface MicrophonePermissionLifecycle {
  requestId?: string
  state: MicrophonePermissionLifecycleState
  updatedAt: number
  failureReason?: MicrophonePermissionFailureReason
}

let microphonePermissionStatus: PermissionStatus | undefined

export const useSettingsAudioDevice = defineStore('settings-audio-devices', () => {
  const {
    audioInputs,
    deviceConstraints,
    selectedAudioInput: selectedAudioInputNonPersist,
    startStream: startAudioInputStream,
    stopStream: stopAudioInputStream,
    stream,
    askPermission: askAudioInputPermission,
  } = useAudioDevice()

  const selectedAudioInputPersist = useLocalStorageManualReset<string>('settings/audio/input', selectedAudioInputNonPersist.value)
  const audioInputEnabled = useLocalStorageManualReset<boolean>('settings/audio/input/enabled', false)
  const microphonePermission = shallowRef<MicrophonePermissionLifecycle>({
    state: 'idle',
    updatedAt: Date.now(),
  })
  const sharedMicrophoneState = shallowRef({
    active: false,
    consumerCount: 0,
  })
  let audioInputStartGeneration = 0
  let microphonePermissionRequestSequence = 0
  let microphonePermissionRequest: Promise<void> | undefined
  let canonicalMicrophoneLease: SharedMicrophoneLease<MediaStream> | undefined

  const sharedMicrophoneOwner = new SharedMicrophoneCaptureOwner<MediaStream>({
    async openStream() {
      const startedStream = await startAudioInputStream()
      const activeStream = startedStream ?? stream.value
      if (!activeStream)
        throw new Error('microphone_stream_unavailable')
      return activeStream
    },
    closeStream(activeStream) {
      if (stream.value === activeStream) {
        stopAudioInputStream()
        return
      }
      activeStream.getTracks().forEach(track => track.stop())
    },
    onTrackEnded() {
      canonicalMicrophoneLease = undefined
      stopAudioInputStream()
      updateSharedMicrophoneState()
      updateMicrophonePermission('failed', { failureReason: 'device-unavailable' })
      audioInputEnabled.value = false
    },
  })

  function updateSharedMicrophoneState() {
    sharedMicrophoneState.value = {
      active: sharedMicrophoneOwner.active,
      consumerCount: sharedMicrophoneOwner.consumerCount,
    }
  }

  function syncSelectedAudioInputFromRuntime() {
    if (selectedAudioInputPersist.value !== selectedAudioInputNonPersist.value)
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
  }

  function syncSelectedAudioInputToRuntime() {
    if (selectedAudioInputPersist.value && selectedAudioInputPersist.value !== selectedAudioInputNonPersist.value)
      selectedAudioInputNonPersist.value = selectedAudioInputPersist.value
  }

  function updateMicrophonePermission(
    state: MicrophonePermissionLifecycleState,
    options: { requestId?: string, failureReason?: MicrophonePermissionFailureReason } = {},
  ) {
    microphonePermission.value = {
      requestId: options.requestId ?? microphonePermission.value.requestId,
      state,
      updatedAt: Date.now(),
      failureReason: options.failureReason,
    }
  }

  function nextMicrophonePermissionRequestId() {
    microphonePermissionRequestSequence += 1
    return `microphone-permission-${microphonePermissionRequestSequence}`
  }

  function markMicrophonePermissionFailure(error: unknown, requestId?: string) {
    const isDenied = error instanceof DOMException
      && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')

    updateMicrophonePermission(isDenied ? 'denied' : 'failed', {
      requestId,
      failureReason: isDenied ? 'request-denied' : 'device-unavailable',
    })
  }

  function askPermission() {
    if (microphonePermission.value.state === 'granted')
      return Promise.resolve()

    if (microphonePermissionRequest)
      return microphonePermissionRequest

    const requestId = nextMicrophonePermissionRequestId()
    updateMicrophonePermission('requesting', { requestId })
    microphonePermissionRequest = (async () => {
      try {
        syncSelectedAudioInputToRuntime()
        await askAudioInputPermission()
        syncSelectedAudioInputFromRuntime()
        updateMicrophonePermission('granted', { requestId })
      }
      catch (error) {
        markMicrophonePermissionFailure(error, requestId)
        throw error
      }
      finally {
        microphonePermissionRequest = undefined
      }
    })()

    return microphonePermissionRequest
  }

  function createAudioInputStartGeneration() {
    audioInputStartGeneration += 1
    return audioInputStartGeneration
  }

  function invalidateAudioInputStarts() {
    audioInputStartGeneration += 1
  }

  async function startStreamForGeneration(generation: number) {
    await askPermission()

    syncSelectedAudioInputToRuntime()
    let lease: SharedMicrophoneLease<MediaStream>
    try {
      lease = await sharedMicrophoneOwner.acquire(`canonical-transcript:${generation}`)
      updateSharedMicrophoneState()
    }
    catch (error) {
      if (generation === audioInputStartGeneration)
        markMicrophonePermissionFailure(error, microphonePermission.value.requestId)
      throw error
    }

    if (generation !== audioInputStartGeneration) {
      lease.release()
      updateSharedMicrophoneState()
      return
    }

    canonicalMicrophoneLease?.release()
    canonicalMicrophoneLease = lease
    updateSharedMicrophoneState()
    syncSelectedAudioInputFromRuntime()
  }

  async function startStream() {
    await startStreamForGeneration(createAudioInputStartGeneration())
  }

  function stopStream() {
    invalidateAudioInputStarts()
    canonicalMicrophoneLease?.release()
    canonicalMicrophoneLease = undefined
    updateSharedMicrophoneState()
  }

  function stopAllMicrophoneStreams() {
    invalidateAudioInputStarts()
    canonicalMicrophoneLease = undefined
    sharedMicrophoneOwner.stopAll()
    updateSharedMicrophoneState()
  }

  async function acquirePerceptionStream(input: unknown) {
    const parsed = parsePerceptionConsentGrant(input)
    if (!parsed.success || !isCloudMicrophoneGrant(parsed.output))
      throw new Error('perception_cloud_audio_consent_invalid')

    const grant = parsed.output
    await askPermission()
    syncSelectedAudioInputToRuntime()
    const lease = await sharedMicrophoneOwner.acquire(`cloud-perception:${grant.grantId}`)
    updateSharedMicrophoneState()
    syncSelectedAudioInputFromRuntime()

    let released = false
    return {
      ...lease,
      release() {
        if (released)
          return
        released = true
        lease.release()
        updateSharedMicrophoneState()
      },
    }
  }

  function handleStartStreamError(generation: number, error: unknown, message: string) {
    console.error(message, error)

    if (generation === audioInputStartGeneration)
      audioInputEnabled.value = false
  }

  watch(selectedAudioInputPersist, (newValue) => {
    selectedAudioInputNonPersist.value = newValue
  })

  watch(audioInputEnabled, (val) => {
    if (val) {
      const generation = createAudioInputStartGeneration()
      startStreamForGeneration(generation).catch((error) => {
        handleStartStreamError(generation, error, 'Unable to start audio input stream:')
      })
    }
    else {
      stopStream()
    }
  })

  // permissionGranted from vueuse does not track revocation yet.
  // implement it manually.
  try {
    navigator?.permissions?.query({ name: 'microphone' }).then((status) => {
      microphonePermissionStatus = status // existing one cleaned up by GC
      status.onchange = () => {
        if (status.state === 'granted') {
          updateMicrophonePermission('granted')
          return
        }

        if (status.state === 'denied' || status.state === 'prompt') {
          updateMicrophonePermission('denied', { failureReason: 'revoked' })
          stopAllMicrophoneStreams()
          audioInputEnabled.value = false
        }
      }
    })
  }
  catch (e) { console.info(`Unable to track microphone permission: ${e}`) }
  void microphonePermissionStatus // suppress unused variable lint
  function initialize() {
    const hasSelectedInput = selectedAudioInputPersist.value
      && audioInputs.value.some(device => device.deviceId === selectedAudioInputPersist.value)

    if (hasSelectedInput)
      syncSelectedAudioInputToRuntime()

    if (audioInputEnabled.value && hasSelectedInput) {
      const generation = createAudioInputStartGeneration()
      startStreamForGeneration(generation).catch((error) => {
        handleStartStreamError(generation, error, 'Unable to initialize audio input stream:')
      })
    }
    else if (selectedAudioInputPersist.value && audioInputs.value.length > 0 && !hasSelectedInput) {
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
    }
    if (selectedAudioInputNonPersist.value && !audioInputEnabled.value) {
      selectedAudioInputPersist.value = selectedAudioInputNonPersist.value
    }
  }

  function resetState() {
    selectedAudioInputPersist.reset()
    selectedAudioInputNonPersist.value = ''
    audioInputEnabled.reset()
    stopAllMicrophoneStreams()
  }

  return {
    audioInputs,
    deviceConstraints,
    selectedAudioInput: selectedAudioInputPersist,
    enabled: audioInputEnabled,

    stream,
    microphonePermission,
    sharedMicrophoneState,

    initialize,

    askPermission,
    acquirePerceptionStream,
    startStream,
    stopStream,
    stopAllMicrophoneStreams,
    resetState,
  }
})

function isCloudMicrophoneGrant(grant: PerceptionConsentGrant): boolean {
  return grant.revokedAt === undefined
    && (grant.processingMode === 'cloud-approved' || grant.processingMode === 'mixed')
    && grant.allowedModalities.includes('microphone-audio')
    && !!grant.cloudProviderId
    && !!grant.cloudModelId
    && !!grant.regionId
    && !!grant.costBoundaryId
    && grant.showPersistentIndicator
}
