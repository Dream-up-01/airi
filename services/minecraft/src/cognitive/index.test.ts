import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CognitiveEngine } from './index'

const services = vi.hoisted(() => ({
  perceptionPipeline: { init: vi.fn(), destroy: vi.fn() },
  brain: {
    init: vi.fn(),
    destroy: vi.fn(),
    getReplState: vi.fn(),
    broadcastConversationState: vi.fn(),
    executeDebugRepl: vi.fn(),
    togglePaused: vi.fn(),
  },
  reflexManager: { init: vi.fn(), destroy: vi.fn() },
  taskExecutor: { setMineflayer: vi.fn(), initialize: vi.fn(), destroy: vi.fn() },
  airiBridge: { init: vi.fn(), destroy: vi.fn() },
  minecraftContextService: { init: vi.fn(), destroy: vi.fn() },
  minecraftAgentCompanion: { init: vi.fn(), destroy: vi.fn(async () => 2) },
  ruleEngine: { destroy: vi.fn() },
  eventBus: { emit: vi.fn() },
}))

vi.mock('./container', () => ({
  createAgentContainer: vi.fn(() => ({
    resolve: (key: keyof typeof services) => services[key],
  })),
}))

vi.mock('../debug', () => ({
  DebugService: {
    getInstance: () => ({ onCommand: vi.fn(), emit: vi.fn() }),
  },
}))

function createBot() {
  return {
    username: 'airi_bot',
    bot: {
      entity: {},
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
      chat: vi.fn(),
    },
    onTick: vi.fn(),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('cognitive engine minecraft companion lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the guarded runtime after TaskExecutor and stops it before bridge cleanup', async () => {
    const bot = createBot()
    const plugin = CognitiveEngine({ airiClient: {} as any })

    await plugin.created?.(bot as any)

    expect(services.taskExecutor.initialize).toHaveBeenCalledOnce()
    expect(services.minecraftAgentCompanion.init).toHaveBeenCalledWith(bot)
    expect(services.taskExecutor.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      services.minecraftAgentCompanion.init.mock.invocationCallOrder[0]!,
    )

    await plugin.beforeCleanup?.(bot as any)

    expect(services.minecraftAgentCompanion.destroy).toHaveBeenCalledOnce()
    expect(services.minecraftAgentCompanion.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.airiBridge.destroy.mock.invocationCallOrder[0]!,
    )
  })

  it('waits for companion shutdown to settle before starting downstream cleanup', async () => {
    const bot = createBot()
    const plugin = CognitiveEngine({ airiClient: {} as any })
    const companionShutdown = createDeferred<number>()
    services.minecraftAgentCompanion.destroy.mockImplementationOnce(() => companionShutdown.promise)

    await plugin.created?.(bot as any)
    const cleanup = plugin.beforeCleanup?.(bot as any)

    expect(services.minecraftAgentCompanion.destroy).toHaveBeenCalledOnce()
    expect(services.minecraftContextService.destroy).not.toHaveBeenCalled()
    expect(services.airiBridge.destroy).not.toHaveBeenCalled()
    expect(services.brain.destroy).not.toHaveBeenCalled()
    expect(services.taskExecutor.destroy).not.toHaveBeenCalled()
    expect(services.perceptionPipeline.destroy).not.toHaveBeenCalled()
    expect(services.ruleEngine.destroy).not.toHaveBeenCalled()
    expect(services.reflexManager.destroy).not.toHaveBeenCalled()

    companionShutdown.resolve(2)
    await cleanup

    expect(services.minecraftContextService.destroy).toHaveBeenCalledOnce()
    expect(services.airiBridge.destroy).toHaveBeenCalledOnce()
    expect(services.brain.destroy).toHaveBeenCalledOnce()
    expect(services.taskExecutor.destroy).toHaveBeenCalledOnce()
    expect(services.perceptionPipeline.destroy).toHaveBeenCalledOnce()
    expect(services.ruleEngine.destroy).toHaveBeenCalledOnce()
    expect(services.reflexManager.destroy).toHaveBeenCalledOnce()
    expect(services.minecraftAgentCompanion.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.minecraftContextService.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.minecraftContextService.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.airiBridge.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.airiBridge.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.brain.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.brain.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.taskExecutor.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.taskExecutor.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.perceptionPipeline.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.perceptionPipeline.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.ruleEngine.destroy.mock.invocationCallOrder[0]!,
    )
    expect(services.ruleEngine.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      services.reflexManager.destroy.mock.invocationCallOrder[0]!,
    )
  })
})
