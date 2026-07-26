import type { PerceptionConsentGrant } from '../../domains/perception'

import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createConsentGrant } from '../../domains/perception/test-fixtures'

const storageMock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}))

const audioDeviceMock = vi.hoisted(() => ({
  audioInputs: { value: [] as MediaDeviceInfo[] },
  selectedAudioInput: { value: '' },
  stream: { value: undefined as MediaStream | undefined },
  startStream: vi.fn(),
  stopStream: vi.fn(),
  askPermission: vi.fn(),
}))

const permissionStatusMock = vi.hoisted(() => ({
  state: 'prompt' as PermissionState,
  onchange: null as PermissionStatus['onchange'],
}))

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')

  return {
    useLocalStorageManualReset: <T>(key: string, initialValue: T) => {
      const value = vue.ref((storageMock.values.has(key) ? storageMock.values.get(key) : initialValue) as T)

      storageMock.values.set(key, value.value)
      vue.watch(value, (newValue) => {
        storageMock.values.set(key, newValue)
      }, { flush: 'sync' })

      return Object.assign(value, {
        reset: () => {
          value.value = initialValue
        },
      })
    },
  }
})

vi.mock('../../composables/audio', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')

  return {
    useAudioDevice: () => ({
      audioInputs: audioDeviceMock.audioInputs,
      deviceConstraints: vue.computed(() => ({ audio: true })),
      selectedAudioInput: audioDeviceMock.selectedAudioInput,
      startStream: audioDeviceMock.startStream,
      stopStream: audioDeviceMock.stopStream,
      stream: audioDeviceMock.stream,
      askPermission: audioDeviceMock.askPermission,
    }),
  }
})

function createAudioInput(deviceId: string): MediaDeviceInfo {
  return {
    deviceId,
    groupId: '',
    kind: 'audioinput',
    label: deviceId,
    toJSON: () => ({}),
  }
}

function createMockMediaStream(stopTrack = vi.fn()) {
  return {
    stream: {
      getAudioTracks: () => [{ stop: stopTrack }],
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream,
    stopTrack,
  }
}

function publishMockStream(stream = createMockMediaStream().stream) {
  audioDeviceMock.stream.value = stream
  return stream
}

function createCloudAudioGrant(overrides: Partial<PerceptionConsentGrant> = {}) {
  return createConsentGrant({
    grantId: 'grant:cloud-audio',
    processingMode: 'cloud-approved',
    allowedModalities: ['camera-frames', 'microphone-audio'],
    cloudProviderId: 'aliyun',
    cloudModelId: 'qwen3.5-omni-flash-realtime',
    regionId: 'cn-beijing',
    costBoundaryId: 'cost:default',
    ...overrides,
  })
}

describe('store settings-audio-devices', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
    storageMock.values.clear()
    audioDeviceMock.audioInputs.value = []
    audioDeviceMock.selectedAudioInput.value = ''
    audioDeviceMock.stream.value = undefined
    audioDeviceMock.stopStream.mockImplementation(() => {
      audioDeviceMock.stream.value = undefined
    })
    permissionStatusMock.state = 'prompt'
    permissionStatusMock.onchange = null
    vi.stubGlobal('navigator', {
      permissions: {
        query: vi.fn(async () => permissionStatusMock as PermissionStatus),
      },
    })
    vi.clearAllMocks()
    audioDeviceMock.startStream.mockImplementation(async () => publishMockStream())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('records permission request and grant before starting the microphone stream', async () => {
    const order: string[] = []
    audioDeviceMock.askPermission.mockImplementationOnce(async () => {
      order.push('permission')
    })
    audioDeviceMock.startStream.mockImplementationOnce(async () => {
      order.push('stream')
      return publishMockStream()
    })

    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    const start = store.startStream()
    expect(store.microphonePermission.state).toBe('requesting')
    await start

    expect(order).toEqual(['permission', 'stream'])
    expect(store.microphonePermission.state).toBe('granted')
    expect(store.microphonePermission.requestId).toBe('microphone-permission-1')
  })

  it('deduplicates concurrent permission requests from the application and stream lifecycle', async () => {
    let resolvePermission!: () => void
    audioDeviceMock.askPermission.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePermission = resolve
    }))

    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    const explicitRequest = store.askPermission()
    const streamStart = store.startStream()

    expect(audioDeviceMock.askPermission).toHaveBeenCalledOnce()
    resolvePermission()
    await Promise.all([explicitRequest, streamStart])

    expect(audioDeviceMock.startStream).toHaveBeenCalledOnce()
    expect(store.microphonePermission.state).toBe('granted')
  })

  it('shares one physical stream between canonical transcript and cloud perception', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    await store.startStream()
    const cloudLease = await store.acquirePerceptionStream(createCloudAudioGrant())

    expect(audioDeviceMock.startStream).toHaveBeenCalledOnce()
    expect(cloudLease.stream).toBe(audioDeviceMock.stream.value)
    expect(store.sharedMicrophoneState).toEqual({ active: true, consumerCount: 2 })

    cloudLease.release()
    expect(audioDeviceMock.stopStream).not.toHaveBeenCalled()
    expect(store.sharedMicrophoneState).toEqual({ active: true, consumerCount: 1 })

    store.stopStream()
    expect(audioDeviceMock.stopStream).toHaveBeenCalledOnce()
    expect(store.sharedMicrophoneState).toEqual({ active: false, consumerCount: 0 })
  })

  it('keeps cloud perception alive when the canonical transcript subscriber stops', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    const cloudLease = await store.acquirePerceptionStream(createCloudAudioGrant())
    await store.startStream()
    store.stopStream()

    expect(audioDeviceMock.startStream).toHaveBeenCalledOnce()
    expect(audioDeviceMock.stopStream).not.toHaveBeenCalled()
    expect(store.sharedMicrophoneState).toEqual({ active: true, consumerCount: 1 })

    cloudLease.release()
    expect(audioDeviceMock.stopStream).toHaveBeenCalledOnce()
    expect(store.sharedMicrophoneState).toEqual({ active: false, consumerCount: 0 })
  })

  it('rejects cloud audio access without a separate complete cloud microphone grant', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    await expect(store.acquirePerceptionStream(createConsentGrant())).rejects.toThrow('perception_cloud_audio_consent_invalid')
    await expect(store.acquirePerceptionStream(createCloudAudioGrant({
      allowedModalities: ['camera-frames'],
    }))).rejects.toThrow('perception_cloud_audio_consent_invalid')

    expect(audioDeviceMock.askPermission).not.toHaveBeenCalled()
    expect(audioDeviceMock.startStream).not.toHaveBeenCalled()
  })

  it('publishes a bounded denial state without storing the platform error', async () => {
    audioDeviceMock.askPermission.mockRejectedValueOnce(new DOMException('private device details', 'NotAllowedError'))

    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    await expect(store.askPermission()).rejects.toThrow('private device details')

    expect(store.microphonePermission).toMatchObject({
      state: 'denied',
      failureReason: 'request-denied',
    })
    expect(JSON.stringify(store.microphonePermission)).not.toContain('private device details')
  })

  it('disables input and marks a granted permission as revoked', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()
    await Promise.resolve()
    await store.askPermission()
    store.enabled = true
    await vi.waitFor(() => expect(store.sharedMicrophoneState.active).toBe(true))
    const cloudLease = await store.acquirePerceptionStream(createCloudAudioGrant())
    expect(store.sharedMicrophoneState.consumerCount).toBe(2)

    permissionStatusMock.state = 'denied'
    permissionStatusMock.onchange?.call(permissionStatusMock as PermissionStatus, {} as Event)
    await nextTick()

    expect(store.enabled).toBe(false)
    expect(store.microphonePermission).toMatchObject({
      state: 'denied',
      failureReason: 'revoked',
    })
    expect(audioDeviceMock.stopStream).toHaveBeenCalled()
    expect(store.sharedMicrophoneState).toEqual({ active: false, consumerCount: 0 })
    cloudLease.release()
    expect(audioDeviceMock.stopStream).toHaveBeenCalledOnce()
  })

  it('starts with the persisted microphone instead of overwriting it with the runtime default', async () => {
    storageMock.values.set('settings/audio/input', 'microphone-1')
    storageMock.values.set('settings/audio/input/enabled', true)
    audioDeviceMock.audioInputs.value = [
      createAudioInput('default'),
      createAudioInput('microphone-1'),
    ]
    audioDeviceMock.selectedAudioInput.value = 'default'

    const startedWith: string[] = []
    audioDeviceMock.startStream.mockImplementation(async () => {
      startedWith.push(audioDeviceMock.selectedAudioInput.value)
      return publishMockStream()
    })

    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    store.initialize()
    await vi.waitFor(() => expect(startedWith).toEqual(['microphone-1']))

    expect(store.selectedAudioInput).toBe('microphone-1')
    expect(storageMock.values.get('settings/audio/input')).toBe('microphone-1')
  })

  it('prevents an old pending stream from replacing a newer stream after global stop', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    const oldStream = createMockMediaStream()
    let resolveFirstStart!: () => void
    let resolveSecondStart!: () => void
    audioDeviceMock.startStream
      .mockImplementationOnce(() => new Promise<MediaStream>((resolve) => {
        resolveFirstStart = () => resolve(oldStream.stream)
      }))
      .mockImplementationOnce(() => new Promise<MediaStream>((resolve) => {
        resolveSecondStart = () => resolve(publishMockStream())
      }))

    const oldStart = store.startStream()
    await vi.waitFor(() => expect(resolveFirstStart).toBeTypeOf('function'))

    store.stopAllMicrophoneStreams()
    const currentStart = store.startStream()
    await vi.waitFor(() => expect(resolveSecondStart).toBeTypeOf('function'))

    resolveSecondStart()
    await currentStart

    resolveFirstStart()
    await expect(oldStart).rejects.toThrow('perception_microphone_acquire_cancelled')

    expect(oldStream.stopTrack).toHaveBeenCalledOnce()
    expect(store.microphonePermission.state).toBe('granted')
    expect(store.sharedMicrophoneState).toEqual({ active: true, consumerCount: 1 })
  })

  it('stops a microphone stream that finishes starting after input was disabled', async () => {
    const { useSettingsAudioDevice } = await import('./audio-device')
    const store = useSettingsAudioDevice()

    const stopTrack = vi.fn()
    const startedStream = createMockMediaStream(stopTrack).stream
    let resolveStart!: (stream: MediaStream) => void
    audioDeviceMock.startStream.mockImplementationOnce(() => new Promise<MediaStream>((resolve) => {
      resolveStart = resolve
    }))

    const start = store.startStream()
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf('function'))

    store.stopStream()

    audioDeviceMock.stream.value = startedStream
    resolveStart(startedStream)
    await start

    await vi.waitFor(() => expect(audioDeviceMock.stopStream).toHaveBeenCalledOnce())
    expect(audioDeviceMock.stream.value).toBeUndefined()
  })
})
