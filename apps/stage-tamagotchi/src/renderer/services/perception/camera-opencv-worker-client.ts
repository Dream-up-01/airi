import type { OpenCvCameraMetrics } from '@proj-airi/stage-ui/services/perception'

interface PendingRequest {
  resolve: (metrics: OpenCvCameraMetrics) => void
  reject: (error: Error) => void
  removeAbort?: () => void
}

/** Callbacks the client wires into one worker thread when it is created. */
export interface CameraOpenCvWorkerHandlers {
  /** Receives every structured message the worker posts back. */
  onMessage: (data: unknown) => void
  /** Fires when the thread itself fails (OpenCV.js teardown, OOM, WebGPU loss). */
  onError: () => void
}

/** The only control the client keeps over a worker thread it owns. */
export interface CameraOpenCvWorkerHandle {
  /** Posts one request, optionally transferring frame buffers instead of copying them. */
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  /** Kills the thread together with the OpenCV.js heap it holds. */
  terminate: () => void
}

export interface CameraOpenCvWorkerClientOptions {
  /**
   * Spawns the analysis worker and wires its message/error listeners.
   *
   * @default spawns `assets/perception/camera-local/opencv-camera-worker.js` as a real `Worker`
   */
  createWorker?: (handlers: CameraOpenCvWorkerHandlers) => CameraOpenCvWorkerHandle
}

/**
 * Owns at most one OpenCV analysis worker and maps frames to metrics.
 *
 * Use when:
 * - Camera perception needs per-frame OpenCV metrics off the renderer thread
 *
 * Expects:
 * - Every `analyze` caller passes a signal it aborts once it stops caring
 * - The client is disposed once per instance; a disposed client is not reused
 *
 * Returns:
 * - Metrics for the analyzed frame, or a stable error code
 *   (`camera-opencv-cancelled`, `camera-opencv-disposed`, `camera-opencv-worker-failed`)
 */
export class CameraOpenCvWorkerClient {
  readonly #createWorker: (handlers: CameraOpenCvWorkerHandlers) => CameraOpenCvWorkerHandle
  #worker?: CameraOpenCvWorkerHandle
  #ready?: Promise<void>
  #disposed = false
  #requestSequence = 0
  readonly #pending = new Map<number, PendingRequest>()

  constructor(options: CameraOpenCvWorkerClientOptions = {}) {
    this.#createWorker = options.createWorker ?? createOpenCvWorker
  }

  async analyze(imageData: ImageData, observedAt: number, signal: AbortSignal): Promise<OpenCvCameraMetrics> {
    await this.#ensureReady()
    if (signal.aborted)
      throw new Error('camera-opencv-cancelled')
    // dispose() or a worker crash can land while #ensureReady() above is
    // awaited, so the worker this call was going to use may already be gone.
    // Re-read it and fail with a stable code instead of dereferencing it: a
    // missing worker used to surface as a TypeError and left this request's
    // pending entry plus its abort listener behind forever.
    const worker = this.#worker
    if (!worker)
      throw new Error(this.#disposed ? 'camera-opencv-disposed' : 'camera-opencv-worker-failed')
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
      worker.postMessage({ type: 'analyze', requestId, observedAt, imageData }, [imageData.data.buffer])
    })
  }

  dispose(): void {
    this.#disposed = true
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
    // Spawning after dispose() would create a thread nobody owns anymore: the
    // coordinator drops its reference to this client as soon as it disposes it.
    if (this.#disposed)
      throw new Error('camera-opencv-disposed')
    if (this.#ready)
      return await this.#ready
    const worker = this.#createWorker({
      onMessage: data => this.#handleMessage(data),
      onError: () => this.#failAll('camera-opencv-worker-failed'),
    })
    this.#worker = worker
    const requestId = ++this.#requestSequence
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#pending.set(requestId, {
        resolve: () => resolve(),
        reject,
      })
      worker.postMessage({ type: 'init', requestId })
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
    // The thread raised `error`: its OpenCV.js heap is unusable and no further
    // message will ever arrive. Terminate it here, because #ensureReady() only
    // tracks #ready — leaving #worker set would make the next frame (~100ms
    // later) overwrite the reference with a fresh thread and keep the crashed
    // one, plus its WASM heap, resident for the renderer process lifetime.
    this.#worker?.terminate()
    this.#worker = undefined
    this.#ready = undefined
    for (const request of this.#pending.values()) {
      request.removeAbort?.()
      request.reject(new Error(code))
    }
    this.#pending.clear()
  }
}

function createOpenCvWorker(handlers: CameraOpenCvWorkerHandlers): CameraOpenCvWorkerHandle {
  const workerUrl = new URL('assets/perception/camera-local/opencv-camera-worker.js', document.baseURI)
  const worker = new Worker(workerUrl, { name: 'airi-camera-opencv' })
  worker.addEventListener('message', event => handlers.onMessage(event.data))
  worker.addEventListener('error', () => handlers.onError())
  return {
    postMessage: (message, transfer) => transfer ? worker.postMessage(message, transfer) : worker.postMessage(message),
    terminate: () => worker.terminate(),
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
