import EventEmitter from 'eventemitter3'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Mineflayer } from './core'

const mocks = vi.hoisted(() => {
  const logger = {
    error: vi.fn(),
    errorWithError: vi.fn(),
    log: vi.fn(),
    withFields: vi.fn(),
    useGlobalConfig: vi.fn(),
  }
  logger.withFields.mockReturnValue(logger)
  logger.useGlobalConfig.mockReturnValue(logger)

  return {
    createBot: vi.fn(),
    logger,
  }
})

vi.mock('@guiiai/logg', () => ({
  useLogg: vi.fn(() => mocks.logger),
}))

vi.mock('mineflayer', () => ({
  default: {
    createBot: mocks.createBot,
  },
}))

class FakeBot extends EventEmitter {
  public _client = {}
  public game = { gameMode: 'survival' }
  public health = 20
  public time = { timeOfDay: 0 }

  public acceptResourcePack = vi.fn()
  public chat = vi.fn()
  public clearControlStates = vi.fn()
  public loadPlugin = vi.fn()
  public quit = vi.fn()
  public respawn = vi.fn()
}

describe('mineflayer physical disconnect cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cleans up one generation once when the same bot emits kicked and end', async () => {
    const bot = new FakeBot()
    mocks.createBot.mockReturnValue(bot)
    const beforeCleanup = vi.fn().mockResolvedValue(undefined)
    const mineflayer = await Mineflayer.asyncBuild({
      botConfig: {
        host: 'localhost',
        username: 'airi-test',
      },
      plugins: [{ beforeCleanup }],
      reconnect: { enabled: false },
    })

    try {
      bot.emit('kicked', 'test kick')
      bot.emit('end', 'socket closed')
      await Promise.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))

      expect(beforeCleanup).toHaveBeenCalledOnce()
      expect(mocks.createBot).toHaveBeenCalledOnce()
    }
    finally {
      await mineflayer.stop()
    }

    expect(beforeCleanup).toHaveBeenCalledOnce()
  })

  it('clears readiness immediately when the final connection ends', async () => {
    const bot = new FakeBot()
    mocks.createBot.mockReturnValue(bot)
    const mineflayer = await Mineflayer.asyncBuild({
      botConfig: {
        host: 'localhost',
        username: 'airi-test',
      },
      reconnect: { enabled: false },
    })

    try {
      bot.emit('spawn')
      expect(mineflayer.ready).toBe(true)

      bot.emit('end', 'socket closed')

      expect(mineflayer.ready).toBe(false)
    }
    finally {
      await mineflayer.stop()
    }
  })
})
