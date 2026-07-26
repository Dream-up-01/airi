import { describe, expect, it } from 'vitest'

import { LOCAL_SCREEN_CONSENT_VERSION } from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenConsentRegistry, LocalScreenConsentRegistryError } from './local-screen-consent-registry'

function registerRequest(generation = 1, grantId = 'grant:screen-local') {
  return {
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId: 'session:screen',
    generation,
    grant: {
      contractVersion: 'perception/v0.3' as const,
      grantId,
      sourceKind: 'screen' as const,
      sourceId: 'screen:primary',
      processingMode: 'local-only' as const,
      allowedModalities: ['screen-frames' as const],
      allowedFactCategories: ['screen.activity', 'screen.health'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  }
}

describe('local screen main consent registry', () => {
  it('keeps grants memory-only and generation-bound', () => {
    let now = 1_000
    const registry = createLocalScreenConsentRegistry({ now: () => now })
    const first = registry.register(registerRequest())
    expect(first.activeGrantIds).toEqual(['grant:screen-local'])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(true)

    now = 2_000
    const replacement = registry.register(registerRequest(2, 'grant:screen-next'))
    expect(replacement.activeGrantIds).toEqual(['grant:screen-next'])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(false)
    expect(registry.isActive('grant:screen-next', 'session:screen', 2)).toBe(true)
    expect(replacement.updatedAt).toBe(2_000)
  })

  it('rejects stale generations and a second session', () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    registry.register(registerRequest(2))
    expect(() => registry.register(registerRequest(1))).toThrowError(new LocalScreenConsentRegistryError('stale-generation'))
    expect(() => registry.register({ ...registerRequest(2), sessionId: 'session:other' })).toThrowError(new LocalScreenConsentRegistryError('session-conflict'))
  })

  it('revokes exact grants and clears all state on app exit', () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    registry.register(registerRequest())
    const revoked = registry.revoke({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen-local',
      reason: 'permission-revoked',
    })
    expect(revoked.activeGrantIds).toEqual([])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(false)

    registry.register(registerRequest())
    registry.clearAll()
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(false)
  })

  it('allows a new session only after the previous active grant is revoked', () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    registry.register(registerRequest())
    expect(() => registry.register({ ...registerRequest(), sessionId: 'session:other' })).toThrowError(new LocalScreenConsentRegistryError('session-conflict'))
    registry.revoke({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen-local',
      reason: 'unmount',
    })
    expect(registry.register({ ...registerRequest(), sessionId: 'session:other' }).sessionId).toBe('session:other')
    expect(() => registry.register(registerRequest(0))).toThrowError()
  })
})
