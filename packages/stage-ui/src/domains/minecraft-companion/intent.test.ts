import { describe, expect, it } from 'vitest'

import { MinecraftIntentController } from './index'

describe('minecraft action intent lifecycle', () => {
  const highRiskContext = {
    serverProfileId: 'pcl-private-1',
    consent: {
      grantId: 'grant-1',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['attack'] as const,
      grantedAt: 1,
    },
    now: 1_000,
  } as const

  it('requires approval before executing a high-risk proposal', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    const proposed = controller.propose({
      intentId: 'intent-1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 1,
      serverProfileId: 'pcl-private-1',
      consentGrantId: 'grant-1',
      action: { kind: 'attack', targetId: 'zombie-1' },
      riskClass: 'high',
      createdAt: 1_000,
      expiresAt: 5_000,
    }, highRiskContext)
    expect(proposed.ok && proposed.value.state).toBe('awaiting-approval')
    expect(controller.startExecution('intent-1').ok).toBe(false)
    expect(controller.approve('intent-1').ok).toBe(true)
    expect(controller.startExecution('intent-1').ok).toBe(true)
  })

  it('rejects duplicate IDs, stale generations and expired intents', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 2, now: () => 10_000 })
    const input = {
      intentId: 'intent-1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 2,
      serverProfileId: 'profile-1',
      consentGrantId: 'grant-1',
      action: { kind: 'jump' } as const,
      riskClass: 'low' as const,
      createdAt: 1_000,
      expiresAt: 9_000,
    }
    const lowRiskContext = {
      serverProfileId: 'profile-1',
      consent: {
        grantId: 'grant-1',
        serverProfileId: 'profile-1',
        allowVirtualPlayerJoin: true,
        allowedActionKinds: ['jump'] as const,
        grantedAt: 1,
      },
      now: 10_000,
    } as const
    expect(controller.propose(input, lowRiskContext).ok).toBe(false)
    expect(controller.propose({ ...input, expiresAt: 20_000 }, lowRiskContext).ok).toBe(true)
    expect(controller.propose({ ...input, expiresAt: 20_000 }, lowRiskContext).ok).toBe(false)
    expect(controller.propose({ ...input, intentId: 'intent-2', generation: 1, expiresAt: 20_000 }, lowRiskContext).ok).toBe(false)
  })

  it('cancels all queued work and increments generation on stop', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    controller.propose({
      intentId: 'intent-1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 1,
      serverProfileId: 'profile-1',
      consentGrantId: 'grant-1',
      action: { kind: 'jump' },
      riskClass: 'low',
      createdAt: 1_000,
      expiresAt: 5_000,
    }, {
      serverProfileId: 'profile-1',
      consent: {
        grantId: 'grant-1',
        serverProfileId: 'profile-1',
        allowVirtualPlayerJoin: true,
        allowedActionKinds: ['jump'],
        grantedAt: 1,
      },
      now: 1_000,
    })
    const stopped = controller.stop('user-stop')
    expect(stopped.generation).toBe(2)
    expect(stopped.intents[0]?.state).toBe('cancelled')
    expect(controller.startExecution('intent-1')).toMatchObject({ ok: false, errorCode: 'stale-generation' })
  })

  it('advances directly to an externally selected generation', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    expect(controller.advanceGeneration(7).generation).toBe(7)
  })

  it('rejects an intent when its consent grant is missing or revoked', () => {
    const controller = new MinecraftIntentController({ sessionId: 'session-1', generation: 1, now: () => 1_000 })
    const input = {
      intentId: 'intent-1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 1,
      serverProfileId: 'profile-1',
      consentGrantId: 'grant-1',
      action: { kind: 'jump' } as const,
      riskClass: 'low' as const,
      createdAt: 1_000,
      expiresAt: 5_000,
    }
    const context = {
      serverProfileId: 'profile-1',
      consent: {
        grantId: 'grant-1',
        serverProfileId: 'profile-1',
        allowVirtualPlayerJoin: false,
        allowedActionKinds: ['jump'] as const,
        grantedAt: 1,
      },
      now: 1_000,
    } as const
    expect(controller.propose(input, context)).toMatchObject({ ok: false, errorCode: 'consent-required' })
  })
})
