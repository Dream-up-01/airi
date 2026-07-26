export type VoiceConversationMode = 'push-to-talk' | 'vad-turn-taking' | 'streaming-asr'

export type VoiceConversationState
  = | 'idle'
    | 'requesting-permission'
    | 'listening'
    | 'speech-detected'
    | 'transcribing'
    | 'user-turn-ready'
    | 'thinking'
    | 'speaking'
    | 'interrupted'
    | 'failed'
    | 'stopped'

export type VoiceConversationCancelReason
  = | 'user-stop'
    | 'user-interrupt'
    | 'new-turn'
    | 'provider-switch'
    | 'page-dispose'
    | 'permission-denied'
    | 'asr-error'
    | 'chat-error'
    | 'tts-error'
    | 'playback-error'
    | 'unknown'

export type VoiceConversationErrorCode
  = | 'illegal_transition'
    | 'stale_turn'
    | 'hearing_not_configured'
    | 'chat_not_configured'
    | 'speech_not_configured'
    | 'cloud_tts_privacy_not_acknowledged'
    | 'permission_denied'
    | 'asr_error'
    | 'chat_error'
    | 'tts_error'
    | 'playback_error'
    | 'unknown'

export interface VoiceConversationProviderSnapshot {
  inputProviderId?: string
  inputModelId?: string
  outputProviderId?: string
  outputModelId?: string
  voiceId?: string
}

export interface VoiceConversationSession extends VoiceConversationProviderSnapshot {
  sessionId: string
  mode: VoiceConversationMode
  state: VoiceConversationState
  activeTurnId?: string
  startedAt: number
  updatedAt: number
  lastErrorCode?: VoiceConversationErrorCode
  lastCancelReason?: VoiceConversationCancelReason
}

export interface VoiceTurn {
  turnId: string
  sessionId: string
  source: 'microphone' | 'push-to-talk' | 'manual-test'
  transcript?: string
  partialTranscript?: string
  asrStartedAt?: number
  asrFirstPartialAt?: number
  asrFinalAt?: number
  chatIngestedAt?: number
  llmFirstTokenAt?: number
  llmCompletedAt?: number
  ttsFirstRequestAt?: number
  ttsFirstAudioAt?: number
  playbackStartedAt?: number
  playbackCompletedAt?: number
  cancelledAt?: number
  cancelReason?: VoiceConversationCancelReason
}

export interface AsrSegment {
  segmentId: string
  turnId: string
  text: string
  isFinal: boolean
  confidence?: number
  language?: string
  providerSegmentId?: string
  startedAt?: number
  endedAt?: number
}

export type VoiceInterruptionPolicy = 'disabled' | 'pushToInterrupt' | 'vadBargeIn'

export interface VoiceStyleDirective {
  style: 'neutral' | 'warm' | 'cheerful' | 'serious' | 'comforting' | 'playful'
  pace?: 'slow' | 'normal' | 'fast'
  energy?: 'low' | 'normal' | 'high'
  pitchShift?: number
  rate?: number
  volume?: number
}

export interface StageActuationIntentLite {
  state: 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'idle'
  emotion?: 'neutral' | 'happy' | 'concerned' | 'focused' | 'comforting'
  turnId?: string
  sessionId?: string
}

export type VoiceConversationEvent
  = | { type: 'request-permission', at?: number }
    | { type: 'permission-granted', at?: number }
    | { type: 'permission-denied', at?: number, code?: VoiceConversationErrorCode }
    | { type: 'permission-revoked', at?: number, code?: VoiceConversationErrorCode }
    | { type: 'start-listening', at?: number }
    | { type: 'vad-started', at?: number }
    | { type: 'speech-start', turnId: string, at?: number }
    | { type: 'speech-end', turnId: string, at?: number }
    | { type: 'asr-start', turnId: string, at?: number }
    | { type: 'asr-first-partial', turnId: string, at?: number }
    | { type: 'asr-final', turnId: string, at?: number }
    | { type: 'chat-ingested', turnId: string, at?: number }
    | { type: 'chat-retry', turnId: string, at?: number }
    | { type: 'llm-first-token', turnId: string, at?: number }
    | { type: 'llm-completed', turnId: string, at?: number }
    | { type: 'tts-first-request', turnId: string, at?: number }
    | { type: 'tts-first-audio', turnId: string, at?: number }
    | { type: 'playback-started', turnId: string, at?: number }
    | { type: 'playback-completed', turnId: string, at?: number, next?: 'idle' | 'listening' }
    | { type: 'interrupt', at?: number, reason?: VoiceConversationCancelReason }
    | { type: 'interruption-ready', at?: number }
    | { type: 'fail', at?: number, code?: VoiceConversationErrorCode, reason?: VoiceConversationCancelReason }
    | { type: 'stop', at?: number, reason?: VoiceConversationCancelReason }
    | { type: 'reset', at?: number }

export interface CreateVoiceConversationSessionOptions extends VoiceConversationProviderSnapshot {
  sessionId: string
  mode: VoiceConversationMode
  now?: number
}

export interface VoiceConversationTransitionFailure {
  code: VoiceConversationErrorCode
  from: VoiceConversationState
  event: VoiceConversationEvent['type']
  reason: string
  suggestion: string
}

export type VoiceConversationTransitionResult
  = | { ok: true, session: VoiceConversationSession }
    | { ok: false, session: VoiceConversationSession, error: VoiceConversationTransitionFailure }

const mutableActiveTurnEvents = new Set<VoiceConversationEvent['type']>([
  'speech-end',
  'asr-start',
  'asr-first-partial',
  'asr-final',
  'chat-ingested',
  'chat-retry',
  'llm-first-token',
  'llm-completed',
  'tts-first-request',
  'tts-first-audio',
  'playback-started',
  'playback-completed',
])

/**
 * Creates a runtime-only voice conversation session snapshot.
 *
 * The session intentionally does not include raw audio or transcript text.
 * Transcript ownership stays with the current runtime turn/UI until the
 * normal chat pipeline accepts it.
 */
export function createVoiceConversationSession(
  options: CreateVoiceConversationSessionOptions,
): VoiceConversationSession {
  const now = options.now ?? Date.now()

  return {
    sessionId: options.sessionId,
    mode: options.mode,
    state: 'idle',
    inputProviderId: options.inputProviderId,
    inputModelId: options.inputModelId,
    outputProviderId: options.outputProviderId,
    outputModelId: options.outputModelId,
    voiceId: options.voiceId,
    startedAt: now,
    updatedAt: now,
  }
}

/**
 * Applies one state-machine event and returns either a new session or a
 * stable, user-actionable transition error.
 */
export function transitionVoiceConversationSession(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
): VoiceConversationTransitionResult {
  const turnGuard = ensureCurrentTurn(session, event)
  if (!turnGuard.ok)
    return turnGuard

  const at = Math.max(session.updatedAt, event.at ?? Date.now())
  const next = nextVoiceConversationState(session, event)

  if (!next.ok) {
    return {
      ok: false,
      session,
      error: {
        code: 'illegal_transition',
        from: session.state,
        event: event.type,
        reason: `Cannot apply "${event.type}" while voice session is "${session.state}".`,
        suggestion: next.suggestion,
      },
    }
  }

  return {
    ok: true,
    session: {
      ...session,
      state: next.state,
      activeTurnId: resolveNextActiveTurnId(session, event, next.state),
      lastErrorCode: resolveNextErrorCode(session, event),
      lastCancelReason: resolveNextCancelReason(session, event),
      updatedAt: at,
    },
  }
}

export function isVoiceConversationTransitionAllowed(
  state: VoiceConversationState,
  event: VoiceConversationEvent['type'],
): boolean {
  return legalVoiceConversationEvents(state).includes(event)
}

export function legalVoiceConversationEvents(
  state: VoiceConversationState,
): VoiceConversationEvent['type'][] {
  switch (state) {
    case 'idle':
      return ['request-permission', 'start-listening', 'fail', 'stop', 'reset']
    case 'requesting-permission':
      return ['permission-granted', 'permission-denied', 'permission-revoked', 'fail', 'stop', 'reset']
    case 'listening':
      return ['vad-started', 'speech-start', 'permission-revoked', 'fail', 'stop', 'reset']
    case 'speech-detected':
      return ['speech-end', 'asr-start', 'asr-first-partial', 'permission-revoked', 'interrupt', 'fail', 'stop', 'reset']
    case 'transcribing':
      return ['asr-first-partial', 'asr-final', 'permission-revoked', 'interrupt', 'fail', 'stop', 'reset']
    case 'user-turn-ready':
      return ['chat-ingested', 'permission-revoked', 'interrupt', 'fail', 'stop', 'reset']
    case 'thinking':
      return ['llm-first-token', 'llm-completed', 'tts-first-request', 'tts-first-audio', 'playback-started', 'permission-revoked', 'interrupt', 'fail', 'stop', 'reset']
    case 'speaking':
      return ['llm-completed', 'tts-first-request', 'tts-first-audio', 'playback-completed', 'permission-revoked', 'interrupt', 'fail', 'stop', 'reset']
    case 'interrupted':
      return ['interruption-ready', 'start-listening', 'permission-revoked', 'fail', 'stop', 'reset']
    case 'failed':
      return ['chat-retry', 'request-permission', 'start-listening', 'reset', 'stop']
    case 'stopped':
      return ['request-permission', 'start-listening', 'reset']
  }
}

function nextVoiceConversationState(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
): { ok: true, state: VoiceConversationState } | { ok: false, suggestion: string } {
  if (!isVoiceConversationTransitionAllowed(session.state, event.type)) {
    return {
      ok: false,
      suggestion: `Apply one of: ${legalVoiceConversationEvents(session.state).join(', ')}.`,
    }
  }

  switch (event.type) {
    case 'request-permission':
      return { ok: true, state: 'requesting-permission' }
    case 'permission-granted':
    case 'start-listening':
    case 'interruption-ready':
      return { ok: true, state: 'listening' }
    case 'permission-denied':
    case 'permission-revoked':
    case 'fail':
      return { ok: true, state: 'failed' }
    case 'vad-started':
      return { ok: true, state: session.state }
    case 'speech-start':
      return { ok: true, state: 'speech-detected' }
    case 'speech-end':
    case 'asr-start':
      return { ok: true, state: 'transcribing' }
    case 'asr-first-partial':
      return { ok: true, state: session.state }
    case 'asr-final':
      return { ok: true, state: 'user-turn-ready' }
    case 'chat-ingested':
    case 'chat-retry':
    case 'llm-first-token':
      return { ok: true, state: 'thinking' }
    case 'llm-completed':
    case 'tts-first-request':
    case 'tts-first-audio':
      return { ok: true, state: session.state }
    case 'playback-started':
      return { ok: true, state: 'speaking' }
    case 'playback-completed':
      return { ok: true, state: event.next ?? 'listening' }
    case 'interrupt':
      return { ok: true, state: 'interrupted' }
    case 'stop':
      return { ok: true, state: 'stopped' }
    case 'reset':
      return { ok: true, state: 'idle' }
  }
}

function ensureCurrentTurn(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
): VoiceConversationTransitionResult | { ok: true } {
  if (!('turnId' in event))
    return { ok: true }

  if (event.type === 'speech-start')
    return { ok: true }

  if (!mutableActiveTurnEvents.has(event.type))
    return { ok: true }

  if (session.activeTurnId === event.turnId)
    return { ok: true }

  return {
    ok: false,
    session,
    error: {
      code: 'stale_turn',
      from: session.state,
      event: event.type,
      reason: `Turn "${event.turnId}" is not the active voice turn.`,
      suggestion: 'Drop this event and keep the current voice session unchanged.',
    },
  }
}

function resolveNextActiveTurnId(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
  nextState: VoiceConversationState,
): string | undefined {
  if (event.type === 'speech-start')
    return event.turnId

  if (event.type === 'reset'
    || event.type === 'stop'
    || event.type === 'permission-denied'
    || event.type === 'permission-revoked'
    || event.type === 'interrupt') {
    return undefined
  }

  if (event.type === 'fail')
    return event.code === 'chat_error' ? session.activeTurnId : undefined

  if (event.type === 'playback-completed' && (nextState === 'idle' || nextState === 'listening'))
    return undefined

  return session.activeTurnId
}

function resolveNextErrorCode(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
): VoiceConversationErrorCode | undefined {
  if (event.type === 'reset' || event.type === 'request-permission' || event.type === 'start-listening' || event.type === 'chat-retry')
    return undefined

  if (event.type === 'permission-denied' || event.type === 'permission-revoked')
    return event.code ?? 'permission_denied'

  if (event.type === 'fail')
    return event.code ?? 'unknown'

  return session.lastErrorCode
}

function resolveNextCancelReason(
  session: VoiceConversationSession,
  event: VoiceConversationEvent,
): VoiceConversationCancelReason | undefined {
  if (event.type === 'reset' || event.type === 'request-permission' || event.type === 'start-listening' || event.type === 'chat-retry')
    return undefined

  if (event.type === 'permission-denied' || event.type === 'permission-revoked')
    return 'permission-denied'

  if (event.type === 'interrupt')
    return event.reason ?? 'user-interrupt'

  if (event.type === 'stop')
    return event.reason ?? 'user-stop'

  if (event.type === 'fail')
    return event.reason ?? 'unknown'

  return session.lastCancelReason
}
