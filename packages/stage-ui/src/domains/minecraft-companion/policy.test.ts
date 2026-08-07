import { describe, expect, it } from 'vitest'

import { assessMinecraftAction, createMinecraftGoal } from './index'

describe('minecraft companion action policy', () => {
  const context = {
    serverProfileId: 'pcl-private-1',
    consent: {
      contractVersion: 'minecraft-agent-control/v1' as const,
      grantId: 'grant-1',
      serverProfileId: 'pcl-private-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'follow-player', 'send-chat', 'attack'] as const,
      grantedAt: 1,
      showPersistentIndicator: true,
    },
    now: 10_000,
  } as const

  it('auto-admits low-risk actions only when the matching grant exists', () => {
    expect(assessMinecraftAction({ kind: 'follow-player', playerId: 'player-1', radius: 4 }, context)).toMatchObject({ riskClass: 'low', decision: 'auto' })
    expect(assessMinecraftAction({ kind: 'jump' }, { ...context, consent: { ...context.consent, allowedActionKinds: ['look-at'] } })).toMatchObject({ decision: 'reject', errorCode: 'action-not-granted' })
  })

  it('rejects grants that are not active or do not permit the virtual player to join', () => {
    expect(assessMinecraftAction({ kind: 'look-at', playerId: 'player-1' }, {
      ...context,
      now: 0,
    })).toMatchObject({ decision: 'reject', errorCode: 'consent-required' })
    expect(assessMinecraftAction({ kind: 'look-at', playerId: 'player-1' }, {
      ...context,
      consent: { ...context.consent, allowVirtualPlayerJoin: false },
    })).toMatchObject({ decision: 'reject', errorCode: 'consent-required' })
  })

  it('requires approval for high-risk and rejects prohibited actions', () => {
    expect(assessMinecraftAction({ kind: 'attack', targetId: 'zombie-1' }, context)).toMatchObject({ riskClass: 'high', decision: 'approval-required' })
    expect(assessMinecraftAction({ kind: 'use-held-item' }, {
      ...context,
      consent: { ...context.consent, allowedActionKinds: ['use-held-item'] },
    })).toMatchObject({ riskClass: 'high', decision: 'approval-required' })
    expect(assessMinecraftAction({ kind: 'execute-command', command: '/op me' }, context)).toMatchObject({ decision: 'reject', errorCode: 'arbitrary-command-forbidden' })
  })

  it('creates bounded goals and rejects free-form action text', () => {
    expect(createMinecraftGoal({
      contractVersion: 'minecraft-agent-control/v1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 1,
      serverProfileId: 'pcl-private-1',
      consentGrantId: 'grant-1',
      kind: 'follow-player',
      playerId: 'player-1',
      radius: 4,
      createdAt: 1_000,
      expiresAt: 10_000,
    }).ok).toBe(true)
    expect(createMinecraftGoal({ kind: 'do-anything', prompt: 'run arbitrary command' }).ok).toBe(false)
  })
})
