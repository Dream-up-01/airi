import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { QwenCloudCameraFrameEncoder } from './qwen-cloud-camera-frame-encoder'

const imageDataInstances: Array<{ data: Uint8ClampedArray }> = []

beforeAll(() => {
  vi.stubGlobal('ImageData', class {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number

    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
      imageDataInstances.push(this)
    }
  })
})

beforeEach(() => imageDataInstances.splice(0))
afterAll(() => vi.unstubAllGlobals())

describe('qwenCloudCameraFrameEncoder', () => {
  it('drops and zeroes a frame when stop wins the encode race', async () => {
    const harness = createCanvasHarness()
    const onFrame = vi.fn()
    const frame = cameraFrame()
    const encoder = new QwenCloudCameraFrameEncoder({
      generation: 1,
      getPersonPresent: () => true,
      getBusy: () => false,
      getPrivacyMode: () => false,
      onFrame,
      document: harness.document,
      monotonicNow: () => 1_000,
      id: prefix => `${prefix}:test`,
    })

    encoder.offer(frame)
    await vi.waitFor(() => expect(harness.complete).toBeTypeOf('function'))
    encoder.stop()
    harness.complete!(new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: 'image/jpeg' }))

    await vi.waitFor(() => expect([...imageDataInstances.at(-1)!.data].every(value => value === 0)).toBe(true))
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('reports a stable error and zeroes pixels when encoding fails', async () => {
    const harness = createCanvasHarness()
    const onError = vi.fn()
    const frame = cameraFrame()
    const encoder = new QwenCloudCameraFrameEncoder({
      generation: 1,
      getPersonPresent: () => true,
      getBusy: () => false,
      getPrivacyMode: () => false,
      onFrame: vi.fn(),
      onError,
      document: harness.document,
      monotonicNow: () => 1_000,
      id: prefix => `${prefix}:test`,
    })

    encoder.offer(frame)
    await vi.waitFor(() => expect(harness.complete).toBeTypeOf('function'))
    harness.complete!(null)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('cloud-camera-encode-failed'))
    expect([...imageDataInstances.at(-1)!.data].every(value => value === 0)).toBe(true)
  })
})

function cameraFrame() {
  return {
    capturedAt: 1_000,
    imageData: new ImageData(new Uint8ClampedArray(640 * 360 * 4).fill(80), 640, 360),
    video: {} as HTMLVideoElement,
  }
}

function createCanvasHarness() {
  const harness: {
    complete?: BlobCallback
    document: Pick<Document, 'createElement' | 'visibilityState'>
  } = {
    document: {
      visibilityState: 'visible',
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ putImageData: vi.fn() }),
        toBlob: (callback: BlobCallback) => harness.complete = callback,
      }) as unknown as HTMLCanvasElement,
    } as unknown as Pick<Document, 'createElement' | 'visibilityState'>,
  }
  return harness
}
