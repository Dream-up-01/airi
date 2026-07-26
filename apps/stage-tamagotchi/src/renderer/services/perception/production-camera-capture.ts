import type { ProductionScreenCaptureHandle } from '@proj-airi/stage-ui/services/perception'

const TARGET_WIDTH = 640
const TARGET_HEIGHT = 360

export interface ProductionCameraFrame {
  capturedAt: number
  imageData: ImageData
  video: HTMLVideoElement
}

export interface ProductionCameraCaptureOptions {
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>
  document?: {
    createElement: (tag: 'video' | 'canvas') => HTMLVideoElement | HTMLCanvasElement
  }
  now?: () => number
}

interface ActiveCameraCapture {
  sourceId: string
  stream: MediaStream
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  stopped: boolean
  endedListeners: Set<() => void>
  cleanupTrackListeners: Array<() => void>
}

/** Owns the only camera track and exposes only ephemeral working frames. */
export class ProductionCameraCapture {
  readonly #mediaDevices: Pick<MediaDevices, 'getUserMedia'>
  readonly #document: NonNullable<ProductionCameraCaptureOptions['document']>
  readonly #now: () => number
  #active?: ActiveCameraCapture

  constructor(options: ProductionCameraCaptureOptions = {}) {
    this.#mediaDevices = options.mediaDevices ?? navigator.mediaDevices
    this.#document = options.document ?? { createElement: tag => document.createElement(tag) }
    this.#now = options.now ?? Date.now
  }

  async open(sourceId: string, signal: AbortSignal): Promise<ProductionScreenCaptureHandle> {
    if (sourceId !== 'camera:default' || this.#active)
      throw new Error(this.#active ? 'camera-capture-busy' : 'camera-source-invalid')
    if (signal.aborted)
      throw new Error('camera-capture-start-cancelled')

    let stream: MediaStream
    try {
      stream = await this.#mediaDevices.getUserMedia({
        video: {
          width: { ideal: TARGET_WIDTH },
          height: { ideal: TARGET_HEIGHT },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      })
    }
    catch (error) {
      throw new Error(isPermissionError(error) ? 'camera-permission-denied' : 'camera-capture-start-failed')
    }
    if (signal.aborted || !hasLiveVideoTrack(stream)) {
      stopMediaStream(stream)
      throw new Error(signal.aborted ? 'camera-capture-start-cancelled' : 'camera-track-missing')
    }

    const video = this.#document.createElement('video') as HTMLVideoElement
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    try {
      await waitForVideo(video, signal)
    }
    catch (error) {
      video.srcObject = null
      stopMediaStream(stream)
      throw error
    }

    const canvas = this.#document.createElement('canvas') as HTMLCanvasElement
    canvas.width = TARGET_WIDTH
    canvas.height = TARGET_HEIGHT
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!context) {
      video.srcObject = null
      stopMediaStream(stream)
      throw new Error('camera-canvas-unavailable')
    }
    const active: ActiveCameraCapture = {
      sourceId,
      stream,
      video,
      canvas,
      context,
      stopped: false,
      endedListeners: new Set(),
      cleanupTrackListeners: [],
    }
    this.#active = active
    for (const track of stream.getTracks()) {
      const onEnded = () => this.#handleEnded(active)
      track.addEventListener('ended', onEnded, { once: true })
      active.cleanupTrackListeners.push(() => track.removeEventListener('ended', onEnded))
    }
    signal.addEventListener('abort', () => this.#stop(active), { once: true })

    return {
      sourceId,
      stop: () => this.#stop(active),
      onEnded: (listener) => {
        active.endedListeners.add(listener)
        return () => active.endedListeners.delete(listener)
      },
    }
  }

  captureFrame(): ProductionCameraFrame {
    const active = this.#active
    if (!active || active.stopped || !hasLiveVideoTrack(active.stream))
      throw new Error('camera-capture-not-running')
    active.context.drawImage(active.video, 0, 0, TARGET_WIDTH, TARGET_HEIGHT)
    return {
      capturedAt: this.#now(),
      imageData: active.context.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT),
      video: active.video,
    }
  }

  #handleEnded(active: ActiveCameraCapture): void {
    if (this.#active !== active || active.stopped)
      return
    const listeners = [...active.endedListeners]
    this.#stop(active)
    listeners.forEach(listener => listener())
  }

  #stop(active: ActiveCameraCapture): void {
    if (active.stopped)
      return
    active.stopped = true
    active.cleanupTrackListeners.forEach(cleanup => cleanup())
    active.cleanupTrackListeners.length = 0
    active.endedListeners.clear()
    active.video.pause()
    active.video.srcObject = null
    stopMediaStream(active.stream)
    active.canvas.width = 1
    active.canvas.height = 1
    if (this.#active === active)
      this.#active = undefined
  }
}

function hasLiveVideoTrack(stream: MediaStream): boolean {
  return stream.getVideoTracks().some(track => track.readyState === 'live')
}

function stopMediaStream(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop())
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)
}

async function waitForVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    throw new Error('camera-capture-start-cancelled')
  await video.play()
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
    return
  await new Promise<void>((resolve, reject) => {
    let onLoaded: () => void
    let onError: () => void
    let onAbort: () => void
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    onLoaded = () => {
      cleanup()
      resolve()
    }
    onError = () => {
      cleanup()
      reject(new Error('camera-video-unavailable'))
    }
    onAbort = () => {
      cleanup()
      reject(new Error('camera-capture-start-cancelled'))
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
