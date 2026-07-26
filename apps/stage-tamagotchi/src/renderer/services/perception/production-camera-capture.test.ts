import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductionCameraCapture } from './production-camera-capture'

describe('production camera capture', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens one video-only stream, returns an ephemeral 640x360 frame and releases every resource', async () => {
    const fixture = createFixture()
    const capture = new ProductionCameraCapture({
      mediaDevices: fixture.mediaDevices,
      document: fixture.document,
      now: () => 1234,
    })

    const handle = await capture.open('camera:default', new AbortController().signal)
    expect(fixture.getUserMedia).toHaveBeenCalledWith({
      video: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 15, max: 30 },
      },
      audio: false,
    })

    const frame = capture.captureFrame()
    expect(frame).toMatchObject({ capturedAt: 1234, imageData: fixture.imageData, video: fixture.video })
    expect(fixture.context.drawImage).toHaveBeenCalledWith(fixture.video, 0, 0, 640, 360)

    handle.stop()
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(fixture.video.pause).toHaveBeenCalledOnce()
    expect(fixture.video.srcObject).toBeNull()
    expect(fixture.canvas).toMatchObject({ width: 1, height: 1 })
    expect(() => capture.captureFrame()).toThrow('camera-capture-not-running')
  })

  it('fails closed with a stable code when camera permission is denied', async () => {
    const fixture = createFixture()
    fixture.getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const capture = new ProductionCameraCapture({ mediaDevices: fixture.mediaDevices, document: fixture.document })

    await expect(capture.open('camera:default', new AbortController().signal)).rejects.toThrow('camera-permission-denied')
    expect(fixture.track.stop).not.toHaveBeenCalled()
  })

  it('propagates a physical track end once and makes future frames unavailable', async () => {
    const fixture = createFixture()
    const capture = new ProductionCameraCapture({ mediaDevices: fixture.mediaDevices, document: fixture.document })
    const handle = await capture.open('camera:default', new AbortController().signal)
    const onEnded = vi.fn()
    handle.onEnded(onEnded)

    fixture.track.readyState = 'ended'
    fixture.track.dispatchEvent(new Event('ended'))

    expect(onEnded).toHaveBeenCalledOnce()
    expect(fixture.track.stop).toHaveBeenCalledOnce()
    expect(() => capture.captureFrame()).toThrow('camera-capture-not-running')
  })
})

function createFixture() {
  const track = Object.assign(new EventTarget(), {
    readyState: 'live',
    stop: vi.fn(),
  })
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  const imageData = { data: new Uint8ClampedArray(4), width: 640, height: 360 } as ImageData
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => imageData),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement
  const video = Object.assign(new EventTarget(), {
    muted: false,
    playsInline: false,
    srcObject: null as MediaStream | null,
    readyState: 2,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  }) as unknown as HTMLVideoElement
  const document = {
    createElement: vi.fn((tag: string) => tag === 'video' ? video : canvas),
  }

  return {
    track,
    stream,
    getUserMedia,
    mediaDevices: { getUserMedia },
    imageData,
    context,
    canvas,
    video,
    document,
  }
}
