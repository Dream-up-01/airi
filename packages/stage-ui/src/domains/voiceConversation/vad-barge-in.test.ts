import { describe, expect, it } from 'vitest'

import {
  createVadBargeInGateState,
  DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS,
  evaluateVadBargeIn,
} from './vad-barge-in'

describe('vAD barge-in gate', () => {
  it('arms only while playback and speech are both active', () => {
    const initial = createVadBargeInGateState()

    expect(evaluateVadBargeIn({
      state: initial,
      playbackActive: false,
      speechActive: true,
      at: 10,
    })).toEqual({ state: initial, action: 'none' })

    const armed = evaluateVadBargeIn({
      state: initial,
      playbackActive: true,
      speechActive: true,
      at: 10,
    })
    expect(armed.action).toBe('arm')
    expect(armed.state.candidateStartedAt).toBe(10)
  })

  it('requires the confirmation window before interrupting', () => {
    const armed = evaluateVadBargeIn({
      state: createVadBargeInGateState(),
      playbackActive: true,
      speechActive: true,
      at: 100,
    })

    const beforeConfirmation = evaluateVadBargeIn({
      state: armed.state,
      playbackActive: true,
      speechActive: true,
      at: 100 + DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS - 1,
    })
    expect(beforeConfirmation.action).toBe('none')

    const confirmed = evaluateVadBargeIn({
      state: beforeConfirmation.state,
      playbackActive: true,
      speechActive: true,
      at: 100 + DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS,
    })
    expect(confirmed.action).toBe('interrupt')
    expect(confirmed.state.candidateStartedAt).toBeNull()
    expect(confirmed.state.cooldownUntil).toBeGreaterThan(100)
  })

  it('resets a false candidate and suppresses immediate retriggers during cooldown', () => {
    const armed = evaluateVadBargeIn({
      state: createVadBargeInGateState(),
      playbackActive: true,
      speechActive: true,
      at: 50,
    })
    const reset = evaluateVadBargeIn({
      state: armed.state,
      playbackActive: true,
      speechActive: false,
      at: 80,
    })
    expect(reset.action).toBe('reset')
    expect(reset.state.candidateStartedAt).toBeNull()

    const interrupted = evaluateVadBargeIn({
      state: armed.state,
      playbackActive: true,
      speechActive: true,
      at: 50 + DEFAULT_VAD_BARGE_IN_CONFIRMATION_MS,
    })
    const cooldown = evaluateVadBargeIn({
      state: interrupted.state,
      playbackActive: true,
      speechActive: true,
      at: interrupted.state.cooldownUntil - 1,
    })
    expect(cooldown.action).toBe('none')
    expect(cooldown.state.candidateStartedAt).toBeNull()
  })
})
