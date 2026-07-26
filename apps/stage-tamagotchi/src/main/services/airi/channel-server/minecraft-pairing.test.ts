import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MinecraftPairingManager } from './minecraft-pairing'

const persistence = vi.hoisted(() => ({
  value: { devices: [] as Array<Record<string, unknown>> },
}))

vi.mock('../../../libs/electron/persistence', () => ({
  createConfig: () => ({
    setup: () => ({ status: 'ok' }),
    get: () => persistence.value,
    update: (value: typeof persistence.value) => {
      persistence.value = value
    },
  }),
}))

describe('minecraft pairing manager', () => {
  beforeEach(() => {
    persistence.value = { devices: [] }
  })

  it('notifies revocation subscribers only after removing a paired device', () => {
    const manager = new MinecraftPairingManager()
    const listener = vi.fn()
    const unsubscribe = manager.subscribeRevocations(listener)
    const identity = {
      deviceId: 'device-1',
      publicKey: 'public-key-1',
      displayName: 'Fabric',
      clientVersion: '0.1.0',
    }

    manager.remember(identity)
    expect(manager.revoke('missing')).toBe(false)
    expect(listener).not.toHaveBeenCalled()

    expect(manager.revoke('device-1')).toBe(true)
    expect(listener).toHaveBeenCalledWith('device-1')

    unsubscribe()
    manager.dispose()
  })
})
