import type { OpenCvCameraMetrics } from '@proj-airi/stage-ui/services/perception'

import type { CameraOpenCvWorkerHandle, CameraOpenCvWorkerHandlers } from './camera-opencv-worker-client'

import { describe, expect, it, vi } from 'vitest'

import { CameraOpenCvWorkerClient } from './camera-opencv-worker-client'

describe('camera opencv worker client', () => {
  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  // A worker that raised `error` (OpenCV.js teardown, OOM while voice competes
  // for the same GPU/memory budget) reached #failAll(), which rejected every
  // pending request and reset #ready but kept this.#worker pointing at the dead
  // thread. #ensureReady() only looked at #ready, so the next captured frame
  // (~100ms later, LocalCameraPerceptionCoordinator's capture interval) ran
  // `this.#worker = new Worker(...)` and overwrote the reference without ever
  // calling terminate(). Every crash therefore left one more worker thread plus
  // its OpenCV.js WASM heap resident for the renderer process lifetime, so a
  // crash loop grew renderer memory and thread count monotonically.
  //
  // We fixed this by terminating the crashed worker and clearing #worker inside
  // #failAll(), before any replacement can be created.
  it('terminates a crashed worker before spawning its replacement', async () => {
    const fleet = createWorkerFleet()
    const client = new CameraOpenCvWorkerClient({ createWorker: fleet.createWorker })
    const controller = new AbortController()

    const crashed = client.analyze(createFrame(), 10, controller.signal)
    await settle()
    expect(fleet.workers).toHaveLength(1)
    expect(fleet.workers[0].requests.map(request => request.type)).toEqual(['init', 'analyze'])

    fleet.workers[0].crash()
    await expect(crashed).rejects.toThrow('camera-opencv-worker-failed')
    expect(fleet.workers[0].terminate).toHaveBeenCalledOnce()

    const retried = client.analyze(createFrame(), 20, controller.signal)
    await settle()
    expect(fleet.workers).toHaveLength(2)
    fleet.workers[1].respondWithMetrics(createMetrics(20))
    await expect(retried).resolves.toMatchObject({ observedAt: 20, meanLuminance: 120 })
    expect(fleet.workers[0].terminate).toHaveBeenCalledOnce()
    expect(fleet.workers[1].terminate).not.toHaveBeenCalled()
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  // analyze() awaited #ensureReady() and then dereferenced `this.#worker!`. When
  // dispose() (or the #failAll() teardown added above) landed inside that await,
  // #worker was already undefined and `this.#worker!.postMessage(...)` threw a
  // TypeError ("Cannot read properties of undefined (reading 'postMessage')")
  // instead of a stable camera-opencv-* code. The throw happened after the
  // request had been registered in #pending and after the abort listener had
  // been attached, so both stayed behind for the lifetime of the client.
  //
  // We fixed this by re-reading the worker after the await and failing with the
  // stable disposed/worker-failed code before any pending entry is created.
  it('fails an analyze whose worker is disposed mid-await with a stable code', async () => {
    const fleet = createWorkerFleet()
    const client = new CameraOpenCvWorkerClient({ createWorker: fleet.createWorker })
    const controller = new AbortController()

    const first = client.analyze(createFrame(), 10, controller.signal)
    await settle()
    fleet.workers[0].respondWithMetrics(createMetrics(10))
    await expect(first).resolves.toMatchObject({ observedAt: 10 })

    // analyze() suspends on #ensureReady() before it can post, so a dispose()
    // issued right after the call always wins the race.
    const raced = client.analyze(createFrame(), 20, controller.signal)
    client.dispose()

    await expect(raced).rejects.toThrow('camera-opencv-disposed')
    expect(fleet.workers).toHaveLength(1)
    expect(fleet.workers[0].requests.filter(request => request.type === 'analyze')).toHaveLength(1)
    expect(fleet.workers[0].terminate).toHaveBeenCalledOnce()
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  // dispose() cleared #ready, and #ensureReady() treated a missing #ready as
  // "not started yet". A late analyze() therefore spawned a brand new worker on
  // an already disposed client, and because LocalCameraPerceptionCoordinator
  // drops its reference to the client in the same teardown, nothing was left
  // that could ever terminate that thread.
  //
  // We fixed this by rejecting #ensureReady() once the client is disposed.
  it('never spawns a worker after dispose', async () => {
    const fleet = createWorkerFleet()
    const client = new CameraOpenCvWorkerClient({ createWorker: fleet.createWorker })
    const controller = new AbortController()

    const first = client.analyze(createFrame(), 10, controller.signal)
    await settle()
    fleet.workers[0].respondWithMetrics(createMetrics(10))
    await first
    client.dispose()

    const afterDispose = expect(client.analyze(createFrame(), 30, controller.signal))
      .rejects
      .toThrow('camera-opencv-disposed')
    await settle()
    expect(fleet.workers).toHaveLength(1)
    await afterDispose
  })
})

interface WorkerRequest {
  type: string
  requestId?: number
}

/**
 * Stands in for one real OpenCV worker thread: it records the requests the
 * client posts, answers the `init` handshake the way the shipped worker does,
 * and lets a test resolve or crash the thread on demand.
 */
function createFakeWorker(handlers: CameraOpenCvWorkerHandlers) {
  const requests: WorkerRequest[] = []
  const postMessage = vi.fn<CameraOpenCvWorkerHandle['postMessage']>((message) => {
    if (!isWorkerRequest(message))
      return
    requests.push(message)
    if (message.type === 'init')
      handlers.onMessage({ type: 'ready', requestId: message.requestId })
  })
  return {
    postMessage,
    terminate: vi.fn(),
    requests,
    respondWithMetrics: (metrics: OpenCvCameraMetrics) => {
      const analyzed = requests.filter(request => request.type === 'analyze').at(-1)
      handlers.onMessage({ type: 'result', requestId: analyzed?.requestId, metrics })
    },
    crash: () => handlers.onError(),
  }
}

function createWorkerFleet() {
  const workers: ReturnType<typeof createFakeWorker>[] = []
  return {
    workers,
    createWorker: (handlers: CameraOpenCvWorkerHandlers) => {
      const worker = createFakeWorker(handlers)
      workers.push(worker)
      return worker
    },
  }
}

function isWorkerRequest(message: unknown): message is WorkerRequest {
  if (typeof message !== 'object' || message === null || !('type' in message))
    return false
  return typeof message.type === 'string'
}

function createFrame(): ImageData {
  return { colorSpace: 'srgb', data: new Uint8ClampedArray(4), width: 1, height: 1 }
}

function createMetrics(observedAt: number): OpenCvCameraMetrics {
  return { observedAt, meanLuminance: 120, laplacianVariance: 50, motionRatio: 0.1, visiblePixelRatio: 1 }
}

/** Drains the microtasks the client awaits internally before it posts a request. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
