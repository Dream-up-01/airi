import type { ModulePairingApprovalRequest } from '@proj-airi/server-runtime'

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

/**
 * Builds an approval request identical in shape to what `server-runtime` hands
 * to the pairing provider.
 *
 * @example
 * approvalRequest({ requestId: 'req-2' })
 * // => { requestId: 'req-2', deviceId: 'device-1', publicKey: 'public-key-1', ... }
 */
function approvalRequest(overrides: Partial<ModulePairingApprovalRequest> = {}): ModulePairingApprovalRequest {
  return {
    requestId: 'req-1',
    deviceId: 'device-1',
    publicKey: 'public-key-1',
    displayName: 'Fabric on Steve',
    clientVersion: '0.1.0',
    verificationCode: '482913',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

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

  // Found by code review 2026-07-26 (M3 perception review); no tracker issue exists.
  //
  // ROOT CAUSE:
  //
  // `requestApproval` only registered the request in `pending` and then waited
  // for a renderer to call `approve`/`reject`, or for the expiry timer to call
  // `resolvePending(requestId, false)`. The main process had no out-of-band exit,
  // and the only consumer polled from the Minecraft tab of the perception
  // control surface, which is provided by the main stage and settings windows.
  //
  // So a request raised while that tab was not on screen (Minecraft plus the
  // Fabric mod started before AIRI, or another perception tab selected) expired
  // silently. The mod treats pairing denial as terminal and does not reconnect
  // (docs/cn-companion/workstreams/m3-10-fabric-hardening-plan.md:49-51), so the
  // user had to restart the mod with nothing explaining why.
  //
  // We fixed this by announcing every newly pending request through an injected
  // `MinecraftPairingNotifier`, and by withdrawing the notice once the request
  // resolves.
  it('announces a pending request to the out-of-band surface without leaking the device public key', async () => {
    const onRequested = vi.fn()
    const onResolved = vi.fn()
    const manager = new MinecraftPairingManager({ notifier: { onRequested, onResolved } })
    const request = approvalRequest()

    const approval = manager.requestApproval(request)

    expect(onRequested).toHaveBeenCalledTimes(1)
    expect(onRequested).toHaveBeenCalledWith({
      requestId: 'req-1',
      displayName: 'Fabric on Steve',
      verificationCode: '482913',
      expiresAt: request.expiresAt,
    })
    const notice: unknown = onRequested.mock.calls[0][0]
    expect(notice).not.toHaveProperty('publicKey')
    expect(JSON.stringify(notice)).not.toContain('public-key-1')
    expect(onResolved).not.toHaveBeenCalled()

    expect(manager.approve('req-1')).toBe(true)
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith('req-1')
    await expect(approval).resolves.toBe(true)

    manager.dispose()
  })

  it('keeps the approval flow usable when the notification port throws', async () => {
    const manager = new MinecraftPairingManager({
      notifier: {
        onRequested: vi.fn(() => {
          throw new Error('notification centre unavailable')
        }),
        onResolved: vi.fn(() => {
          throw new Error('notification already dismissed')
        }),
      },
    })

    const approval = manager.requestApproval(approvalRequest({ requestId: 'req-2' }))

    expect(manager.listRequests().map(request => request.requestId)).toEqual(['req-2'])
    expect(manager.approve('req-2')).toBe(true)
    await expect(approval).resolves.toBe(true)

    manager.dispose()
  })

  it('withdraws the notice when a request expires without a decision', async () => {
    vi.useFakeTimers()
    const onResolved = vi.fn()
    const manager = new MinecraftPairingManager({ notifier: { onRequested: vi.fn(), onResolved } })

    const approval = manager.requestApproval(approvalRequest({ requestId: 'req-3', expiresAt: Date.now() + 1_000 }))
    vi.advanceTimersByTime(1_000)

    await expect(approval).resolves.toBe(false)
    expect(onResolved).toHaveBeenCalledWith('req-3')
    expect(manager.listRequests()).toEqual([])

    manager.dispose()
    vi.useRealTimers()
  })

  it('announces requests once a notifier is attached after construction', () => {
    const manager = new MinecraftPairingManager()
    const onRequested = vi.fn()

    void manager.requestApproval(approvalRequest({ requestId: 'req-4' }))
    expect(onRequested).not.toHaveBeenCalled()

    manager.setNotifier({ onRequested })
    void manager.requestApproval(approvalRequest({ requestId: 'req-5' }))

    expect(onRequested).toHaveBeenCalledTimes(1)
    expect(onRequested.mock.calls[0][0]).toMatchObject({ requestId: 'req-5' })

    manager.dispose()
  })
})
