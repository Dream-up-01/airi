import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import {
  QWEN3_ASR_LOCAL_DEFAULT_MODEL,
  QWEN3_ASR_LOCAL_PROVIDER_ID,
  SENSEVOICE_LOCAL_DEFAULT_MODEL,
  SENSEVOICE_LOCAL_PROVIDER_ID,
  useProvidersStore,
} from '@proj-airi/stage-ui/stores/providers'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import DeclaredLocalAsrSwitcher from './DeclaredLocalAsrSwitcher.vue'

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  quiesce: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('../../../../composables/use-local-voice-service-start', () => ({
  startLocalVoiceService: mocks.start,
  stopLocalVoiceService: mocks.stop,
}))

vi.mock('@proj-airi/stage-ui/services/voice-settings-sync', () => ({
  notifyVoiceSettingsChanged: mocks.notify,
  voiceSettingsStorageKeys: {
    providerCredentials: 'settings/credentials/providers',
    activeTranscriptionProvider: 'settings/hearing/active-provider',
    activeTranscriptionModel: 'settings/hearing/active-model',
    activeTranscriptionCustomModel: 'settings/hearing/active-custom-model',
  },
}))

vi.mock('../../../../composables/use-local-voice-service-switch', async () => {
  const actual = await vi.importActual<typeof import('../../../../composables/use-local-voice-service-switch')>(
    '../../../../composables/use-local-voice-service-switch',
  )
  return {
    ...actual,
    quiesceVoiceRuntimeForSwitch: mocks.quiesce,
  }
})

function testI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        settings: {
          pages: {
            modules: {
              hearing: {
                'voice-conversation': {
                  'local-asr': {
                    'title': 'Local ASR model switch',
                    'description': 'Start and validate a local model before switching.',
                    'current': 'Current: {provider} / {model}',
                    'current-other': 'Current ASR is outside the M2 matrix.',
                    'qwen-label': 'Qwen3-ASR 0.6B (local streaming)',
                    'sensevoice-label': 'SenseVoice-Small (local fallback)',
                    'use-qwen': 'Start and switch to Qwen3-ASR',
                    'use-sensevoice': 'Switch to SenseVoice',
                    'in-use': 'In use: {provider}',
                    'selected': 'Selected',
                    'selected-indicator': 'The green dot marks the selected provider; health is checked again during switching.',
                    'switching': 'Starting, checking, and switching the local ASR service…',
                    'configure': 'Configure provider endpoints',
                    'errors': {
                      desktop_required: 'Desktop required.',
                      launcher_missing: 'Launcher missing.',
                      launch_failed: 'Launch failed.',
                      startup_timeout: 'Startup timed out.',
                      app_stopping: 'App is stopping.',
                      validation_failed: 'Validation failed.',
                      unexpected: 'Unexpected activation error.',
                    },
                    'notices': {
                      'previous-service-not-managed': 'The previous service was not started by AIRI and was not force-closed.',
                      'previous-service-stop-failed': 'The new model is active, but the previous service could not be closed.',
                    },
                  },
                },
              },
            },
            providers: {
              provider: {
                'qwen3-asr-local': { description: 'Local streaming Qwen3-ASR.' },
                'sensevoice-local': { description: 'Local SenseVoice fallback.' },
              },
            },
          },
        },
      },
    },
  })
}

async function renderSwitcher() {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/settings/providers', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  const screen = await render(DeclaredLocalAsrSwitcher, {
    global: { plugins: [pinia, router, testI18n()] },
  })
  const hearingStore = useHearingStore(pinia)
  hearingStore.activeTranscriptionProvider = SENSEVOICE_LOCAL_PROVIDER_ID
  hearingStore.activeTranscriptionModel = SENSEVOICE_LOCAL_DEFAULT_MODEL
  hearingStore.activeCustomModelName = SENSEVOICE_LOCAL_DEFAULT_MODEL

  return { pinia, screen }
}

describe('declared local ASR switcher', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.notify.mockReset()
    mocks.quiesce.mockReset()
    mocks.quiesce.mockResolvedValue({ ok: true, timedOut: false })
    mocks.start.mockReset()
    mocks.start.mockResolvedValue({
      ok: true,
      serviceId: 'qwen3-asr',
      alreadyRunning: false,
    })
    mocks.stop.mockReset()
    mocks.stop.mockResolvedValue({ ok: true, serviceId: 'sensevoice', stopped: true })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('stops and disposes SenseVoice before it starts and validates Qwen', async () => {
    const { pinia, screen } = await renderSwitcher()
    const providersStore = useProvidersStore(pinia)
    const disposeProviderInstance = vi.fn().mockResolvedValue(undefined)
    providersStore.disposeProviderInstance = disposeProviderInstance
    providersStore.validateProvider = vi.fn().mockResolvedValue(true)

    await screen.getByRole('radio', { name: /Qwen3-ASR 0.6B/ }).click()

    const hearingStore = useHearingStore(pinia)
    await expect.poll(() => hearingStore.activeTranscriptionProvider).toBe(QWEN3_ASR_LOCAL_PROVIDER_ID)
    expect(hearingStore.activeTranscriptionModel).toBe(QWEN3_ASR_LOCAL_DEFAULT_MODEL)
    expect(mocks.start).toHaveBeenCalledWith('qwen3-asr')
    expect(providersStore.validateProvider).toHaveBeenCalledWith(QWEN3_ASR_LOCAL_PROVIDER_ID, { force: true })
    expect(mocks.notify).toHaveBeenCalledOnce()
    expect(mocks.stop).toHaveBeenCalledWith('sensevoice')
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0])
    expect(disposeProviderInstance.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0])
    await expect.element(screen.getByRole('radio', { name: /Qwen3-ASR 0.6B/ })).toBeChecked()
  })

  it('keeps the current model when the local service cannot start', async () => {
    mocks.start.mockResolvedValue({
      ok: false,
      serviceId: 'qwen3-asr',
      errorCode: 'launch_failed',
    })
    const { pinia, screen } = await renderSwitcher()

    await screen.getByRole('radio', { name: /Qwen3-ASR 0.6B/ }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('Launch failed.')
    expect(useHearingStore(pinia).activeTranscriptionProvider).toBe(SENSEVOICE_LOCAL_PROVIDER_ID)
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.stop).toHaveBeenCalledWith('sensevoice')
    await expect.element(screen.getByRole('radio', { name: /Qwen3-ASR 0.6B/ })).not.toBeChecked()
    await expect.element(screen.getByRole('radio', { name: /SenseVoice-Small/ })).toBeChecked()
  })
})
