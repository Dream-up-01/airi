import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'

import { afterEach, describe, expect, it, vi } from 'vitest'

const peers: Array<{ dispose: () => void }> = []

afterEach(() => {
  for (const peer of peers.splice(0))
    peer.dispose()
  vi.resetModules()
})

describe('perception runtime status sync', () => {
  it('mirrors active structured state across renderer peers and retracts stopped state', async () => {
    vi.resetModules()
    const firstRenderer = await import('./perception-runtime-status-sync')
    vi.resetModules()
    const secondRenderer = await import('./perception-runtime-status-sync')
    let firstRemote: readonly PerceptionRuntimeStatusWire[] = []
    let secondRemote: readonly PerceptionRuntimeStatusWire[] = []

    const first = firstRenderer.createPerceptionRuntimeStatusPeer({
      sourceKind: 'screen',
      initialState: 'running',
      initialGeneration: 2,
      onRemoteStatuses: statuses => firstRemote = statuses,
    })
    const second = secondRenderer.createPerceptionRuntimeStatusPeer({
      sourceKind: 'camera',
      initialState: 'idle',
      initialGeneration: 0,
      onRemoteStatuses: statuses => secondRemote = statuses,
    })
    peers.push(first, second)

    await vi.waitFor(() => {
      expect(secondRemote).toEqual([
        expect.objectContaining({
          sourceKind: 'screen',
          state: 'running',
          generation: 2,
        }),
      ])
    })

    second.publish('running', 1)
    await vi.waitFor(() => {
      expect(firstRemote).toEqual([
        expect.objectContaining({
          sourceKind: 'camera',
          state: 'running',
          generation: 1,
        }),
      ])
    })

    first.publish('stopped', 3)
    await vi.waitFor(() => expect(secondRemote).toEqual([]))
  })

  it('recreates the shared channel after the last peer is disposed', async () => {
    const module = await import('./perception-runtime-status-sync')
    const first = module.createPerceptionRuntimeStatusPeer({
      sourceKind: 'screen',
      initialState: 'idle',
      initialGeneration: 0,
      onRemoteStatuses: () => undefined,
    })
    first.dispose()
    const second = module.createPerceptionRuntimeStatusPeer({
      sourceKind: 'screen',
      initialState: 'idle',
      initialGeneration: 0,
      onRemoteStatuses: () => undefined,
    })
    peers.push(second)
    expect(() => second.publish('running', 1)).not.toThrow()
  })
})
