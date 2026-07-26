import type {
  VoiceConversationEvent,
  VoiceConversationSession,
  VoiceConversationState,
} from './session'

export type VoiceTimelineEventName
  = | 'voice.session.start'
    | 'voice.permission.requested'
    | 'voice.permission.granted'
    | 'voice.permission.denied'
    | 'voice.permission.revoked'
    | 'voice.vad.started'
    | 'voice.vad.speech_start'
    | 'voice.vad.speech_end'
    | 'voice.asr.started'
    | 'voice.asr.first_partial'
    | 'voice.asr.final'
    | 'voice.chat.ingested'
    | 'voice.chat.retry'
    | 'voice.llm.first_token'
    | 'voice.llm.completed'
    | 'voice.tts.first_request'
    | 'voice.tts.first_audio'
    | 'voice.playback.started'
    | 'voice.playback.completed'
    | 'voice.cancelled'
    | 'voice.failed'

export interface VoiceTimelineEntry {
  name: VoiceTimelineEventName
  sessionId: string
  turnId?: string
  at: number
  state: VoiceConversationState
  mode: VoiceConversationSession['mode']
  inputProviderId?: string
  inputModelId?: string
  outputProviderId?: string
  outputModelId?: string
  voiceId?: string
  errorCode?: VoiceConversationSession['lastErrorCode']
  cancelReason?: VoiceConversationSession['lastCancelReason']
  textLength?: number
}

const timelineEventNames: Partial<Record<VoiceConversationEvent['type'], VoiceTimelineEventName>> = {
  'request-permission': 'voice.permission.requested',
  'permission-granted': 'voice.permission.granted',
  'permission-denied': 'voice.permission.denied',
  'permission-revoked': 'voice.permission.revoked',
  'vad-started': 'voice.vad.started',
  'speech-start': 'voice.vad.speech_start',
  'speech-end': 'voice.vad.speech_end',
  'asr-start': 'voice.asr.started',
  'asr-first-partial': 'voice.asr.first_partial',
  'asr-final': 'voice.asr.final',
  'chat-ingested': 'voice.chat.ingested',
  'chat-retry': 'voice.chat.retry',
  'llm-first-token': 'voice.llm.first_token',
  'llm-completed': 'voice.llm.completed',
  'tts-first-request': 'voice.tts.first_request',
  'tts-first-audio': 'voice.tts.first_audio',
  'playback-started': 'voice.playback.started',
  'playback-completed': 'voice.playback.completed',
  'interrupt': 'voice.cancelled',
  'stop': 'voice.cancelled',
  'fail': 'voice.failed',
}

export interface CreateVoiceTimelineEntryOptions {
  textLength?: number
}

export function voiceTimelineNameForEvent(
  event: VoiceConversationEvent,
): VoiceTimelineEventName | undefined {
  return timelineEventNames[event.type]
}

export function createVoiceSessionStartTimelineEntry(
  session: VoiceConversationSession,
): VoiceTimelineEntry {
  return createTimelineEntry('voice.session.start', session, session.startedAt)
}

export function createVoiceTimelineEntry(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
  options?: CreateVoiceTimelineEntryOptions,
): VoiceTimelineEntry | null {
  const name = voiceTimelineNameForEvent(event)
  if (!name)
    return null

  const at = Math.max(session.updatedAt, event.at ?? session.updatedAt)
  const turnId = 'turnId' in event ? event.turnId : session.activeTurnId

  return createTimelineEntry(name, session, at, {
    turnId,
    textLength: options?.textLength,
  })
}

export function isVoiceTimelineMonotonic(entries: readonly VoiceTimelineEntry[]): boolean {
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]!.at < entries[i - 1]!.at)
      return false
  }

  return true
}

function createTimelineEntry(
  name: VoiceTimelineEventName,
  session: VoiceConversationSession,
  at: number,
  options?: { turnId?: string, textLength?: number },
): VoiceTimelineEntry {
  return {
    name,
    sessionId: session.sessionId,
    turnId: options?.turnId,
    at,
    state: session.state,
    mode: session.mode,
    inputProviderId: sanitizeTimelineIdentifier(session.inputProviderId),
    inputModelId: sanitizeTimelineIdentifier(session.inputModelId),
    outputProviderId: sanitizeTimelineIdentifier(session.outputProviderId),
    outputModelId: sanitizeTimelineIdentifier(session.outputModelId),
    voiceId: sanitizeTimelineIdentifier(session.voiceId),
    errorCode: session.lastErrorCode,
    cancelReason: session.lastCancelReason,
    textLength: sanitizeTextLength(options?.textLength),
  }
}

function sanitizeTimelineIdentifier(value: string | undefined): string | undefined {
  if (!value || value.length > 128)
    return undefined

  const normalized = value.trim()
  if (!normalized
    || /(?:^|[._-])(?:api[-_]?key|authorization|password|secret|token)(?:$|[._-])/i.test(normalized)
    || /^(?:sk|ak)-[\w-]{8,}$/i.test(normalized)
    || /^[a-z]:[\\/]/i.test(normalized)
    || normalized.startsWith('\\\\')
    || normalized.includes('://')
    || normalized.includes('..\\')
    || normalized.includes('../')) {
    return undefined
  }

  return normalized
}

function sanitizeTextLength(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value))
    return undefined

  return Math.max(0, Math.min(1_000_000, Math.trunc(value)))
}
