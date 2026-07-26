import type { NavigatorLockLike } from './owner'

import { describe, expect, it } from 'vitest'

import { createInMemoryPerceptionOwnerProvider, createSharedPerceptionOwnerProvider, createWebLockPerceptionOwnerProvider } from './owner'

describe('perception production owner', () => {
  it('shares one delegate lease across source coordinators for the same renderer owner', async () => {
    const shared = createSharedPerceptionOwnerProvider(createInMemoryPerceptionOwnerProvider())
    const screen = await shared.acquire('renderer:main')
    const camera = await shared.acquire('renderer:main')
    expect(screen).toBeDefined()
    expect(camera).toBeDefined()
    expect(await shared.acquire('renderer:settings')).toBeUndefined()

    await screen?.release()
    expect(await shared.acquire('renderer:settings')).toBeUndefined()
    await camera?.release()
    expect(await shared.acquire('renderer:settings')).toBeDefined()
  })
  it('allows only one in-memory owner and releases idempotently', async () => {
    const provider = createInMemoryPerceptionOwnerProvider()
    const first = await provider.acquire('renderer:1')
    expect(first?.ownerId).toBe('renderer:1')
    expect(await provider.acquire('renderer:2')).toBeUndefined()
    await first?.release()
    await first?.release()
    expect((await provider.acquire('renderer:2'))?.ownerId).toBe('renderer:2')
  })

  it('fails closed when Web Locks are unavailable', async () => {
    const provider = createWebLockPerceptionOwnerProvider(undefined)
    expect(await provider.acquire('renderer:1')).toBeUndefined()
  })

  it('fails closed when a Web Lock request is aborted or throws synchronously', async () => {
    const controller = new AbortController()
    controller.abort('test-abort')
    const rejectedLocks = {
      request: async () => {
        throw new DOMException('Aborted', 'AbortError')
      },
    }
    expect(await createWebLockPerceptionOwnerProvider(rejectedLocks).acquire('renderer:1', controller.signal)).toBeUndefined()

    const throwingLocks = {
      request: () => {
        throw new DOMException('Aborted', 'AbortError')
      },
    }
    expect(await createWebLockPerceptionOwnerProvider(throwingLocks).acquire('renderer:1', controller.signal)).toBeUndefined()
  })

  it('holds the Web Lock until release', async () => {
    let busy = false
    const locks = {
      async request<T>(_name: string, _options: { ifAvailable: true }, callback: (lock: NavigatorLockLike | null) => Promise<T>): Promise<T> {
        if (busy)
          return callback(null)
        busy = true
        try {
          return await callback({ name: 'airi:perception:production-owner:v1' })
        }
        finally {
          busy = false
        }
      },
    }
    const provider = createWebLockPerceptionOwnerProvider(locks)
    const first = await provider.acquire('renderer:1')
    expect(first).toBeDefined()
    expect(await provider.acquire('renderer:2')).toBeUndefined()
    await first?.release()
    expect((await provider.acquire('renderer:2'))?.ownerId).toBe('renderer:2')
  })
})
