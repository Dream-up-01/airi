import type { MinecraftActionExecutionContext } from '@proj-airi/stage-ui/domains/minecraft-companion'

import { Vec3 } from 'vec3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MineflayerActionExecutor } from './mineflayer-action-executor'

const context: MinecraftActionExecutionContext = {
  goalId: 'goal-1',
  sessionId: 'session-1',
  generation: 1,
  serverProfileId: 'server-profile-1',
  intentId: 'intent-1',
  signal: new AbortController().signal,
}

function createHarness() {
  const executeActionWithResult = vi.fn(async () => ({ ok: true }))
  const lookAt = vi.fn(async () => {})
  const setControlState = vi.fn()
  const setQuickBarSlot = vi.fn()
  const activateItem = vi.fn()
  const interrupt = vi.fn()
  const sleep = vi.fn(async () => {})
  const mineflayer = {
    bot: {
      players: {
        Alex: { entity: { position: new Vec3(1, 2, 3) } },
      },
      lookAt,
      setControlState,
      setQuickBarSlot,
      activateItem,
    },
    interrupt,
  }
  const executor = new MineflayerActionExecutor({
    taskExecutor: { executeActionWithResult },
    mineflayer,
    now: () => 1_000,
    sleep,
  })
  return {
    executor,
    executeActionWithResult,
    lookAt,
    setControlState,
    setQuickBarSlot,
    activateItem,
    interrupt,
    sleep,
  }
}

describe('mineflayer action executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps movement and chat to the existing task executor', async () => {
    const { executor, executeActionWithResult } = createHarness()

    await executor.execute({ kind: 'move-to-player', playerId: 'Alex', radius: 3 }, context)
    await executor.execute({ kind: 'follow-player', playerId: 'Alex', radius: 4 }, context)
    await executor.execute({ kind: 'send-chat', message: 'Hello' }, context)

    expect(executeActionWithResult).toHaveBeenNthCalledWith(1, {
      tool: 'goToPlayer',
      params: { player_name: 'Alex', closeness: 3 },
    })
    expect(executeActionWithResult).toHaveBeenNthCalledWith(2, {
      tool: 'followPlayer',
      params: { player_name: 'Alex', follow_dist: 4 },
    })
    expect(executeActionWithResult).toHaveBeenNthCalledWith(3, {
      tool: 'chat',
      params: { message: 'Hello', feedback: false },
    })
  })

  it('uses bounded direct bot operations for look, jump, hotbar, and held item', async () => {
    const { executor, lookAt, setControlState, setQuickBarSlot, activateItem, sleep } = createHarness()

    await expect(executor.execute({ kind: 'look-at', playerId: 'Alex' }, context)).resolves.toMatchObject({ state: 'completed' })
    await expect(executor.execute({ kind: 'jump' }, context)).resolves.toMatchObject({ state: 'completed' })
    await expect(executor.execute({ kind: 'select-hotbar', slot: 2 }, context)).resolves.toMatchObject({ state: 'completed' })
    await expect(executor.execute({ kind: 'use-held-item' }, context)).resolves.toMatchObject({ state: 'completed' })

    expect(lookAt).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 }, true)
    expect(setControlState).toHaveBeenNthCalledWith(1, 'jump', true)
    expect(sleep).toHaveBeenCalledWith(250, context.signal)
    expect(setControlState).toHaveBeenLastCalledWith('jump', false)
    expect(setQuickBarSlot).toHaveBeenCalledWith(2)
    expect(activateItem).toHaveBeenCalledOnce()
  })

  it('rejects unsupported high-risk actions without invoking an arbitrary tool name', async () => {
    const { executor, executeActionWithResult } = createHarness()

    expect(executor.supports({ kind: 'attack', targetId: 'zombie-1' })).toBe(false)
    await expect(executor.execute({ kind: 'attack', targetId: 'zombie-1' }, context)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'control-denied',
    })
    expect(executeActionWithResult).not.toHaveBeenCalled()
  })

  it('clears jump state after failure and forwards cancellation to Mineflayer', async () => {
    const { executor, setControlState, interrupt, sleep } = createHarness()
    sleep.mockRejectedValueOnce(new Error('timer failed'))

    await expect(executor.execute({ kind: 'jump' }, context)).resolves.toMatchObject({ state: 'failed', errorCode: 'unknown' })
    expect(setControlState).toHaveBeenLastCalledWith('jump', false)

    await executor.cancel(context.intentId, context)
    expect(interrupt).toHaveBeenCalledWith(`minecraft-agent:${context.intentId}:cancelled`)
  })
})
