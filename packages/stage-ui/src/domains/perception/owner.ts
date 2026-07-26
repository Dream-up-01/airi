export interface PerceptionOwnerHandle {
  ownerId: string
  release: () => Promise<void>
}

export interface PerceptionOwnerProvider {
  acquire: (ownerId: string, signal?: AbortSignal) => Promise<PerceptionOwnerHandle | undefined>
}

export interface NavigatorLockLike {
  name: string
}

export interface NavigatorLocksLike {
  request: <T>(
    name: string,
    options: { ifAvailable: true, signal?: AbortSignal },
    callback: (lock: NavigatorLockLike | null) => Promise<T>,
  ) => Promise<T>
}

/**
 * Creates the production cross-renderer owner provider.
 *
 * No fallback is used when Web Locks are unavailable: pretending to own the
 * capture plane would allow two renderers to collect the same source.
 */
export function createWebLockPerceptionOwnerProvider(
  locks: NavigatorLocksLike | undefined,
  lockName = 'airi:perception:production-owner:v1',
): PerceptionOwnerProvider {
  return {
    async acquire(ownerId, signal) {
      if (!locks)
        return undefined

      let settleAcquired: (acquired: boolean) => void = () => undefined
      let settleRelease: () => void = () => undefined
      let released = false
      const acquired = new Promise<boolean>((resolve) => {
        settleAcquired = resolve
      })
      const releaseGate = new Promise<void>((resolve) => {
        settleRelease = resolve
      })

      let lockRequest: Promise<void>
      try {
        lockRequest = locks.request(lockName, { ifAvailable: true, signal }, async (lock) => {
          if (!lock) {
            settleAcquired(false)
            return
          }
          settleAcquired(true)
          await releaseGate
        })
      }
      catch {
        return undefined
      }
      lockRequest.catch(() => settleAcquired(false))

      if (!await acquired)
        return undefined

      return {
        ownerId,
        async release() {
          if (released)
            return
          released = true
          settleRelease()
          await lockRequest
        },
      }
    },
  }
}

/** Deterministic same-process owner used by tests and non-browser adapters. */
export function createInMemoryPerceptionOwnerProvider(): PerceptionOwnerProvider {
  let currentOwnerId: string | undefined
  return {
    async acquire(ownerId) {
      if (currentOwnerId)
        return undefined
      currentOwnerId = ownerId
      let released = false
      return {
        ownerId,
        async release() {
          if (released)
            return
          released = true
          if (currentOwnerId === ownerId)
            currentOwnerId = undefined
        },
      }
    },
  }
}

/** Shares one cross-renderer lease between source coordinators in the same owner. */
export function createSharedPerceptionOwnerProvider(delegate: PerceptionOwnerProvider): PerceptionOwnerProvider {
  let active: { ownerId: string, handle: PerceptionOwnerHandle, references: number } | undefined
  let acquiring: { ownerId: string, promise: Promise<PerceptionOwnerHandle | undefined> } | undefined

  return {
    async acquire(ownerId, signal) {
      if (signal?.aborted)
        return undefined
      if (active) {
        if (active.ownerId !== ownerId)
          return undefined
        active.references += 1
        return createReference(active)
      }
      if (acquiring) {
        if (acquiring.ownerId !== ownerId)
          return undefined
        const handle = await acquiring.promise
        if (!handle || signal?.aborted)
          return undefined
        active!.references += 1
        return createReference(active!)
      }

      const promise = delegate.acquire(ownerId, signal)
      acquiring = { ownerId, promise }
      const handle = await promise
      acquiring = undefined
      if (!handle)
        return undefined
      active = { ownerId, handle, references: 1 }
      return createReference(active)
    },
  }

  function createReference(lease: NonNullable<typeof active>): PerceptionOwnerHandle {
    let released = false
    return {
      ownerId: lease.ownerId,
      async release() {
        if (released)
          return
        released = true
        lease.references -= 1
        if (lease.references > 0 || active !== lease)
          return
        active = undefined
        await lease.handle.release()
      },
    }
  }
}
