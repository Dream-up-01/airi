import { useVoiceConversationPreferencesStore } from '@proj-airi/stage-ui/stores/voiceConversationPreferences'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import VoiceConversationPreferencesPanel from './VoiceConversationPreferencesPanel.vue'

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
                  preferences: {
                    'title': 'Voice conversation',
                    'description': 'Safe runtime preferences',
                    'mode': 'Conversation mode',
                    'interruption-policy': 'Interruption policy',
                    'vad-threshold': 'VAD threshold',
                    'min-speech': 'Minimum speech duration',
                    'trailing-silence': 'Trailing silence',
                    'cloud-privacy': 'Cloud privacy acknowledgement',
                    'cloud-privacy-description': 'Checked assistant text only',
                  },
                  modes: {
                    'vad': 'VAD turn-taking',
                    'streaming': 'Streaming ASR',
                    'push-to-talk-unavailable': 'Push to talk unavailable',
                  },
                  interruptions: {
                    disabled: 'Disabled',
                    push: 'Push to interrupt',
                    vad: 'Automatic VAD barge-in',
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

describe('voice conversation preferences panel', () => {
  it('writes only bounded supported preferences through the production store', async () => {
    localStorage.clear()
    const pinia = createPinia()
    const screen = await render(VoiceConversationPreferencesPanel, {
      global: { plugins: [pinia, testI18n()] },
    })
    const store = useVoiceConversationPreferencesStore(pinia)
    const selects = screen.getByRole('combobox')

    await selects.first().selectOptions('vad-turn-taking')
    await selects.nth(1).selectOptions('vadBargeIn')
    await screen.getByRole('switch').click()

    expect(store.preferences).toMatchObject({
      mode: 'vad-turn-taking',
      interruptionPolicy: 'vadBargeIn',
      cloudPrivacyAcknowledged: true,
    })
    await expect.element(screen.getByRole('option', { name: 'Push to talk unavailable' })).toBeDisabled()
    await expect.element(screen.getByRole('option', { name: 'Automatic VAD barge-in' })).not.toBeDisabled()
  })
})
