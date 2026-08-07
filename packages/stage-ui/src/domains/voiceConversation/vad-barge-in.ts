/**
 * Barge-in is gated by two independent signals: the assistant must still be
 * audibly responding, and VAD must remain in speech state for a short
 * confirmation window. The state is deliberately framework-free so the
 * confirmation and false-positive paths can be tested without a microphone.
 */
export const DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS = 180
export const DEFAULT_VAD_BARGE_IN_COOLDOWN_MS = 750

export interface VadBargeInGateState {
  candidateStartedAt: number | null
  cooldownUntil: number
}

export type VadBargeInAction = 'none' | 'arm' | 'reset' | 'interrupt'

export interface VadBargeInEvaluationInput {
  state: VadBargeInGateState
  playbackActive: boolean
  speechActive: boolean
  at: number
  confirmationMs?: number
  cooldownMs?: number
}

export interface VadBargeInEvaluation {
  state: VadBargeInGateState
  action: VadBargeInAction
}

export function createVadBargeInGateState(): VadBargeInGateState {
  return {
    candidateStartedAt: null,
    cooldownUntil: 0,
  }
}

export function evaluateVadBargeIn({
  state,
  playbackActive,
  speechActive,
  at,
  confirmationMs = DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS,
  cooldownMs = DEFAULT_VAD_BARGE_IN_COOLDOWN_MS,
}: VadBargeInEvaluationInput): VadBargeInEvaluation {
  const now = Number.isFinite(at) ? Math.max(0, at) : 0
  const confirmation = Math.max(0, Number.isFinite(confirmationMs) ? confirmationMs : DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS)
  const cooldown = Math.max(0, Number.isFinite(cooldownMs) ? cooldownMs : DEFAULT_VAD_BARGE_IN_COOLDOWN_MS)

  if (!playbackActive || !speechActive) {
    return {
      state: {
        ...state,
        candidateStartedAt: null,
      },
      action: state.candidateStartedAt == null ? 'none' : 'reset',
    }
  }

  if (now < state.cooldownUntil) {
    return {
      state: {
        ...state,
        candidateStartedAt: null,
      },
      action: 'none',
    }
  }

  if (state.candidateStartedAt == null) {
    return {
      state: {
        ...state,
        candidateStartedAt: now,
      },
      action: 'arm',
    }
  }

  if (now - state.candidateStartedAt < confirmation)
    return { state, action: 'none' }

  return {
    state: {
      candidateStartedAt: null,
      cooldownUntil: now + cooldown,
    },
    action: 'interrupt',
  }
}
