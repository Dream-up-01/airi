import type { MocapBackend, PerceptionPartial } from '@proj-airi/model-driver-mediapipe'
import type { PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'

import type { CameraCaptureRuntime, CameraOpenCvRuntime, CameraYoloRuntime } from './local-camera-perception-coordinator'

import { createInMemoryPerceptionOwnerProvider } from '@proj-airi/stage-ui/domains/perception'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalCameraPerceptionCoordinator } from './local-camera-perception-coordinator'

class TestImageData {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

describe('local camera perception coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T00:00:00Z'))
    vi.stubGlobal('ImageData', TestImageData)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('requires explicit consent and never opens the camera when denied', async () => {
    const capture = createCapture()
    const coordinator = createCoordinator(capture)
    expect((await coordinator.start(false)).lastErrorCode).toBe('permission-denied')
    expect(capture.open).not.toHaveBeenCalled()
  })

  it('runs all three analyzers, publishes bounded facts and releases resources on stop', async () => {
    const capture = createCapture()
    const projections: unknown[] = []
    const observability: PerceptionObservabilitySnapshot[] = []
    const coordinator = createCoordinator(capture, {
      onProjection: projection => projections.push(projection),
      onObservability: (snapshot) => {
        if (snapshot)
          observability.push(snapshot)
      },
    })

    expect((await coordinator.start(true)).state).toBe('running')
    await vi.advanceTimersByTimeAsync(1_200)

    expect(coordinator.status.analyzers).toEqual({ mediapipe: 'ready', opencv: 'ready', yolo: 'ready' })
    expect(coordinator.status.acceptedFactCount).toBeGreaterThan(0)
    expect(coordinator.status.observationCount).toBeGreaterThan(0)
    expect(projections.some(Boolean)).toBe(true)
    const acceptedFact = observability.at(-1)?.facts.find(fact => fact.state === 'accepted')
    expect(acceptedFact).toBeDefined()
    coordinator.confirmFact(acceptedFact!.factId)
    expect(observability.at(-1)?.facts.find(fact => fact.factId === acceptedFact!.factId)?.verification).toBe('user-confirmed')
    coordinator.retractFact(acceptedFact!.factId)
    expect(observability.at(-1)?.facts.find(fact => fact.factId === acceptedFact!.factId)?.state).toBe('revoked')

    const beforeStop = performance.now()
    await coordinator.stop()
    expect(performance.now() - beforeStop).toBeLessThan(500)
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(coordinator.status.state).toBe('idle')
    expect(projections.at(-1)).toBeNull()
  })

  it('replaces the scheduler timer when the target sampling rate changes', async () => {
    const capture = createCapture()
    const intervals: number[] = []
    let timerId = 0
    const clearInterval = vi.fn()
    const coordinator = createCoordinator(capture, {
      setInterval: (_callback, intervalMs) => {
        intervals.push(intervalMs)
        return ++timerId as unknown as ReturnType<typeof setInterval>
      },
      clearInterval,
    })

    await coordinator.start(true)
    const sessionBefore = coordinator.status.sessionId
    const generationBefore = coordinator.status.generation
    expect(coordinator.status.samplingRate).toBe(10)
    expect(intervals.at(-1)).toBe(100)

    coordinator.setSamplingRate(30)

    expect(coordinator.status.samplingRate).toBe(30)
    expect(coordinator.status.sessionId).toBe(sessionBefore)
    expect(coordinator.status.generation).toBe(generationBefore)
    expect(capture.open).toHaveBeenCalledOnce()
    expect(clearInterval).toHaveBeenCalledOnce()
    expect(intervals.at(-1)).toBe(34)
    await coordinator.stop()
    expect(clearInterval).toHaveBeenCalledTimes(2)
  })

  it('caps OpenCV admission at 10 frames per second when sampling is set to 30 Hz', async () => {
    const capture = createCapture()
    const openCvAnalyze = vi.fn(async (_imageData: ImageData, observedAt: number) => ({
      observedAt,
      meanLuminance: 120,
      laplacianVariance: 50,
      motionRatio: 0.1,
      visiblePixelRatio: 1,
    }))
    const coordinator = createCoordinator(capture, {
      createOpenCv: () => ({ analyze: openCvAnalyze, dispose: () => undefined }),
    })

    await coordinator.start(true)
    coordinator.setSamplingRate(30)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(openCvAnalyze.mock.calls.length).toBeLessThanOrEqual(10)
    await coordinator.stop()
  })

  it('keeps local camera running when YOLO WebGPU is unavailable and reports degradation', async () => {
    const capture = createCapture()
    const coordinator = createCoordinator(capture, {
      createYolo: () => ({
        analyze: async () => { throw new Error('camera-yolox-webgpu-unavailable') },
        dispose: async () => undefined,
      }),
    })
    await coordinator.start(true)
    await vi.advanceTimersByTimeAsync(800)

    expect(coordinator.status.state).toBe('running')
    expect(coordinator.status.analyzers.mediapipe).toBe('ready')
    expect(coordinator.status.analyzers.opencv).toBe('ready')
    expect(coordinator.status.analyzers.yolo).toBe('degraded')
    expect(coordinator.status.analyzerErrorCodes.yolo).toBe('camera-yolox-webgpu-unavailable')
    await coordinator.stop()
    expect(coordinator.status.analyzerErrorCodes).toEqual({})
    expect(coordinator.status.lastErrorCode).toBeUndefined()
  })

  it('keeps lightweight camera analyzers running while voice activity yields YOLO resources', async () => {
    const capture = createCapture()
    const yoloAnalyze = vi.fn(async () => ({
      analyzerId: 'yolox-nano:coco' as const,
      observedAt: Date.now(),
      objects: [],
    }))
    const coordinator = createCoordinator(capture, {
      isResourceConstrained: () => true,
      createYolo: () => ({ analyze: yoloAnalyze, dispose: async () => undefined }),
    })

    await coordinator.start(true)
    await vi.advanceTimersByTimeAsync(800)

    expect(yoloAnalyze).not.toHaveBeenCalled()
    expect(coordinator.status.analyzers.mediapipe).toBe('ready')
    expect(coordinator.status.analyzers.opencv).toBe('ready')
    expect(coordinator.status.analyzers.yolo).toBe('degraded')
    expect(coordinator.status.analyzerErrorCodes.yolo).toBe('voice-resource-priority')
    await coordinator.stop()
  })

  // The capture lifecycle becomes active before MediaPipe initialization
  // settles, so stop/pause must retire that scoped lifecycle without waiting
  // for a non-cancellable model initialization promise.
  it('releases the camera when stop() lands while MediaPipe is still initializing', async () => {
    const capture = createCapture()
    const initGate = createInitGate()
    const openCvDispose = vi.fn()
    const yoloDispose = vi.fn(async () => undefined)
    const coordinator = createCoordinator(capture, {
      createMediaPipe: () => ({ ...createMediaPipe(), init: () => initGate.wait() }),
      createOpenCv: () => ({ ...createOpenCv(), dispose: openCvDispose }),
      createYolo: () => ({ ...createYolo(), dispose: yoloDispose }),
    })

    const starting = coordinator.start(true)
    await initGate.entered
    expect(capture.open).toHaveBeenCalledOnce()
    expect(capture.stop).not.toHaveBeenCalled()

    const stopping = coordinator.stop()
    expect(coordinator.status.state).toBe('stopping')
    initGate.open()
    const stopped = await stopping
    await starting

    expect(stopped.state).toBe('idle')
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(openCvDispose).toHaveBeenCalledOnce()
    expect(yoloDispose).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    expect(capture.captureFrame).not.toHaveBeenCalled()
    expect(coordinator.status.state).toBe('idle')
  })

  it('releases the camera when pause() lands while MediaPipe is still initializing', async () => {
    const capture = createCapture()
    const initGate = createInitGate()
    const coordinator = createCoordinator(capture, {
      createMediaPipe: () => ({ ...createMediaPipe(), init: () => initGate.wait() }),
    })

    const starting = coordinator.start(true)
    await initGate.entered

    const pausing = coordinator.pause()
    initGate.open()
    const paused = await pausing
    await starting

    expect(paused.state).toBe('paused')
    expect(capture.stop).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    expect(capture.captureFrame).not.toHaveBeenCalled()
    expect(coordinator.status.state).toBe('paused')
  })

  it('stops promptly and starts a replacement while old MediaPipe initialization remains pending', async () => {
    const initGate = createInitGate()
    const firstMediaPipeDispose = vi.fn(async () => undefined)
    const handleStops: Array<ReturnType<typeof vi.fn>> = []
    const capture: CameraCaptureRuntime = {
      open: vi.fn(async (sourceId) => {
        const stop = vi.fn()
        handleStops.push(stop)
        return { sourceId, stop, onEnded: () => () => undefined }
      }),
      captureFrame: vi.fn(() => ({
        capturedAt: Date.now(),
        imageData: new TestImageData(new Uint8ClampedArray(640 * 360 * 4), 640, 360) as unknown as ImageData,
        video: {} as HTMLVideoElement,
      })),
    }
    let mediaPipeCount = 0
    const coordinator = createCoordinator(capture, {
      createMediaPipe: () => {
        mediaPipeCount += 1
        return mediaPipeCount === 1
          ? { ...createMediaPipe(), init: () => initGate.wait(), dispose: firstMediaPipeDispose }
          : createMediaPipe()
      },
    })

    const firstStart = coordinator.start(true, 'mixed')
    await vi.waitFor(() => {
      expect(capture.open).toHaveBeenCalledOnce()
      expect(mediaPipeCount).toBe(1)
    })
    await initGate.entered

    const beforeStop = performance.now()
    const stopped = await coordinator.stop()
    const stopLatencyMs = performance.now() - beforeStop
    const firstStartStatus = await firstStart
    const replacement = await coordinator.start(true, 'mixed')

    expect(stopLatencyMs).toBeLessThan(500)
    expect(stopped.state).toBe('idle')
    expect(firstStartStatus.state).toBe('stopping')
    expect(replacement).toMatchObject({ state: 'running', processingMode: 'mixed' })
    expect(handleStops).toHaveLength(2)
    expect(handleStops[0]).toHaveBeenCalledOnce()
    expect(handleStops[1]).not.toHaveBeenCalled()

    const replacementSessionId = replacement.sessionId
    initGate.open()
    await vi.waitFor(() => expect(firstMediaPipeDispose).toHaveBeenCalled())

    expect(coordinator.status).toMatchObject({ state: 'running', sessionId: replacementSessionId, processingMode: 'mixed' })
    expect(handleStops[1]).not.toHaveBeenCalled()
    await coordinator.stop()
    expect(handleStops[1]).toHaveBeenCalledOnce()
  })

  it('detaches an aborted mixed start and keeps its late MediaPipe result away from the replacement', async () => {
    const capture = createCapture()
    const initGate = createInitGate()
    const firstMediaPipeDispose = vi.fn(async () => undefined)
    let mediaPipeCount = 0
    const coordinator = createCoordinator(capture, {
      createMediaPipe: () => {
        mediaPipeCount += 1
        return mediaPipeCount === 1
          ? { ...createMediaPipe(), init: () => initGate.wait(), dispose: firstMediaPipeDispose }
          : createMediaPipe()
      },
    })
    const controller = new AbortController()
    const firstStart = coordinator.start(true, 'mixed', controller.signal)
    await initGate.entered

    const beforeAbort = performance.now()
    controller.abort('cloud-stop')
    const cancelled = await firstStart
    const abortLatencyMs = performance.now() - beforeAbort
    const replacement = await coordinator.start(true, 'mixed')

    expect(abortLatencyMs).toBeLessThan(500)
    expect(cancelled.state).toBe('stopping')
    expect(replacement).toMatchObject({ state: 'running', processingMode: 'mixed' })
    expect(capture.open).toHaveBeenCalledTimes(2)
    expect(capture.stop).toHaveBeenCalledOnce()

    const replacementSessionId = replacement.sessionId
    initGate.open()
    await vi.waitFor(() => expect(firstMediaPipeDispose).toHaveBeenCalled())

    expect(coordinator.status).toMatchObject({ state: 'running', sessionId: replacementSessionId, processingMode: 'mixed' })
    expect(capture.stop).toHaveBeenCalledOnce()
    await coordinator.stop()
    expect(capture.stop).toHaveBeenCalledTimes(2)
  })

  it('atomically revokes facts and prevents disposed analyzer callbacks from changing paused state', async () => {
    const capture = createCapture()
    const snapshots: Array<{ acceptedFactIds: string[] }> = []
    const coordinator = createCoordinator(capture, {
      onSnapshot: snapshot => snapshots.push(snapshot),
    })

    await coordinator.start(true)
    await vi.advanceTimersByTimeAsync(800)
    expect(coordinator.status.acceptedFactCount).toBeGreaterThan(0)

    await coordinator.pause()
    await vi.runAllTicks()

    expect(coordinator.status.state).toBe('paused')
    expect(coordinator.status.acceptedFactCount).toBe(0)
    expect(coordinator.status.analyzers).toEqual({ mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' })
    expect(snapshots.at(-1)?.acceptedFactIds).toEqual([])
  })

  it('attempts every active cleanup and retracts published state when individual cleanups fail', async () => {
    const capture = createCapture()
    const clearInterval = vi.fn(() => {
      throw new Error('timer-cleanup-failed')
    })
    const mediaPipeDispose = vi.fn(async () => {
      throw new Error('mediapipe-cleanup-failed')
    })
    const openCvDispose = vi.fn(() => {
      throw new Error('opencv-cleanup-failed')
    })
    const yoloDispose = vi.fn(async () => {
      throw new Error('yolo-cleanup-failed')
    })
    const snapshots: Array<{ acceptedFactIds: string[] }> = []
    const observability: Array<PerceptionObservabilitySnapshot | null> = []
    const projections: unknown[] = []
    const coordinator = createCoordinator(capture, {
      clearInterval,
      createMediaPipe: () => ({ ...createMediaPipe(), dispose: mediaPipeDispose }),
      createOpenCv: () => ({ ...createOpenCv(), dispose: openCvDispose }),
      createYolo: () => ({ ...createYolo(), dispose: yoloDispose }),
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot)
        if (snapshot.acceptedFactIds.length === 0)
          throw new Error('snapshot-cleanup-failed')
      },
      onObservability: snapshot => observability.push(snapshot),
      onProjection: projection => projections.push(projection),
    })

    await coordinator.start(true)
    await vi.advanceTimersByTimeAsync(800)
    expect(coordinator.status.acceptedFactCount).toBeGreaterThan(0)

    await expect(coordinator.stop()).resolves.toMatchObject({ state: 'idle', acceptedFactCount: 0 })

    expect(clearInterval).toHaveBeenCalledOnce()
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(mediaPipeDispose).toHaveBeenCalledOnce()
    expect(openCvDispose).toHaveBeenCalledOnce()
    expect(yoloDispose).toHaveBeenCalledOnce()
    expect(snapshots.at(-1)?.acceptedFactIds).toEqual([])
    expect(observability.at(-1)).toBeNull()
    expect(projections.at(-1)).toBeNull()
  })
})

function createCoordinator(
  capture: CameraCaptureRuntime,
  overrides: Partial<ConstructorParameters<typeof LocalCameraPerceptionCoordinator>[0]> = {},
) {
  let sequence = 0
  return new LocalCameraPerceptionCoordinator({
    capture,
    ownerProvider: createInMemoryPerceptionOwnerProvider(),
    now: Date.now,
    id: prefix => `${prefix}:test-${++sequence}`,
    createMediaPipe: () => createMediaPipe(),
    createOpenCv: () => createOpenCv(),
    createYolo: () => createYolo(),
    ...overrides,
  })
}

function createCapture() {
  let running = false
  const stop = vi.fn(() => {
    running = false
  })
  const open = vi.fn<CameraCaptureRuntime['open']>(async (sourceId) => {
    running = true
    return { sourceId, stop, onEnded: () => () => undefined }
  })
  return {
    open,
    stop,
    captureFrame: vi.fn(() => {
      if (!running)
        throw new Error('camera-capture-not-running')
      return {
        capturedAt: Date.now(),
        imageData: new TestImageData(new Uint8ClampedArray(640 * 360 * 4), 640, 360) as unknown as ImageData,
        video: {} as HTMLVideoElement,
      }
    }),
  }
}

/** Holds `mediaPipe.init()` open so a test can act inside the start window. */
function createInitGate() {
  let release = () => undefined as void
  let markEntered = () => undefined as void
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  return {
    entered,
    open: () => release(),
    wait: async () => {
      markEntered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
    },
  }
}

function createMediaPipe(): MocapBackend {
  return {
    init: async () => undefined,
    isBusy: () => false,
    run: async () => createPoseResult(),
    dispose: async () => undefined,
  }
}

function createPoseResult(): PerceptionPartial {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))
  landmarks[0].y = 0.2
  landmarks[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1 }
  landmarks[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1 }
  landmarks[23] = { x: 0.45, y: 0.7, z: 0, visibility: 1 }
  landmarks[24] = { x: 0.55, y: 0.7, z: 0, visibility: 1 }
  return { pose: { landmarks2d: landmarks } }
}

function createOpenCv(): CameraOpenCvRuntime {
  return {
    analyze: async (_imageData, observedAt) => ({
      observedAt,
      meanLuminance: 120,
      laplacianVariance: 50,
      motionRatio: 0.1,
      visiblePixelRatio: 1,
    }),
    dispose: () => undefined,
  }
}

function createYolo(): CameraYoloRuntime {
  return {
    analyze: async (_imageData, observedAt) => ({
      analyzerId: 'yolox-nano:coco',
      observedAt,
      personCount: { value: 1, confidence: 0.9 },
      objects: [{ label: 'laptop', confidence: 0.85 }],
    }),
    dispose: async () => undefined,
  }
}
