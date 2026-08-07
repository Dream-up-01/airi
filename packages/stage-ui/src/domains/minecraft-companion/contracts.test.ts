import { describe, expect, it } from 'vitest'

import {
  MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION,
  MINECRAFT_COMPANION_CONTRACT_VERSION,
  minecraftActionRiskClasses,
  minecraftAgentActionKinds,
  minecraftHighRiskActionKinds,
  minecraftIntentStates,
  minecraftLowRiskActionKinds,
  minecraftStableErrorCodes,
  parseMinecraftActionProposal,
} from './index'

describe('minecraft companion Phase A contracts', () => {
  it('freezes the two wire lanes and first low-risk action allowlist', () => {
    expect(MINECRAFT_COMPANION_CONTRACT_VERSION).toBe('minecraft-companion/v1')
    expect(MINECRAFT_AGENT_CONTROL_CONTRACT_VERSION).toBe('minecraft-agent-control/v1')
    expect(minecraftLowRiskActionKinds).toEqual([
      'look-at',
      'move-to-player',
      'follow-player',
      'jump',
      'send-chat',
      'select-hotbar',
    ])
    expect(minecraftHighRiskActionKinds).toContain('use-held-item')
    expect(minecraftAgentActionKinds).toContain('attack')
    expect(minecraftActionRiskClasses).toEqual(['low', 'medium', 'high', 'prohibited'])
    expect(minecraftIntentStates).toEqual([
      'proposed',
      'awaiting-approval',
      'approved',
      'executing',
      'completed',
      'failed',
      'cancelled',
      'expired',
      'rejected',
    ])
    expect(minecraftStableErrorCodes).toContain('arbitrary-command-forbidden')
  })

  it('rejects action proposals whose risk class disagrees with the action', () => {
    expect(parseMinecraftActionProposal({
      contractVersion: 'minecraft-agent-control/v1',
      intentId: 'intent-1',
      goalId: 'goal-1',
      sessionId: 'session-1',
      generation: 1,
      serverProfileId: 'profile-1',
      consentGrantId: 'grant-1',
      action: { kind: 'jump' },
      riskClass: 'high',
      state: 'awaiting-approval',
      createdAt: 1_000,
      expiresAt: 5_000,
    }).success).toBe(false)
  })
})
