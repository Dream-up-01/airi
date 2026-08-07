import { beforeEach, describe, expect, it, vi } from 'vitest'

import { breakBlockAt } from '../../skills/actions/world-interactions'
import { actionsList } from './llm-actions'

vi.mock('../../skills/actions/world-interactions', () => ({
  activateNearestBlock: vi.fn(),
  breakBlockAt: vi.fn(async () => true),
  placeBlock: vi.fn(),
}))

function getMineBlockAtAction() {
  const action = actionsList.find(item => item.name === 'mineBlockAt')
  if (!action)
    throw new Error('mineBlockAt action missing')
  return action
}

function getChatAction() {
  const action = actionsList.find(item => item.name === 'chat')
  if (!action)
    throw new Error('chat action missing')
  return action
}

describe('llm-actions mineBlockAt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows expected torch when actual block is wall_torch', async () => {
    const mineBlockAtAction = getMineBlockAtAction()
    const mineflayer = {
      bot: {
        blockAt: vi.fn(() => ({ name: 'wall_torch' })),
      },
    } as any

    const perform = mineBlockAtAction.perform(mineflayer)
    const result = await perform(1, 2, 3, 'torch')

    expect(result).toContain('Mined block at (1, 2, 3)')
    expect(breakBlockAt).toHaveBeenCalledWith(mineflayer, 1, 2, 3)
  })

  it('rejects unrelated expected block types', async () => {
    const mineBlockAtAction = getMineBlockAtAction()
    const mineflayer = {
      bot: {
        blockAt: vi.fn(() => ({ name: 'oak_log' })),
      },
    } as any

    const perform = mineBlockAtAction.perform(mineflayer)
    await expect(perform(1, 2, 3, 'torch')).rejects.toThrow(/Block type mismatch/i)
    expect(breakBlockAt).not.toHaveBeenCalled()
  })

  it('rejects collection-only aliases for exact block validation', async () => {
    const mineBlockAtAction = getMineBlockAtAction()
    const mineflayer = {
      bot: {
        blockAt: vi.fn(() => ({ name: 'grass_block' })),
      },
    } as any

    const perform = mineBlockAtAction.perform(mineflayer)
    await expect(perform(1, 2, 3, 'dirt')).rejects.toThrow(/Block type mismatch/i)
    expect(breakBlockAt).not.toHaveBeenCalled()
  })

  it('exposes skip tool with stable return value', async () => {
    const skipAction = actionsList.find(item => item.name === 'skip')
    expect(skipAction).toBeDefined()

    const perform = skipAction!.perform({} as any)
    expect(perform()).toBe('Skipped turn')
  })

  it('bounds chat and rejects server commands at schema and execution boundaries', () => {
    const chatAction = getChatAction()
    expect(chatAction.schema.safeParse({ message: 'hello', feedback: false }).success).toBe(true)
    expect(chatAction.schema.safeParse({ message: '/op me', feedback: false }).success).toBe(false)
    expect(chatAction.schema.safeParse({ message: 'x'.repeat(257), feedback: false }).success).toBe(false)
    expect(chatAction.schema.safeParse({ message: 'hello\n/op me', feedback: false }).success).toBe(false)

    const mineflayer = { bot: { chat: vi.fn() } } as any
    const perform = chatAction.perform(mineflayer)
    expect(() => perform('/op me')).toThrow(/not allowed/i)
    expect(mineflayer.bot.chat).not.toHaveBeenCalled()
  })
})
