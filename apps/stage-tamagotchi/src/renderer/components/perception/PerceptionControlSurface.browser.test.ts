import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import PerceptionControlSurface from './PerceptionControlSurface.vue'

const mocks = vi.hoisted(() => ({
  screen: {
    status: { value: {
      state: 'idle',
      generation: 0,
      acceptedFactCount: 0,
      captureAttemptCount: 0,
      acceptedFrameCount: 0,
      gateDroppedFrameCount: 0,
      analyzerReplacedFrameCount: 0,
      inferenceFactCount: 0,
      sensitiveSurfacePaused: false,
    } },
    sources: { value: [] },
    isRefreshingSources: { value: false },
    uiErrorCode: { value: undefined },
    remoteStatuses: { value: [] },
    observability: { value: null },
    refreshSources: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setSensitiveSurfacePaused: vi.fn(),
    confirmFact: vi.fn(),
    retractFact: vi.fn(),
    clearFacts: vi.fn(),
  },
  camera: {
    status: { value: {
      state: 'idle',
      generation: 0,
      acceptedFactCount: 0,
      observationCount: 0,
      droppedFrameCount: 0,
      analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
      analyzerErrorCodes: {},
    } },
    remoteStatuses: { value: [] },
    observability: { value: null },
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    confirmFact: vi.fn(),
    retractFact: vi.fn(),
    clearFacts: vi.fn(),
  },
  minecraft: {
    configured: false,
    serviceConnected: false,
    runtimeContextAgeMs: 0,
    perceptionEnabled: false,
    perceptionPaused: false,
    perceptionObservability: null,
    acceptedFactCount: 0,
    rejectedEventCount: 0,
    suppressedEventCount: 0,
    lastRejectionCode: undefined,
    initialize: vi.fn(),
    enablePerception: vi.fn(),
    disablePerception: vi.fn(),
    pausePerception: vi.fn(),
    resumePerception: vi.fn(),
    confirmFact: vi.fn(),
    retractFact: vi.fn(),
    clearFacts: vi.fn(),
  },
  minecraftContext: {
    state: { __v_isRef: true, value: 'off' },
    remoteStatuses: { __v_isRef: true, value: [] },
    hasRemoteOwner: { __v_isRef: true, value: false },
    lastControlErrorCode: { __v_isRef: true, value: undefined },
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
  cloud: {
    status: { value: {
      state: 'blocked',
      workspaceConfigured: false,
      apiKeyConfigured: false,
      providerRetentionVerified: false,
      modelAvailabilityVerified: false,
      providerClientAvailable: false,
      costLedgerAvailable: true,
      uploadActive: false,
      cost: { sessionSpent: 0, daySpent: 0, monthSpent: 0 },
    } },
    isLoading: { value: false },
    lastErrorCode: { value: undefined },
    refresh: vi.fn(async () => {}),
    validate: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
  cloudPerception: {
    screenStatus: { value: {
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
    } },
    screenSources: { value: [] },
    isRefreshingSources: { value: false },
    observability: { value: null },
    cameraStatus: { value: {
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
    } },
    cameraObservability: { value: null },
    refreshScreenSources: vi.fn(async () => {}),
    startScreen: vi.fn(async () => {}),
    pauseScreen: vi.fn(async () => {}),
    stopScreen: vi.fn(async () => {}),
    startCamera: vi.fn(async () => {}),
    pauseCamera: vi.fn(async () => {}),
    stopCamera: vi.fn(async () => {}),
    setCameraPrivacyMode: vi.fn(),
  },
}))

vi.mock('../../composables/perception/use-local-screen-perception', () => ({
  useLocalScreenPerception: () => mocks.screen,
}))

vi.mock('../../composables/perception/use-local-camera-perception', () => ({
  useLocalCameraPerception: () => mocks.camera,
}))

vi.mock('../../composables/perception/use-minecraft-perception', () => ({
  useMinecraftPerception: () => ({ ...mocks.minecraftContext, store: mocks.minecraft }),
}))

vi.mock('../../composables/perception/use-qwen-cloud-control', () => ({
  useQwenCloudControl: () => mocks.cloud,
}))

vi.mock('../../composables/perception/use-qwen-cloud-perception', () => ({
  useQwenCloudPerception: () => mocks.cloudPerception,
}))

function testI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      en: {
        tamagotchi: {
          stage: {
            'perception-control': { 'pause-all': 'Pause all perception' },
            'perception-runtime': {
              'remote-read-only': 'Another AIRI window is collecting perception. This window is read-only.',
            },
            'perception-screen': { tab: 'Desktop' },
            'perception-camera': { tab: 'Camera' },
            'perception-cloud': {
              'tab': 'Cloud',
              'title': 'Qwen cloud perception',
              'endpoint': 'Region: {region}',
              'region-label': 'China mainland',
              'no-upload': 'No cloud upload is active.',
              'upload-active': 'Cloud upload is active.',
              'refresh': 'Refresh cloud status',
              'validate': 'Validate configuration',
              'validation-complete': 'Configuration check completed. Cloud upload remains off.',
              'stop': 'Stop cloud perception',
              'readiness-title': 'Configuration readiness',
              'readiness': { 'workspace': 'Workspace', 'api-key': 'API key', 'retention': 'Retention', 'models': 'Models', 'transport': 'Transport' },
              'readiness-state': { ready: 'Verified', pending: 'Pending' },
              'models-title': 'Fixed routing policy',
              'screen-session-title': 'Screen cloud session',
              'refresh-sources': 'Refresh sources',
              'select-screen-source': 'Select a screen or window',
              'screen-audio-consent': 'Authorize screen frames and real microphone audio.',
              'capture-state': 'Capture',
              'windows': 'Windows',
              'facts': 'Fresh facts',
              'start-screen': 'Start screen cloud perception',
              'pause-screen': 'Pause',
              'stop-screen': 'Stop and revoke',
              'camera-session-title': 'Camera cloud session',
              'camera-mixed-description': 'Local analyzers remain active.',
              'camera-audio-consent': 'Authorize camera frames and real microphone audio.',
              'camera-privacy-mode': 'Privacy mode',
              'resolution': 'Resolution',
              'start-camera': 'Start camera cloud perception',
              'screen-model': 'Screen',
              'screen-route-value': 'Flash with temporary Plus',
              'camera-model': 'Camera',
              'output': 'Output',
              'text-only-manual': 'Text-only objective JSON',
              'retention': 'Retention',
              'retention-value': 'Shortest available',
              'budget-title': 'Cost guard',
              'budget': { session: 'Session', day: 'Day', month: 'Month' },
              'state': { loading: 'Loading', blocked: 'Blocked', ready: 'Ready', stopped: 'Stopped', failed: 'Failed' },
            },
            'perception-minecraft': {
              'tab': 'Minecraft',
              'title': 'Trusted Minecraft perception',
              'description': 'Structured game facts.',
              'privacy-notice': 'Local structured events only.',
              'runtime': 'Authenticated runtime',
              'processing': 'Processing',
              'local-structured': 'Local structured events',
              'no-runtime-context': 'No authenticated runtime.',
              'runtime-context-stale': 'Runtime update is stale.',
              'runtime-context-age': '{seconds}s ago',
              'counts': '{accepted} accepted, {rejected} rejected, {suppressed} suppressed',
              'last-rejection': 'Rejected: {code}',
              'consent': 'Allow authenticated structured Minecraft events for this session.',
              'start': 'Enable game perception',
              'pause': 'Pause',
              'resume': 'Resume',
              'stop': 'Stop and revoke',
              'state': {
                off: 'Game perception off',
                waiting: 'Waiting for authenticated runtime',
                running: 'Game perception active',
                paused: 'Game perception paused',
              },
            },
          },
        },
      },
    },
  })
}

describe('perception control surface', () => {
  beforeEach(() => {
    mocks.screen.status.value.state = 'idle'
    mocks.camera.status.value.state = 'idle'
    mocks.minecraft.perceptionEnabled = false
    mocks.minecraft.perceptionPaused = false
    mocks.minecraftContext.hasRemoteOwner.value = false
    for (const fn of [
      mocks.screen.refreshSources,
      mocks.screen.pause,
      mocks.camera.pause,
      mocks.minecraft.initialize,
      mocks.minecraftContext.start,
      mocks.minecraftContext.pause,
      mocks.cloud.refresh,
      mocks.cloud.validate,
      mocks.cloud.stop,
    ])
      fn.mockClear()
  })

  it('exposes Minecraft as a first-class source with explicit session consent', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n()] },
    })

    await screen.getByRole('button', { name: 'Minecraft' }).click()
    await expect.element(screen.getByRole('heading', { name: 'Trusted Minecraft perception' })).toBeVisible()

    const enable = screen.getByRole('button', { name: 'Enable game perception' })
    await expect.element(enable).toBeDisabled()
    await screen.getByRole('checkbox', { name: /Allow authenticated/ }).click()
    await expect.element(enable).toBeEnabled()
    await enable.click()
    expect(mocks.minecraftContext.start).toHaveBeenCalledWith(true)
  })

  it('pauses every active local source from one control', async () => {
    mocks.screen.status.value.state = 'running'
    mocks.camera.status.value.state = 'running'
    mocks.minecraft.perceptionEnabled = true

    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n()] },
    })
    await screen.getByRole('button', { name: 'Pause all perception' }).click()

    expect(mocks.screen.pause).toHaveBeenCalledOnce()
    expect(mocks.camera.pause).toHaveBeenCalledOnce()
    expect(mocks.minecraftContext.pause).toHaveBeenCalledOnce()
  })

  it('keeps consent controls read-only while another renderer owns perception', async () => {
    mocks.minecraftContext.hasRemoteOwner.value = true
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n()] },
    })

    await screen.getByRole('button', { name: 'Minecraft' }).click()
    await expect.element(screen.getByRole('checkbox', { name: /Allow authenticated/ })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Enable game perception' })).toBeDisabled()
  })

  it('shows cloud policy as inert until external readiness is verified', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await expect.element(screen.getByRole('heading', { name: 'Qwen cloud perception' })).toBeVisible()
    await expect.element(screen.getByText('No cloud upload is active.')).toBeVisible()
    await expect.element(screen.getByText('Blocked')).toBeVisible()
  })

  it('confirms that a cloud configuration check completed without enabling uploads', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await screen.getByRole('button', { name: 'Validate configuration' }).click()

    expect(mocks.cloud.validate).toHaveBeenCalledOnce()
    await expect.element(screen.getByText('Configuration check completed. Cloud upload remains off.')).toBeVisible()
  })
})
