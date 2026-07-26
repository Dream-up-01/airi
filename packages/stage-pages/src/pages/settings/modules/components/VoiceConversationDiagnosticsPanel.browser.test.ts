import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'

import VoiceConversationDiagnosticsPanel from './VoiceConversationDiagnosticsPanel.vue'

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
            modules: {
              hearing: {
                'voice-conversation': {
                  diagnostics: {
                    'title': 'Runtime diagnostics',
                    'description': 'Sanitized voice status',
                    'asr': 'ASR',
                    'asr-streaming': 'ASR streaming',
                    'tts': 'TTS',
                    'tts-streaming': 'TTS streaming',
                    'last-error': 'Last error',
                    'asr-latency': 'ASR latency',
                    'tts-latency': 'TTS latency',
                    'style-warnings': 'Style warnings',
                    'supported': 'Supported',
                    'not-supported': 'Not supported',
                    'streaming': 'True streaming',
                    'rest-aggregated': 'REST profile (not true streaming)',
                    'not-declared': 'Not declared',
                    'none': 'None',
                    'warnings': {},
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

describe('voice conversation diagnostics panel', () => {
  it('shows the configured providers and describes MiniMax as an honest REST profile', async () => {
    localStorage.clear()
    const pinia = createPinia()
    const Harness = defineComponent({
      setup() {
        const hearingStore = useHearingStore()
        const speechStore = useSpeechStore()
        const voiceStore = useVoiceConversationStore()

        hearingStore.activeTranscriptionProvider = 'qwen3-asr-local'
        hearingStore.activeTranscriptionModel = 'Qwen/Qwen3-ASR-0.6B'
        speechStore.activeSpeechProvider = 'minimax-speech'
        speechStore.activeSpeechModel = 'speech-2.8-turbo'
        speechStore.activeSpeechVoiceId = 'AiriFireflyCN20260710_2011R7'
        voiceStore.start({
          sessionId: 'voice-session-test',
          mode: 'streaming-asr',
          listeningImmediately: true,
        })
        voiceStore.dispatch({ type: 'fail', code: 'tts_error', reason: 'tts-error' })

        return () => h(VoiceConversationDiagnosticsPanel)
      },
    })

    const screen = await render(Harness, {
      global: { plugins: [pinia, testI18n()] },
    })

    await expect.element(screen.getByText(/qwen3-asr-local\s*\/\s*Qwen\/Qwen3-ASR-0\.6B/)).toBeVisible()
    await expect.element(screen.getByText(/minimax-speech\s*\/\s*speech-2\.8-turbo\s*\/\s*AiriFireflyCN20260710_2011R7/)).toBeVisible()
    await expect.element(screen.getByText('REST profile (not true streaming)')).toBeVisible()
    await expect.element(screen.getByText('tts_error')).toBeVisible()
  })
})
