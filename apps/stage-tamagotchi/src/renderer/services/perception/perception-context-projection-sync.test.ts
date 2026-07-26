import type { PerceptionContextProjection } from '@proj-airi/stage-ui/domains/perception'

import { afterEach, describe, expect, it, vi } from 'vitest'

const peers: Array<{ dispose: () => void }> = []

const projection: PerceptionContextProjection = {
  contractVersion: 'perception/v0.3',
  projectionId: 'projection:snapshot:1',
  factIds: ['fact:1'],
  createdAt: 1_000,
  expiresAt: 21_000,
  sourceSummary: 'local-screen',
  statements: ['Current screen activity is classified as code.'],
  maxCharacters: 640,
  maxFacts: 4,
}

afterEach(() => {
  for (const peer of peers.splice(0))
    peer.dispose()
  vi.resetModules()
})

describe('perception context projection sync', () => {
  it('mirrors a strict projection and retracts it when the owner clears', async () => {
    vi.resetModules()
    const firstRenderer = await import('./perception-context-projection-sync')
    vi.resetModules()
    const secondRenderer = await import('./perception-context-projection-sync')
    let remoteProjection: PerceptionContextProjection | null = null

    const first = firstRenderer.createPerceptionContextProjectionPeer({
      sourceKind: 'screen',
      now: () => 2_000,
      onRemoteProjection: () => undefined,
    })
    const second = secondRenderer.createPerceptionContextProjectionPeer({
      sourceKind: 'screen',
      now: () => 2_000,
      onRemoteProjection: next => remoteProjection = next,
    })
    peers.push(first, second)

    first.publish(projection, 1)
    await vi.waitFor(() => expect(remoteProjection).toEqual(projection))

    first.publish(null, 2)
    await vi.waitFor(() => expect(remoteProjection).toBeNull())
  })

  it('does not deliver a screen projection to another source peer', async () => {
    vi.resetModules()
    const firstRenderer = await import('./perception-context-projection-sync')
    vi.resetModules()
    const secondRenderer = await import('./perception-context-projection-sync')
    const cameraRemote = vi.fn()

    const first = firstRenderer.createPerceptionContextProjectionPeer({
      sourceKind: 'screen',
      now: () => 2_000,
      onRemoteProjection: () => undefined,
    })
    const second = secondRenderer.createPerceptionContextProjectionPeer({
      sourceKind: 'camera',
      now: () => 2_000,
      onRemoteProjection: cameraRemote,
    })
    peers.push(first, second)

    first.publish(projection, 1)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(cameraRemote).not.toHaveBeenCalled()
  })

  it('recreates the shared channel after the last peer is disposed', async () => {
    const module = await import('./perception-context-projection-sync')
    const first = module.createPerceptionContextProjectionPeer({
      sourceKind: 'screen',
      now: () => 2_000,
      onRemoteProjection: () => undefined,
    })
    first.dispose()
    const second = module.createPerceptionContextProjectionPeer({
      sourceKind: 'screen',
      now: () => 2_000,
      onRemoteProjection: () => undefined,
    })
    peers.push(second)
    expect(() => second.publish(projection, 1)).not.toThrow()
  })
})
