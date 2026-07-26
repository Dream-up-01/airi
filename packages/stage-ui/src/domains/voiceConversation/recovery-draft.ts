export const VOICE_RECOVERY_DRAFT_MAX_CHARACTERS = 4_000

export type VoiceRecoveryDraftStatus = 'ready' | 'retrying'

export interface VoiceConversationRecoveryDraft {
  draftId: string
  sessionId: string
  turnId: string
  failedMessageId?: string
  originalText: string
  text: string
  status: VoiceRecoveryDraftStatus
  retryCount: number
  createdAt: number
  updatedAt: number
}

export interface CreateVoiceConversationRecoveryDraftOptions {
  draftId: string
  sessionId: string
  turnId: string
  failedMessageId?: string
  text: string
  now?: number
}

function normalizeDraftText(text: string) {
  return text.trim().slice(0, VOICE_RECOVERY_DRAFT_MAX_CHARACTERS)
}

/**
 * Creates an editable, runtime-only recovery draft after a final transcript
 * has reached chat ingest but the chat request failed.
 */
export function createVoiceConversationRecoveryDraft(
  options: CreateVoiceConversationRecoveryDraftOptions,
): VoiceConversationRecoveryDraft | undefined {
  const text = normalizeDraftText(options.text)
  if (!text)
    return

  const now = options.now ?? Date.now()
  return {
    draftId: options.draftId,
    sessionId: options.sessionId,
    turnId: options.turnId,
    failedMessageId: options.failedMessageId,
    originalText: text,
    text,
    status: 'ready',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function editVoiceConversationRecoveryDraft(
  draft: VoiceConversationRecoveryDraft,
  text: string,
  now = Date.now(),
): VoiceConversationRecoveryDraft {
  if (draft.status === 'retrying')
    return draft

  return {
    ...draft,
    text: normalizeDraftText(text),
    updatedAt: Math.max(draft.updatedAt, now),
  }
}

export function beginVoiceConversationRecoveryRetry(
  draft: VoiceConversationRecoveryDraft,
  now = Date.now(),
): VoiceConversationRecoveryDraft | undefined {
  if (draft.status === 'retrying' || !normalizeDraftText(draft.text))
    return

  return {
    ...draft,
    text: normalizeDraftText(draft.text),
    status: 'retrying',
    retryCount: draft.retryCount + 1,
    updatedAt: Math.max(draft.updatedAt, now),
  }
}

export function failVoiceConversationRecoveryRetry(
  draft: VoiceConversationRecoveryDraft,
  failedMessageId?: string,
  now = Date.now(),
): VoiceConversationRecoveryDraft {
  return {
    ...draft,
    failedMessageId: failedMessageId ?? draft.failedMessageId,
    status: 'ready',
    updatedAt: Math.max(draft.updatedAt, now),
  }
}
