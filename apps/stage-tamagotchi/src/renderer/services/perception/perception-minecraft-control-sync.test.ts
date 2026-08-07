import type { PerceptionRuntimeState } from '../../../shared/eventa/perception-runtime-status'

import { afterEach, describe, expect, it, vi } from 'vitest'

const peers: Array<{ dispose: () => void }> = []

afterEach(() => {
  for (const peer of peers.splice(0))
    peer.dispose()
  vi.resetModules()
})

describe('minecraft perception control sync', () => {
  it('routes a settings consent request to the main owner and returns its state', async () => {
    vi.resetModules()
    const ownerModule = await import('./perception-minecraft-control-sync')
    vi.resetModules()
    const settingsModule = await import('./perception-minecraft-control-sync')

    const owner = ownerModule.createMinecraftPerceptionControlPeer({
      onRequest: async (_request, respond) => {
        respond({ state: 'running' satisfies PerceptionRuntimeState, generation: 4 })
      },
      now: () => 10_000,
    })
    const settings = settingsModule.createMinecraftPerceptionControlPeer({
      now: () => 10_000,
    })
    peers.push(owner, settings)

    await expect(settings.request('start', true)).resolves.toMatchObject({
      state: 'running',
      generation: 4,
    })
  })

  it('keeps the main owner reachable after a settings peer is disposed', async () => {
    vi.resetModules()
    const ownerModule = await import('./perception-minecraft-control-sync')
    vi.resetModules()
    const settingsModule = await import('./perception-minecraft-control-sync')
    const handledCommands: string[] = []

    const owner = ownerModule.createMinecraftPerceptionControlPeer({
      onRequest: async (request, respond) => {
        handledCommands.push(request.command)
        respond({
          state: request.command === 'pause' ? 'paused' : 'running',
          generation: request.command === 'pause' ? 5 : 4,
        })
      },
      now: () => 10_000,
    })
    const settings = settingsModule.createMinecraftPerceptionControlPeer({
      now: () => 10_000,
    })
    peers.push(owner)

    await expect(settings.request('start', true)).resolves.toMatchObject({ state: 'running', generation: 4 })
    settings.dispose()

    const reopenedSettings = settingsModule.createMinecraftPerceptionControlPeer({
      now: () => 10_000,
    })
    peers.push(reopenedSettings)

    await expect(reopenedSettings.request('pause', false)).resolves.toMatchObject({ state: 'paused', generation: 5 })
    expect(handledCommands).toEqual(['start', 'pause'])
  })
})
