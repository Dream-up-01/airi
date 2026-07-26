import type { VoiceConversationState } from './session'

export const DEFAULT_VOICE_PLAYBACK_ECHO_TAIL_MS = 800

export interface VoicePlaybackEchoGateState {
  audiblePlayback: boolean
  assistantResponseActive: boolean
  blockedUntil: number
}

export interface VoicePlaybackEchoGateUpdate {
  audiblePlayback: boolean
  voiceConversationState: VoiceConversationState
  at?: number
  tailMs?: number
}

export function createVoicePlaybackEchoGateState(): VoicePlaybackEchoGateState {
  return {
    audiblePlayback: false,
    assistantResponseActive: false,
    blockedUntil: 0,
  }
}

/**
 * An explicit user interrupt is the only path allowed to bypass the loudspeaker
 * tail. Callers must stop the active playback before releasing the gate.
 */
export function releaseVoicePlaybackEchoGateForUserInterrupt(): VoicePlaybackEchoGateState {
  return createVoicePlaybackEchoGateState()
}

/**
 * Keeps automatic microphone ingestion closed for the whole assistant playback
 * response, including gaps between TTS chunks and a short loudspeaker tail.
 */
export function updateVoicePlaybackEchoGate(
  state: VoicePlaybackEchoGateState,
  update: VoicePlaybackEchoGateUpdate,
): VoicePlaybackEchoGateState {
  const at = update.at ?? Date.now()
  const tailMs = Math.max(0, update.tailMs ?? DEFAULT_VOICE_PLAYBACK_ECHO_TAIL_MS)
  const assistantResponseActive = update.voiceConversationState === 'speaking'
  const wasPlaybackActive = state.audiblePlayback || state.assistantResponseActive
  const isPlaybackActive = update.audiblePlayback || assistantResponseActive

  return {
    audiblePlayback: update.audiblePlayback,
    assistantResponseActive,
    blockedUntil: wasPlaybackActive && !isPlaybackActive
      ? Math.max(state.blockedUntil, at + tailMs)
      : state.blockedUntil,
  }
}

export function isVoicePlaybackEchoBlocked(state: VoicePlaybackEchoGateState, at = Date.now()): boolean {
  return state.audiblePlayback
    || state.assistantResponseActive
    || at < state.blockedUntil
}

export function voicePlaybackEchoBlockRemainingMs(state: VoicePlaybackEchoGateState, at = Date.now()): number {
  if (state.audiblePlayback || state.assistantResponseActive)
    return Number.POSITIVE_INFINITY

  return Math.max(0, state.blockedUntil - at)
}
