import type { CreateVoiceConversationRecoveryDraftOptions } from '../domains/voiceConversation'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  beginVoiceConversationRecoveryRetry,
  createVoiceConversationRecoveryDraft,
  editVoiceConversationRecoveryDraft,
  failVoiceConversationRecoveryRetry,
} from '../domains/voiceConversation'

/** Runtime-only facade. Recovery transcript text is deliberately not persisted. */
export const useVoiceConversationRecoveryDraftStore = defineStore('voice-conversation-recovery-draft', () => {
  const draft = ref<ReturnType<typeof createVoiceConversationRecoveryDraft>>()

  function retain(options: CreateVoiceConversationRecoveryDraftOptions) {
    draft.value = createVoiceConversationRecoveryDraft(options)
  }

  function edit(text: string, now?: number) {
    if (draft.value)
      draft.value = editVoiceConversationRecoveryDraft(draft.value, text, now)
  }

  function beginRetry(now?: number) {
    if (!draft.value)
      return false

    const next = beginVoiceConversationRecoveryRetry(draft.value, now)
    if (!next)
      return false

    draft.value = next
    return true
  }

  function failRetry(failedMessageId?: string, now?: number) {
    if (draft.value)
      draft.value = failVoiceConversationRecoveryRetry(draft.value, failedMessageId, now)
  }

  function clear() {
    draft.value = undefined
  }

  return {
    draft,
    retain,
    edit,
    beginRetry,
    failRetry,
    clear,
  }
})
