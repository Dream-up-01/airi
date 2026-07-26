import { describe, expect, it, vi } from 'vitest'

import { CloudPerceptionWindowController } from './cloud-perception-window-controller'

function lease(refId: string) {
  return { refId, release: vi.fn() }
}

describe('cloud perception window controller', () => {
  it('cancels the active window and releases audio/JPEG references when echo starts', () => {
    const controller = new CloudPerceptionWindowController()
    const audio = lease('audio:1')
    const image = lease('image:1')
    const signal = controller.start({
      windowId: 'window:1',
      sessionId: 'session:1',
      generation: 2,
      audioLeases: [audio],
      imageLeases: [image],
    })

    expect(signal.aborted).toBe(false)
    expect(controller.cancelForEcho()).toBe(true)
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe('echo-blocked')
    expect(audio.release).toHaveBeenCalledOnce()
    expect(audio.release).toHaveBeenCalledWith('echo-blocked')
    expect(image.release).toHaveBeenCalledWith('echo-blocked')
    expect(controller.status).toMatchObject({ state: 'cancelled', cancelReason: 'echo-blocked', audioRefCount: 0, imageRefCount: 0 })
    expect(controller.cancelForEcho()).toBe(false)
  })

  it('replaces an old generation and ignores a stale completion', () => {
    const controller = new CloudPerceptionWindowController()
    const oldLease = lease('image:old')
    controller.start({
      windowId: 'window:old',
      sessionId: 'session:1',
      generation: 1,
      audioLeases: [],
      imageLeases: [oldLease],
    })
    controller.start({
      windowId: 'window:new',
      sessionId: 'session:1',
      generation: 2,
      audioLeases: [],
      imageLeases: [],
    })

    expect(oldLease.release).toHaveBeenCalledWith('generation-stale')
    expect(controller.complete('window:old', 1)).toBe(false)
    expect(controller.status).toMatchObject({ state: 'active', windowId: 'window:new', generation: 2 })
    expect(controller.complete('window:new', 2)).toBe(true)
    expect(controller.status).toMatchObject({ state: 'completed', audioRefCount: 0, imageRefCount: 0 })
  })
})
