import { describe, expect, it } from 'vitest'

import {
  beginVoiceConversationRecoveryRetry,
  createVoiceConversationRecoveryDraft,
  editVoiceConversationRecoveryDraft,
  failVoiceConversationRecoveryRetry,
  VOICE_RECOVERY_DRAFT_MAX_CHARACTERS,
} from './recovery-draft'

describe('voice conversation recovery draft', () => {
  it('creates a correlated runtime draft only for non-empty final text', () => {
    expect(createVoiceConversationRecoveryDraft({
      draftId: 'draft-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      failedMessageId: 'message-1',
      text: '  你好  ',
      now: 10,
    })).toEqual({
      draftId: 'draft-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      failedMessageId: 'message-1',
      originalText: '你好',
      text: '你好',
      status: 'ready',
      retryCount: 0,
      createdAt: 10,
      updatedAt: 10,
    })

    expect(createVoiceConversationRecoveryDraft({
      draftId: 'draft-empty',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: '   ',
    })).toBeUndefined()
  })

  it('bounds edits and prevents mutation while a retry is running', () => {
    const draft = createVoiceConversationRecoveryDraft({
      draftId: 'draft-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'first',
      now: 10,
    })!
    const edited = editVoiceConversationRecoveryDraft(
      draft,
      ` ${'a'.repeat(VOICE_RECOVERY_DRAFT_MAX_CHARACTERS + 10)} `,
      20,
    )
    expect(edited.text).toHaveLength(VOICE_RECOVERY_DRAFT_MAX_CHARACTERS)

    const retrying = beginVoiceConversationRecoveryRetry(edited, 30)!
    expect(retrying).toMatchObject({ status: 'retrying', retryCount: 1, updatedAt: 30 })
    expect(editVoiceConversationRecoveryDraft(retrying, 'ignored', 40)).toBe(retrying)
  })

  it('returns to editable state after a failed retry and keeps correlation', () => {
    const draft = beginVoiceConversationRecoveryRetry(createVoiceConversationRecoveryDraft({
      draftId: 'draft-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'first',
      now: 10,
    })!, 20)!

    expect(failVoiceConversationRecoveryRetry(draft, 'message-after-retry', 30)).toMatchObject({
      failedMessageId: 'message-after-retry',
      status: 'ready',
      retryCount: 1,
      updatedAt: 30,
    })
  })
})
