import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useVoiceConversationRecoveryDraftStore } from './voiceConversationRecoveryDraft'

describe('voice conversation recovery draft store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('retains, edits, retries and clears a draft without persistence', () => {
    const store = useVoiceConversationRecoveryDraftStore()
    store.retain({
      draftId: 'draft-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      failedMessageId: 'message-1',
      text: 'original',
      now: 10,
    })
    store.edit('edited', 20)

    expect(store.draft).toMatchObject({ text: 'edited', status: 'ready' })
    expect(store.beginRetry(30)).toBe(true)
    expect(store.beginRetry(40)).toBe(false)
    expect(store.draft).toMatchObject({ status: 'retrying', retryCount: 1 })

    store.failRetry('message-2', 50)
    expect(store.draft).toMatchObject({ failedMessageId: 'message-2', status: 'ready' })

    store.clear()
    expect(store.draft).toBeUndefined()
  })
})
