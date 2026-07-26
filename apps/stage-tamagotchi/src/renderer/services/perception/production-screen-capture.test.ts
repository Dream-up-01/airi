import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'

import type { ProductionScreenCaptureBridge } from './production-screen-capture'

import { describe, expect, it, vi } from 'vitest'

import {
  isSensitiveScreenSourceName,
  ProductionScreenCapture,
} from './production-screen-capture'

function source(overrides: Partial<SerializableDesktopCapturerSource> = {}): SerializableDesktopCapturerSource {
  return {
    id: 'window:external',
    name: 'Editor',
    display_id: '',
    ownedByCurrentApp: false,
    ...overrides,
  }
}

function bridge(sources: SerializableDesktopCapturerSource[]) {
  return {
    getSources: vi.fn(async () => sources),
    selectWithSource: vi.fn(async (_select, use) => await use()),
  } as unknown as ProductionScreenCaptureBridge
}

function inertPlatform() {
  return {
    mediaDevices: { getDisplayMedia: vi.fn() } as unknown as Pick<MediaDevices, 'getDisplayMedia'>,
    document: { createElement: vi.fn() } as unknown as Pick<Document, 'createElement'>,
  }
}

describe('production screen capture', () => {
  it('enumerates no thumbnails and excludes AIRI-owned sources', async () => {
    const captureBridge = bridge([
      source({ id: 'screen:1', name: 'Screen 1' }),
      source({ id: 'window:airi', name: 'AIRI', ownedByCurrentApp: true }),
      source({ id: 'window:editor', name: 'Editor' }),
    ])
    const capture = new ProductionScreenCapture({ bridge: captureBridge, ...inertPlatform() })

    await expect(capture.listSources()).resolves.toEqual([
      { id: 'screen:1', name: 'Screen 1', kind: 'screen' },
      { id: 'window:editor', name: 'Editor', kind: 'window' },
    ])
    expect(captureBridge.getSources).toHaveBeenCalledWith(expect.objectContaining({
      fetchWindowIcons: false,
      thumbnailSize: { width: 0, height: 0 },
    }))
  })

  it('rejects an AIRI-owned source before opening getDisplayMedia', async () => {
    const captureBridge = bridge([source({ id: 'window:airi', name: 'AIRI', ownedByCurrentApp: true })])
    const capture = new ProductionScreenCapture({ bridge: captureBridge, ...inertPlatform() })

    await expect(capture.open('window:airi', new AbortController().signal)).rejects.toThrow('screen_capture_self_forbidden')
    expect(captureBridge.selectWithSource).not.toHaveBeenCalled()
  })

  it('creates an exact 1280x720 memory-only JPEG and zeroes it on release', async () => {
    const track = new FakeTrack()
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream
    const video = new FakeVideo()
    const canvases: FakeCanvas[] = []
    const document = {
      createElement(tag: string) {
        if (tag === 'video')
          return video
        const canvas = new FakeCanvas()
        canvases.push(canvas)
        return canvas
      },
    } as unknown as Pick<Document, 'createElement'>
    const captureBridge = bridge([source()])
    const capture = new ProductionScreenCapture({
      bridge: captureBridge,
      mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
      document,
      now: () => 1_000,
      monotonicNow: () => 10,
    })
    const handle = await capture.open('window:external', new AbortController().signal)
    expect(captureBridge.selectWithSource).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ request: { timeout: 15_000 } }),
    )
    capture.resetGate('window:external', 1)

    const result = await capture.captureFrame({
      frameId: 'frame:1',
      observationId: 'observation:1',
      sessionId: 'session:1',
      sourceId: 'window:external',
      generation: 1,
    })
    expect(result.accepted).toBe(true)
    expect(canvases[0]).toMatchObject({ width: 1280, height: 720 })
    if (!result.accepted)
      throw new Error('expected accepted frame')
    expect([...result.frame.jpegBytes]).toEqual([0xFF, 0xD8, 0xFF, 0xD9])
    result.frame.release('processed')
    expect([...result.frame.jpegBytes]).toEqual([0, 0, 0, 0])

    await handle.stop()
    expect(track.readyState).toBe('ended')
    expect(video.srcObject).toBeNull()
  })

  it('recognizes sensitive surfaces without retaining or exporting their title', () => {
    expect(isSensitiveScreenSourceName('Password Manager')).toBe(true)
    expect(isSensitiveScreenSourceName('银行支付页面')).toBe(true)
    expect(isSensitiveScreenSourceName('Code Editor')).toBe(false)
  })
})

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live'

  stop() {
    this.readyState = 'ended'
  }
}

class FakeVideo extends EventTarget {
  muted = false
  playsInline = false
  srcObject: MediaProvider | null = null
  readyState = 2
  videoWidth = 1920
  videoHeight = 1080

  async play() {}
  pause() {}
}

class FakeCanvas {
  width = 0
  height = 0

  getContext() {
    return {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(8 * 8 * 4).fill(128) }),
    }
  }

  toBlob(callback: BlobCallback) {
    callback(new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: 'image/jpeg' }))
  }
}
