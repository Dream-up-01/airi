import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useVoiceStyleRuntimeStore } from './voiceStyleRuntime'

describe('voice style runtime store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps policy and resolution runtime-only and correlated by turn', () => {
    const store = useVoiceStyleRuntimeStore()
    store.capturePolicy({
      sessionId: 'session-1',
      turnId: 'turn-1',
      policy: { risk: 'none', scenario: 'casual' },
    })
    expect(store.policyForTurn('turn-1')).toEqual({ risk: 'none', scenario: 'casual' })

    store.publishResolution({
      sessionId: 'session-1',
      turnId: 'turn-1',
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      directive: { style: 'warm' },
      warnings: [],
      resolvedAt: 10,
    })
    expect(store.latestResolution?.directive.style).toBe('warm')

    store.clearTurn('turn-1')
    expect(store.policyForTurn('turn-1')).toBeUndefined()
    expect(store.latestResolution?.directive.style).toBe('warm')

    store.clear()
    expect(store.latestResolution).toBeUndefined()
  })
})
