import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import PerceptionControlSurface from './PerceptionControlSurface.vue'

const SCREEN_FRAME_CONSENT = 'I authorize the selected screen frames to be uploaded to Qwen for this session; uploaded frames may enter service logs retained for one month.'
const SCREEN_AUDIO_CONSENT = 'I separately authorize real microphone audio to be uploaded to Qwen for this screen session; uploaded audio may enter service logs retained for one month. No model transcript or audio output will enter chat.'
const CAMERA_FRAME_CONSENT = 'I authorize camera frames to be uploaded to Qwen for this session; uploaded frames may enter service logs retained for one month.'
const CAMERA_AUDIO_CONSENT = 'I separately authorize real microphone audio to be uploaded to Qwen for this camera session; uploaded audio may enter service logs retained for one month. No model transcript or audio output will enter chat.'

const mocks = vi.hoisted(() => ({
  screen: {
    status: { value: {
      state: 'idle',
      generation: 0,
      samplingRate: 2,
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
    samplingRate: { value: 2 },
    refreshSources: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    setSensitiveSurfacePaused: vi.fn(),
    confirmFact: vi.fn(),
    retractFact: vi.fn(),
    clearFacts: vi.fn(),
    setSamplingRate: vi.fn(),
  },
  camera: {
    status: { value: {
      state: 'idle',
      generation: 0,
      samplingRate: 10,
      acceptedFactCount: 0,
      observationCount: 0,
      droppedFrameCount: 0,
      analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
      analyzerErrorCodes: {},
    } },
    remoteStatuses: { value: [] },
    observability: { value: null },
    samplingRate: { value: 10 },
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    confirmFact: vi.fn(),
    retractFact: vi.fn(),
    clearFacts: vi.fn(),
    setSamplingRate: vi.fn(),
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
  pairing: {
    requests: { __v_isRef: true, value: [] },
    devices: { __v_isRef: true, value: [] },
    error: { __v_isRef: true, value: undefined },
    refresh: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
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
      providerDataBoundary: 'cn-mainland-no-cross-region-or-cross-border',
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
      samplingRate: 2,
    } },
    screenSources: { value: [] as Array<{ id: string, name: string, kind: 'screen' | 'window' }> },
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
      samplingRate: 10,
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

vi.mock('../../composables/perception/use-minecraft-pairing', () => ({
  useMinecraftPairing: () => mocks.pairing,
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
            'perception-screen': {
              'tab': 'Desktop',
              'sampling-rate': 'Frame check frequency',
              'sampling-rate-option': '{rate} per second',
              'capture-profile': '{resolution} · {rate} checks per second · analyzer admission remains 0.2–1 frame per second',
            },
            'perception-camera': {
              'tab': 'Camera',
              'sampling-rate': 'Camera sampling frequency',
              'sampling-rate-option': '{rate} per second',
              'capture-profile': '640×360 · MediaPipe target {rate} per second · OpenCV up to 10 per second · YOLO up to 2 per second',
            },
            'perception-cloud': {
              'tab': 'Cloud',
              'title': 'Qwen cloud perception',
              'endpoint': 'Region: {region}',
              'region-label': 'China mainland',
              'region-boundary': 'China mainland Endpoint traffic does not cross regions or borders.',
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
              'screen-frame-consent': SCREEN_FRAME_CONSENT,
              'screen-audio-consent': SCREEN_AUDIO_CONSENT,
              'capture-state': 'Capture',
              'windows': 'Windows',
              'facts': 'Fresh facts',
              'start-screen': 'Start screen cloud perception',
              'pause-screen': 'Pause',
              'stop-screen': 'Stop and revoke',
              'camera-session-title': 'Camera cloud session',
              'camera-mixed-description': 'Local analyzers remain active.',
              'camera-frame-consent': CAMERA_FRAME_CONSENT,
              'camera-audio-consent': CAMERA_AUDIO_CONSENT,
              'camera-privacy-mode': 'Privacy mode',
              'resolution': 'Resolution',
              'start-camera': 'Start camera cloud perception',
              'sampling-rate': 'Sampling attempt frequency',
              'sampling-rate-option': '{rate} per second',
              'sampling-rate-limit': 'Target {target} per second; cloud upload remains capped at {limit} per second.',
              'screen-model': 'Screen',
              'screen-route-value': 'Flash with temporary Plus',
              'camera-model': 'Camera',
              'output': 'Output',
              'text-only-manual': 'Text-only objective JSON',
              'retention': 'Retention',
              'retention-value': 'Service logs: one month · session context cleared on disconnect · not used for training, improvement, evaluation, or human review',
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

// Found by code review 2026-07-26 (M2/M3 follow-up review)
//
// ROOT CAUSE:
//
// `PerceptionControlSurface.vue` gained a deep-link reader —
// `const route = useRoute()` plus `route.query[perceptionSourceQueryParam]`
// evaluated during `setup` — while every case here rendered the component with
// only the i18n plugin installed. `useRoute()` is `inject(routeLocationKey)`
// with no default (vue-router 5.0.4,
// `node_modules/vue-router/dist/useApi-C8XBqGtv.js:196`), so without a router
// it resolves to `undefined` and `route.query` throws
// `TypeError: Cannot read properties of undefined` before the surface mounts —
// every case in this file would fail at `render`.
//
// We fixed this in the test rather than in the component: production always
// renders this surface under the renderer router (`pages/settings/modules/
// perception.vue` and `components/stage-islands/controls-island/
// ControlsIslandPerception.vue` are both routed), so a memory-history router
// is what the real environment provides.
function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/settings/modules/perception', component: { template: '<div />' } },
    ],
  })
}

describe('perception control surface', () => {
  beforeEach(() => {
    mocks.screen.samplingRate = shallowRef(2)
    mocks.camera.samplingRate = shallowRef(10)
    mocks.cloudPerception.screenStatus = shallowRef({
      ...mocks.cloudPerception.screenStatus.value,
      state: 'idle',
      captureState: 'idle',
    })
    mocks.cloudPerception.cameraStatus = shallowRef({
      ...mocks.cloudPerception.cameraStatus.value,
      state: 'idle',
      captureState: 'idle',
    })
    mocks.screen.status.value.samplingRate = 2
    mocks.camera.status.value.samplingRate = 10
    mocks.cloudPerception.screenStatus.value.samplingRate = 2
    mocks.cloudPerception.cameraStatus.value.samplingRate = 10
    mocks.cloudPerception.screenSources.value = []
    mocks.cloud.status.value.state = 'blocked'
    mocks.screen.setSamplingRate.mockImplementation((rate) => {
      mocks.screen.samplingRate.value = rate
      mocks.screen.status.value.samplingRate = rate
      mocks.cloudPerception.screenStatus.value.samplingRate = rate
    })
    mocks.camera.setSamplingRate.mockImplementation((rate) => {
      mocks.camera.samplingRate.value = rate
      mocks.camera.status.value.samplingRate = rate
      mocks.cloudPerception.cameraStatus.value.samplingRate = rate
    })
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
      mocks.cloudPerception.startScreen,
      mocks.cloudPerception.pauseScreen,
      mocks.cloudPerception.stopScreen,
      mocks.cloudPerception.startCamera,
      mocks.cloudPerception.pauseCamera,
      mocks.cloudPerception.stopCamera,
    ])
      fn.mockClear()
  })

  it('exposes Minecraft as a first-class source with explicit session consent', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
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

  it('keeps desktop and camera rates independent and shares them with cloud controls', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('combobox', { name: 'Frame check frequency' }).selectOptions('5')
    expect(mocks.screen.setSamplingRate).toHaveBeenCalledWith(5)

    await screen.getByRole('button', { name: 'Camera' }).click()
    await screen.getByRole('combobox', { name: 'Camera sampling frequency' }).selectOptions('30')
    expect(mocks.camera.setSamplingRate).toHaveBeenCalledWith(30)

    await screen.getByRole('button', { name: 'Cloud' }).click()
    const frequencyControls = screen.getByRole('combobox', { name: 'Sampling attempt frequency' })
    await expect.element(frequencyControls.nth(0)).toHaveValue('30')
    await expect.element(frequencyControls.nth(1)).toHaveValue('5')
    await expect.element(screen.getByText('Target 30 per second; cloud upload remains capped at 1 per second.')).toBeVisible()
    await expect.element(screen.getByText('Target 5 per second; cloud upload remains capped at 1 per second.')).toBeVisible()
  })

  it('distinguishes target sampling from analyzer admission limits', async () => {
    mocks.screen.status.value.state = 'running'
    mocks.screen.status.value.samplingRate = 30
    mocks.screen.samplingRate = shallowRef(30)
    mocks.camera.status.value.state = 'running'
    mocks.camera.status.value.samplingRate = 30
    mocks.camera.samplingRate = shallowRef(30)

    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await expect.element(screen.getByText('1280×720 · 30 checks per second · analyzer admission remains 0.2–1 frame per second')).toBeVisible()
    await screen.getByRole('button', { name: 'Camera' }).click()
    await expect.element(screen.getByText('640×360 · MediaPipe target 30 per second · OpenCV up to 10 per second · YOLO up to 2 per second')).toBeVisible()
  })

  it('pauses every active local source from one control', async () => {
    mocks.screen.status.value.state = 'running'
    mocks.camera.status.value.state = 'running'
    mocks.minecraft.perceptionEnabled = true

    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })
    await screen.getByRole('button', { name: 'Pause all perception' }).click()

    expect(mocks.screen.pause).toHaveBeenCalledOnce()
    expect(mocks.camera.pause).toHaveBeenCalledOnce()
    expect(mocks.minecraftContext.pause).toHaveBeenCalledOnce()
  })

  it('shows the remote-owner state without a second consent control', async () => {
    mocks.minecraftContext.hasRemoteOwner.value = true
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Minecraft' }).click()
    await expect.element(screen.getByText(/Another AIRI window is collecting perception/)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Stop and revoke' })).toBeVisible()
  })

  it('shows cloud policy as inert until external readiness is verified', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await expect.element(screen.getByRole('heading', { name: 'Qwen cloud perception' })).toBeVisible()
    await expect.element(screen.getByText('No cloud upload is active.')).toBeVisible()
    await expect.element(screen.getByText('Blocked')).toBeVisible()
    await expect.element(screen.getByText('China mainland Endpoint traffic does not cross regions or borders.')).toBeVisible()
    await expect.element(screen.getByText('Service logs: one month · session context cleared on disconnect · not used for training, improvement, evaluation, or human review')).toBeVisible()
  })

  it('confirms that a cloud configuration check completed without enabling uploads', async () => {
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await screen.getByRole('button', { name: 'Validate configuration' }).click()

    expect(mocks.cloud.validate).toHaveBeenCalledOnce()
    await expect.element(screen.getByText('Configuration check completed. Cloud upload remains off.')).toBeVisible()
  })

  it('requires separate frame and microphone authorization for both cloud sources', async () => {
    mocks.cloud.status.value.state = 'ready'
    mocks.cloudPerception.screenSources.value = [{ id: 'window:screen', name: 'Editor', kind: 'window' }]
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await screen.getByRole('combobox', { name: 'Select a screen or window' }).selectOptions('window:screen')

    const startScreen = screen.getByRole('button', { name: 'Start screen cloud perception' })
    const screenFrameConsent = screen.getByRole('checkbox', { name: SCREEN_FRAME_CONSENT })
    const screenAudioConsent = screen.getByRole('checkbox', { name: SCREEN_AUDIO_CONSENT })
    await screenFrameConsent.click()
    await expect.element(startScreen).toBeDisabled()
    await screenAudioConsent.click()
    await expect.element(startScreen).toBeEnabled()
    await startScreen.click()
    expect(mocks.cloudPerception.startScreen).toHaveBeenCalledWith('window:screen', true, true)

    const startCamera = screen.getByRole('button', { name: 'Start camera cloud perception' })
    const cameraFrameConsent = screen.getByRole('checkbox', { name: CAMERA_FRAME_CONSENT })
    const cameraAudioConsent = screen.getByRole('checkbox', { name: CAMERA_AUDIO_CONSENT })
    await cameraAudioConsent.click()
    await expect.element(startCamera).toBeDisabled()
    await cameraFrameConsent.click()
    await expect.element(startCamera).toBeEnabled()
    await startCamera.click()
    expect(mocks.cloudPerception.startCamera).toHaveBeenCalledWith(true, true)
  })

  it('disables cloud source selection and authorization while startup is in progress', async () => {
    mocks.cloud.status.value.state = 'ready'
    mocks.cloudPerception.screenSources.value = [{ id: 'window:screen', name: 'Editor', kind: 'window' }]
    mocks.cloudPerception.screenStatus.value = { ...mocks.cloudPerception.screenStatus.value, captureState: 'starting' }
    mocks.cloudPerception.cameraStatus.value = { ...mocks.cloudPerception.cameraStatus.value, captureState: 'starting' }
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()

    await expect.element(screen.getByRole('combobox', { name: 'Select a screen or window' })).toBeDisabled()
    await expect.element(screen.getByRole('checkbox', { name: SCREEN_FRAME_CONSENT })).toBeDisabled()
    await expect.element(screen.getByRole('checkbox', { name: SCREEN_AUDIO_CONSENT })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Start screen cloud perception' })).toBeDisabled()
    await expect.element(screen.getByRole('checkbox', { name: CAMERA_FRAME_CONSENT })).toBeDisabled()
    await expect.element(screen.getByRole('checkbox', { name: CAMERA_AUDIO_CONSENT })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Start camera cloud perception' })).toBeDisabled()
  })

  it('clears both cloud authorizations after pause and requires reauthorization', async () => {
    mocks.cloud.status.value.state = 'ready'
    mocks.cloudPerception.screenSources.value = [{ id: 'window:screen', name: 'Editor', kind: 'window' }]
    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), testRouter()] },
    })

    await screen.getByRole('button', { name: 'Cloud' }).click()
    await screen.getByRole('combobox', { name: 'Select a screen or window' }).selectOptions('window:screen')
    const screenFrameConsent = screen.getByRole('checkbox', { name: SCREEN_FRAME_CONSENT })
    const screenAudioConsent = screen.getByRole('checkbox', { name: SCREEN_AUDIO_CONSENT })
    await screenFrameConsent.click()
    await screenAudioConsent.click()
    mocks.cloudPerception.screenStatus.value = { ...mocks.cloudPerception.screenStatus.value, state: 'running', captureState: 'running' }
    await screen.getByRole('button', { name: 'Pause', exact: true }).click()
    mocks.cloudPerception.screenStatus.value = { ...mocks.cloudPerception.screenStatus.value, state: 'idle', captureState: 'paused' }
    await expect.element(screenFrameConsent).not.toBeChecked()
    await expect.element(screenAudioConsent).not.toBeChecked()
    await expect.element(screen.getByRole('button', { name: 'Start screen cloud perception' })).toBeDisabled()

    const cameraFrameConsent = screen.getByRole('checkbox', { name: CAMERA_FRAME_CONSENT })
    const cameraAudioConsent = screen.getByRole('checkbox', { name: CAMERA_AUDIO_CONSENT })
    await cameraFrameConsent.click()
    await cameraAudioConsent.click()
    mocks.cloudPerception.cameraStatus.value = { ...mocks.cloudPerception.cameraStatus.value, state: 'running', captureState: 'running' }
    await screen.getByRole('button', { name: 'Pause', exact: true }).click()
    mocks.cloudPerception.cameraStatus.value = { ...mocks.cloudPerception.cameraStatus.value, state: 'idle', captureState: 'paused' }
    await expect.element(cameraFrameConsent).not.toBeChecked()
    await expect.element(cameraAudioConsent).not.toBeChecked()
    await expect.element(screen.getByRole('button', { name: 'Start camera cloud perception' })).toBeDisabled()
  })

  // The router is not incidental scaffolding: the pairing notification opens
  // the settings window on `perceptionSettingsRoute(...)` and the surface picks
  // its tab from that query. Pinning it here keeps the router a stated
  // dependency instead of something a later edit could drop again.
  it('preselects the tab a deep link asks for', async () => {
    const router = testRouter()
    // The cloud tab stands in for any deep-linked tab here: it is the one
    // panel that mounts without an Electron ipcRenderer, so this case measures
    // the query handling rather than the renderer environment.
    await router.push('/settings/modules/perception?source=cloud&pairingRequest=req-1')
    await router.isReady()

    const screen = await render(PerceptionControlSurface, {
      global: { plugins: [testI18n(), router] },
    })

    await expect.element(screen.getByRole('heading', { name: 'Qwen cloud perception' })).toBeVisible()
  })
})
