import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSpeechOutputRoutingStore } from '@proj-airi/stage-ui/stores/speech-output-routing'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import MiniMaxSpeechSettings from './minimax-speech.vue'

const mocks = vi.hoisted(() => ({
  quiesce: vi.fn(),
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
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      en: {
        settings: {
          pages: {
            providers: {
              provider: {
                'minimax-speech': {
                  title: 'MiniMax Speech',
                  settings: {
                    activation_failed: 'MiniMax validation failed.',
                    activation_ready_description: 'The selected voice and model are active.',
                    activation_ready_title: 'Voice-call speech is ready',
                    activate_button: 'Validate and use for voice calls',
                    cloud_description: 'Cloud speech notice',
                    cloud_title: 'Cloud speech and privacy',
                    configuration_description: 'Choose a model and voice.',
                    configuration_title: 'MiniMax voice-call configuration',
                    endpoint_description: 'Official MiniMax endpoint',
                    endpoint_label: 'MiniMax API endpoint',
                    endpoint_title: 'API endpoint',
                    model_label: 'Model',
                    voice_catalog_failed: 'Voice catalog failed.',
                    voice_description: 'Select a voice.',
                    voice_label: 'Call voice',
                    voice_required: 'Select a voice.',
                    voice_unavailable: 'Voice {id} is unavailable.',
                    clone: {
                      api_key_required: 'API key required',
                      custom_voice_name: 'Custom voice: {id}',
                      existing: {
                        title: 'Add existing voice',
                        description: 'Add an account voice.',
                        voice_id_label: 'Voice ID',
                        voice_id_description: 'Account voice ID',
                        submit: 'Add voice',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
}

function voiceCatalogResponse(voiceIds: string[]) {
  return new Response(JSON.stringify({
    system_voice: [],
    voice_cloning: voiceIds.map(voiceId => ({ voice_id: voiceId })),
    voice_generation: [],
    base_resp: { status_code: 0 },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function renderSettings(voiceId: string) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const screen = await render(MiniMaxSpeechSettings, {
    global: {
      plugins: [pinia, router, testI18n()],
      directives: { motion: {} },
    },
  })
  useProvidersStore(pinia).providers['minimax-speech'] = {
    apiKey: 'test-key',
    baseUrl: 'https://api.minimaxi.com',
    model: 'speech-2.8-hd',
    voice: voiceId,
  }
  return { pinia, screen }
}

beforeEach(() => {
  mocks.quiesce.mockReset()
  mocks.quiesce.mockResolvedValue({ ok: true, timedOut: false })
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('miniMax speech settings', () => {
  it('activates the account voice with the selected HD model', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => voiceCatalogResponse(['account-voice'])))
    const { pinia, screen } = await renderSettings('account-voice')

    const activateButton = screen.getByRole('button', { name: 'Validate and use for voice calls' })
    await expect.element(activateButton).toBeEnabled()
    await activateButton.click()
    await expect.element(screen.getByText('Voice-call speech is ready')).toBeVisible()

    expect(useSpeechOutputRoutingStore(pinia).voiceConversationProfile).toEqual({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-hd',
      voiceId: 'account-voice',
    })
  })

  it('does not replace the call profile when the selected voice is absent from the account', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => voiceCatalogResponse(['account-voice'])))
    const { pinia, screen } = await renderSettings('stale-voice')

    const activateButton = screen.getByRole('button', { name: 'Validate and use for voice calls' })
    await expect.element(activateButton).toBeEnabled()
    await activateButton.click()
    await expect.element(screen.getByText('Voice stale-voice is unavailable.')).toBeVisible()

    expect(useSpeechOutputRoutingStore(pinia).voiceConversationProfile).toBeNull()
  })

  it('keeps an explicitly imported custom voice usable when the catalog omits it', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => voiceCatalogResponse(['account-voice'])))
    const { pinia, screen } = await renderSettings('imported-voice')
    useProvidersStore(pinia).providers['minimax-speech'].customVoices = [{
      id: 'imported-voice',
      name: 'Imported voice',
    }]

    const activateButton = screen.getByRole('button', { name: 'Validate and use for voice calls' })
    await activateButton.click()
    await expect.element(screen.getByText('Voice-call speech is ready')).toBeVisible()

    expect(useSpeechOutputRoutingStore(pinia).voiceConversationProfile).toEqual({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-hd',
      voiceId: 'imported-voice',
    })
  })
})
