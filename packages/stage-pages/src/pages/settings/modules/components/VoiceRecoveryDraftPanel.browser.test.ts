import { createVoiceConversationRecoveryDraft } from '@proj-airi/stage-ui/domains/voiceConversation'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import VoiceRecoveryDraftPanel from '../../../../../../../apps/stage-tamagotchi/src/renderer/components/voice/VoiceRecoveryDraftPanel.vue'

function testI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        tamagotchi: {
          stage: {
            voice: {
              recovery: {
                'title': 'Voice message needs attention',
                'description': 'Edit, retry, or discard this runtime-only draft.',
                'editor-label': 'Editable voice transcript draft',
                'retry': 'Retry message',
                'retrying': 'Retrying…',
                'discard': 'Discard draft',
              },
            },
          },
        },
      },
    },
  })
}

describe('voice recovery draft panel', () => {
  it('supports editing, retrying, and discarding the runtime-only draft', async () => {
    const onEdit = vi.fn()
    const onRetry = vi.fn()
    const onDiscard = vi.fn()
    const draft = createVoiceConversationRecoveryDraft({
      draftId: 'draft-test',
      sessionId: 'session-test',
      turnId: 'turn-test',
      text: 'original transcript',
      now: 10,
    })!
    const screen = await render(VoiceRecoveryDraftPanel, {
      props: { draft, onEdit, onRetry, onDiscard },
      global: { plugins: [testI18n()] },
    })

    await screen.getByRole('textbox', { name: 'Editable voice transcript draft' }).fill('edited transcript')
    await screen.getByRole('button', { name: 'Retry message' }).click()
    await screen.getByRole('button', { name: 'Discard draft' }).click()

    expect(onEdit).toHaveBeenLastCalledWith('edited transcript')
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})
