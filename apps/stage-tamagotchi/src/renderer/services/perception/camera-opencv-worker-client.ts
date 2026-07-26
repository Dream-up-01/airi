import type { OpenCvCameraMetrics } from '@proj-airi/stage-ui/services/perception'

interface PendingRequest {
  resolve: (metrics: OpenCvCameraMetrics) => void
  reject: (error: Error) => void
  removeAbort?: () => void
}

export class CameraOpenCvWorkerClient {
  #worker?: Worker
  #ready?: Promise<void>
  #requestSequence = 0
  readonly #pending = new Map<number, PendingRequest>()

  async analyze(imageData: ImageData, observedAt: number, signal: AbortSignal): Promise<OpenCvCameraMetrics> {
    await this.#ensureReady()
    if (signal.aborted)
      throw new Error('camera-opencv-cancelled')
    const requestId = ++this.#requestSequence
    return await new Promise<OpenCvCameraMetrics>((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(requestId)
        reject(new Error('camera-opencv-cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.#pending.set(requestId, {
        resolve,
        reject,
        removeAbort: () => signal.removeEventListener('abort', onAbort),
      })
      this.#worker!.postMessage({ type: 'analyze', requestId, observedAt, imageData }, [imageData.data.buffer])
    })
  }

  dispose(): void {
    this.#worker?.postMessage({ type: 'dispose' })
    this.#worker?.terminate()
    this.#worker = undefined
    this.#ready = undefined
    for (const request of this.#pending.values()) {
      request.removeAbort?.()
      request.reject(new Error('camera-opencv-disposed'))
    }
    this.#pending.clear()
  }

  async #ensureReady(): Promise<void> {
    if (this.#ready)
      return await this.#ready
    const workerUrl = new URL('assets/perception/camera-local/opencv-camera-worker.js', document.baseURI)
    this.#worker = new Worker(workerUrl, { name: 'airi-camera-opencv' })
    this.#worker.addEventListener('message', event => this.#handleMessage(event.data))
    this.#worker.addEventListener('error', () => this.#failAll('camera-opencv-worker-failed'))
    const requestId = ++this.#requestSequence
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: () => resolve(),
        reject,
      })
      this.#worker!.postMessage({ type: 'init', requestId })
    })
    return await this.#ready
  }

  #handleMessage(message: unknown): void {
    if (!isRecord(message) || typeof message.requestId !== 'number')
      return
    const request = this.#pending.get(message.requestId)
    if (!request)
      return
    this.#pending.delete(message.requestId)
    request.removeAbort?.()
    if (message.type === 'ready') {
      request.resolve({ observedAt: 0, meanLuminance: 0, laplacianVariance: 0, motionRatio: 0, visiblePixelRatio: 0 })
      return
    }
    if (message.type === 'result' && isMetrics(message.metrics)) {
      request.resolve(message.metrics)
      return
    }
    request.reject(new Error(typeof message.errorCode === 'string' ? message.errorCode : 'camera-opencv-worker-failed'))
  }

  #failAll(code: string): void {
    for (const request of this.#pending.values()) {
      request.removeAbort?.()
      request.reject(new Error(code))
    }
    this.#pending.clear()
    this.#ready = undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMetrics(value: unknown): value is OpenCvCameraMetrics {
  return isRecord(value)
    && ['observedAt', 'meanLuminance', 'laplacianVariance', 'motionRatio', 'visiblePixelRatio']
      .every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
}
