import type { Logg } from '@guiiai/logg'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectionSupervisor } from './connection-supervisor'

function createLogger(): Logg {
  const logger = {
    error: vi.fn(),
    errorWithError: vi.fn(),
    log: vi.fn(),
    withFields: vi.fn(),
  }

  logger.withFields.mockReturnValue(logger)
  return logger as unknown as Logg
}

describe('connection supervisor disconnect cleanup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cleans up a disconnected bot when reconnect is disabled', async () => {
    const beforeCleanup = vi.fn().mockResolvedValue(undefined)
    const replaceBot = vi.fn().mockResolvedValue(undefined)
    const supervisor = createConnectionSupervisor({
      logger: createLogger(),
      reconnect: { enabled: false },
      beforeCleanup,
      replaceBot,
    })

    await supervisor.onDisconnect('end')

    expect(beforeCleanup).toHaveBeenCalledOnce()
    expect(replaceBot).not.toHaveBeenCalled()
  })

  it('cleans up the final disconnected bot after max retries are reached', async () => {
    const beforeCleanup = vi.fn().mockResolvedValue(undefined)
    const replaceBot = vi.fn().mockResolvedValue(undefined)
    const supervisor = createConnectionSupervisor({
      logger: createLogger(),
      reconnect: { enabled: true, maxRetries: 1 },
      beforeCleanup,
      replaceBot,
    })

    await supervisor.onDisconnect('first-end')
    await supervisor.onDisconnect('final-end')

    expect(beforeCleanup).toHaveBeenCalledTimes(2)
    expect(replaceBot).toHaveBeenCalledOnce()
    supervisor.stop()
  })

  it('waits for cleanup to settle before replacing the bot', async () => {
    const events: string[] = []
    let settleCleanup!: () => void
    const cleanupPending = new Promise<void>((resolve) => {
      settleCleanup = resolve
    })
    const beforeCleanup = vi.fn(async () => {
      events.push('cleanup-started')
      await cleanupPending
      events.push('cleanup-settled')
    })
    const replaceBot = vi.fn(async () => {
      events.push('replace-bot')
    })
    const supervisor = createConnectionSupervisor({
      logger: createLogger(),
      reconnect: { enabled: true },
      beforeCleanup,
      replaceBot,
    })

    const disconnectPending = supervisor.onDisconnect('end')
    await vi.waitFor(() => expect(beforeCleanup).toHaveBeenCalledOnce())

    expect(replaceBot).not.toHaveBeenCalled()
    settleCleanup()
    await disconnectPending

    expect(events).toEqual(['cleanup-started', 'cleanup-settled', 'replace-bot'])
    supervisor.stop()
  })

  it('does not reconnect from a pending watchdog after cleanup rejects and keeps the queue usable', async () => {
    vi.useFakeTimers()
    const cleanupError = new Error('cleanup failed')
    const beforeCleanup = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce(undefined)
    const replaceBot = vi.fn().mockResolvedValue(undefined)
    const supervisor = createConnectionSupervisor({
      logger: createLogger(),
      reconnect: { enabled: true, maxRetries: 3 },
      spawnTimeoutMs: 10,
      beforeCleanup,
      replaceBot,
    })

    await supervisor.onDisconnect('first-end')
    await expect(supervisor.onDisconnect('cleanup-failed-end')).rejects.toBe(cleanupError)

    await vi.advanceTimersByTimeAsync(10)
    expect(beforeCleanup).toHaveBeenCalledTimes(2)
    expect(replaceBot).toHaveBeenCalledOnce()

    await expect(supervisor.onDisconnect('later-end')).resolves.toBeUndefined()
    expect(beforeCleanup).toHaveBeenCalledTimes(3)
    expect(replaceBot).toHaveBeenCalledTimes(2)
    supervisor.stop()
  })

  it('does not start disconnect cleanup after stop', async () => {
    const beforeCleanup = vi.fn().mockResolvedValue(undefined)
    const replaceBot = vi.fn().mockResolvedValue(undefined)
    const supervisor = createConnectionSupervisor({
      logger: createLogger(),
      reconnect: { enabled: true },
      beforeCleanup,
      replaceBot,
    })

    supervisor.stop()
    await supervisor.onDisconnect('end-after-stop')

    expect(beforeCleanup).not.toHaveBeenCalled()
    expect(replaceBot).not.toHaveBeenCalled()
  })
})
