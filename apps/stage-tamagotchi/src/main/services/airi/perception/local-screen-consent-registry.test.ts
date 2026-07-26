import { describe, expect, it } from 'vitest'

import { LOCAL_SCREEN_CONSENT_VERSION } from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenConsentRegistry, LocalScreenConsentRegistryError } from './local-screen-consent-registry'

function registerRequest(generation = 1, grantId = 'grant:screen-local', sourceId = 'screen:primary') {
  return {
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId: 'session:screen',
    generation,
    grant: {
      contractVersion: 'perception/v0.3' as const,
      grantId,
      sourceKind: 'screen' as const,
      sourceId,
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

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // `clearAll()` was the only way to release a grant that its own renderer could
  // no longer revoke. When the settings window was closed while it held screen
  // consent, its grant stayed in `activeGrants` and `activeSessionId` kept
  // pointing at its session, so every later register() from the main window hit
  //
  //   if (activeGrants.size > 0 && activeSessionId !== request.sessionId)
  //     throw new LocalScreenConsentRegistryError('session-conflict')
  //
  // and screen perception stayed unusable for the rest of the process lifetime.
  // Calling `clearAll()` from the settings window's teardown would have been
  // worse: it would drop the grants the main window is actively capturing with.
  //
  // We fixed this by tagging each grant with the window that registered it and
  // adding `clearOwner(ownerId)`, which releases only that window's grants and
  // frees the session lock once nothing is left.
  /**
   * @example
   * ```ts
   * expect(registry.clearOwner('renderer:7')).toEqual(['grant:screen-local'])
   * ```
   */
  it('releases only the departed window\'s grants and frees the session', () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    registry.register(registerRequest(), 'renderer:7')

    expect(registry.clearOwner('renderer:8')).toEqual([])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(true)
    // Before the fix this was the state that made every other window fail.
    expect(() => registry.register({ ...registerRequest(), sessionId: 'session:other' }, 'renderer:8'))
      .toThrowError(new LocalScreenConsentRegistryError('session-conflict'))

    expect(registry.clearOwner('renderer:7')).toEqual(['grant:screen-local'])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(false)
    expect(registry.register({ ...registerRequest(), sessionId: 'session:other' }, 'renderer:8').sessionId).toBe('session:other')
  })

  /**
   * @example
   * ```ts
   * expect(registry.isActive('grant:screen-second', 'session:screen', 1)).toBe(true)
   * ```
   */
  it('keeps another owner\'s grant and the session lock it holds', () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    registry.register(registerRequest(), 'renderer:7')
    registry.register(registerRequest(1, 'grant:screen-second', 'screen:secondary'), 'renderer:8')

    expect(registry.clearOwner('renderer:7')).toEqual(['grant:screen-local'])
    expect(registry.isActive('grant:screen-local', 'session:screen', 1)).toBe(false)
    expect(registry.isActive('grant:screen-second', 'session:screen', 1)).toBe(true)
    // The surviving grant still owns the session, so a foreign session is refused.
    expect(() => registry.register({ ...registerRequest(), sessionId: 'session:other' }, 'renderer:9'))
      .toThrowError(new LocalScreenConsentRegistryError('session-conflict'))
  })
})
