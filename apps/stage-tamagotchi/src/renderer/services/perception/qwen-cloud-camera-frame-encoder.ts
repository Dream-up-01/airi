import type { ProductionCameraFrame } from './production-camera-capture'
import type { QwenCloudFrameCandidate } from './qwen-cloud-window-runner'

import { CameraCloudFrameGate } from '@proj-airi/stage-ui/services/perception'

export interface QwenCloudCameraFrameEncoderOptions {
  generation: number
  getPersonPresent: () => boolean
  getBusy: () => boolean
  getPrivacyMode: () => boolean
  onFrame: (frame: QwenCloudFrameCandidate) => void
  onError?: (errorCode: string) => void
  document?: Pick<Document, 'createElement' | 'visibilityState'>
  monotonicNow?: () => number
  id?: (prefix: string) => string
}

interface PendingFrame {
  capturedAt: number
  imageData: ImageData
  signature: Uint8Array
}

/** Single encoder with one latest slot; only changed, admitted frames become JPEGs. */
export class QwenCloudCameraFrameEncoder {
  readonly #generation: number
  readonly #getPersonPresent: () => boolean
  readonly #getBusy: () => boolean
  readonly #getPrivacyMode: () => boolean
  readonly #onFrame: (frame: QwenCloudFrameCandidate) => void
  readonly #onError?: (errorCode: string) => void
  readonly #document: NonNullable<QwenCloudCameraFrameEncoderOptions['document']>
  readonly #monotonicNow: () => number
  readonly #id: (prefix: string) => string
  readonly #gate: CameraCloudFrameGate
  #lastSignature?: Uint8Array
  #pending?: PendingFrame
  #processing = false
  #stopped = false

  constructor(options: QwenCloudCameraFrameEncoderOptions) {
    this.#generation = options.generation
    this.#getPersonPresent = options.getPersonPresent
    this.#getBusy = options.getBusy
    this.#getPrivacyMode = options.getPrivacyMode
    this.#onFrame = options.onFrame
    this.#onError = options.onError
    this.#document = options.document ?? document
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#id = options.id ?? (prefix => `${prefix}:camera-cloud:${crypto.randomUUID()}`)
    this.#gate = new CameraCloudFrameGate({ generation: options.generation, resolution: '640x360', fpsMax: 1 })
  }

  offer(frame: ProductionCameraFrame): void {
    if (this.#stopped || this.#getPrivacyMode() || this.#document.visibilityState !== 'visible' || !this.#getPersonPresent())
      return
    const signature = createSignature(frame.imageData)
    if (this.#lastSignature && signatureDifference(this.#lastSignature, signature) < 0.08)
      return
    this.#lastSignature = signature
    releasePending(this.#pending)
    this.#pending = {
      capturedAt: frame.capturedAt,
      imageData: new ImageData(new Uint8ClampedArray(frame.imageData.data), frame.imageData.width, frame.imageData.height),
      signature,
    }
    void this.#drain()
  }

  stop(): void {
    this.#stopped = true
    releasePending(this.#pending)
    this.#pending = undefined
    this.#lastSignature?.fill(0)
    this.#lastSignature = undefined
  }

  async #drain(): Promise<void> {
    if (this.#processing)
      return
    this.#processing = true
    try {
      while (!this.#stopped && this.#pending) {
        const frame = this.#pending
        this.#pending = undefined
        let jpeg: Uint8Array | undefined
        let transferred = false
        try {
          jpeg = await encodeJpeg(frame.imageData, this.#document)
          if (this.#stopped) {
            jpeg.fill(0)
            continue
          }
          let released = false
          const candidate = {
            frameId: this.#id('frame'),
            generation: this.#generation,
            capturedAt: frame.capturedAt,
            monotonicTimestamp: this.#monotonicNow(),
            width: 640,
            height: 360,
            jpegBytes: jpeg,
            significantVisualChange: true,
            personPresent: this.#getPersonPresent(),
            foreground: this.#document.visibilityState === 'visible',
            privacyMode: this.#getPrivacyMode(),
            busy: this.#getBusy(),
            release: () => {
              if (!released) {
                released = true
                jpeg?.fill(0)
              }
            },
          }
          const decision = this.#gate.evaluate(candidate)
          if (!decision.accepted)
            continue
          this.#onFrame({
            frameId: candidate.frameId,
            observationId: this.#id('observation'),
            capturedAt: candidate.capturedAt,
            monotonicTimestamp: candidate.monotonicTimestamp,
            width: candidate.width,
            height: candidate.height,
            jpeg,
            release: () => candidate.release(),
          })
          transferred = true
        }
        catch {
          if (!transferred)
            jpeg?.fill(0)
          this.stop()
          this.#onError?.('cloud-camera-encode-failed')
          return
        }
        finally {
          frame.imageData.data.fill(0)
          frame.signature.fill(0)
        }
      }
    }
    finally {
      this.#processing = false
    }
  }
}

function releasePending(frame?: PendingFrame): void {
  frame?.imageData.data.fill(0)
  frame?.signature.fill(0)
}

function createSignature(imageData: ImageData): Uint8Array {
  const signature = new Uint8Array(64)
  const stepX = Math.max(1, Math.floor(imageData.width / 8))
  const stepY = Math.max(1, Math.floor(imageData.height / 8))
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const index = ((y * stepY) * imageData.width + x * stepX) * 4
      signature[y * 8 + x] = Math.round(((imageData.data[index] ?? 0) + (imageData.data[index + 1] ?? 0) + (imageData.data[index + 2] ?? 0)) / 3)
    }
  }
  return signature
}

function signatureDifference(left: Uint8Array, right: Uint8Array): number {
  let difference = 0
  for (let index = 0; index < left.length; index++)
    difference += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  return difference / (left.length * 255)
}

async function encodeJpeg(imageData: ImageData, documentRef: NonNullable<QwenCloudCameraFrameEncoderOptions['document']>): Promise<Uint8Array> {
  const canvas = documentRef.createElement('canvas') as HTMLCanvasElement
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d', { alpha: false })
  if (!context)
    throw new Error('cloud-camera-canvas-unavailable')
  context.putImageData(imageData, 0, 0)
  for (const quality of [0.82, 0.7, 0.58, 0.46]) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('cloud-camera-encode-failed')), 'image/jpeg', quality))
    if (blob.size <= 190 * 1024)
      return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error('cloud-camera-frame-too-large')
}
