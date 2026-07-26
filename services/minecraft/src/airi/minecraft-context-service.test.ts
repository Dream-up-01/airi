import { MINECRAFT_PERCEPTION_LANE } from '@proj-airi/server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { MinecraftContextService } from './minecraft-context-service'

function fakeBot(overrides: Record<string, unknown> = {}): any {
  return {
    username: 'Airi',
    bot: {
      entity: { isInWater: false },
      health: 20,
      food: 20,
      ...overrides,
    },
    reflexManager: {
      refreshFromBotState: vi.fn(),
      getMode: vi.fn(() => 'idle'),
      getContextSnapshot: vi.fn(() => ({ threat: { threatScore: 0 } })),
    },
  }
}

function makeService(masterUsername?: string) {
  const captured: any[] = []
  const airiBridge = {
    onModuleAnnounced: vi.fn(() => () => {}),
    sendContextUpdate: vi.fn((update: any) => captured.push(update)),
  }
  const service = new MinecraftContextService({
    airiBridge: airiBridge as any,
    serverHost: 'private.example',
    serverPort: 25565,
    masterUsername,
  })
  return { service, captured }
}

describe('minecraft context service', () => {
  it('publishes only bounded structured perception events without identity or server details', () => {
    const { service, captured } = makeService('private-owner')
    service.bindBot(fakeBot())

    expect(captured).toHaveLength(4)
    expect(captured.map(update => update.content.eventType)).toEqual([
      'connection-health',
      'player-status',
      'task-state',
      'nearby-threat',
    ])
    expect(captured.every(update => update.lane === MINECRAFT_PERCEPTION_LANE)).toBe(true)
    expect(captured.every(update => update.content.schemaVersion === 1)).toBe(true)
    const serialized = JSON.stringify(captured)
    expect(serialized).not.toContain('private-owner')
    expect(serialized).not.toContain('private.example')
    expect(serialized).not.toContain('Airi')
    service.destroy()
  })

  it('maps health, task and threat to allowlisted values', () => {
    const { service, captured } = makeService()
    const bot = fakeBot({ health: 5, food: 4 })
    bot.reflexManager.getMode.mockReturnValue('alert')
    bot.reflexManager.getContextSnapshot.mockReturnValue({ threat: { threatScore: 3 } })
    service.bindBot(bot)

    expect(captured.map(update => [update.content.eventType, update.content.value])).toEqual([
      ['connection-health', 'connected'],
      ['player-status', 'low-health'],
      ['task-state', 'blocked'],
      ['nearby-threat', 'high'],
    ])
    service.destroy()
  })

  it('publishes ended signals before releasing a bound bot', () => {
    const { service, captured } = makeService()
    service.bindBot(fakeBot())
    captured.length = 0
    service.unbindBot()

    expect(captured).toHaveLength(4)
    expect(captured.every(update => update.content.phase === 'ended')).toBe(true)
    expect(captured[0].content.value).toBe('disconnected')
    service.destroy()
  })
})
