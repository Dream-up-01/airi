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
})

function createCoordinator(
  capture: ReturnType<typeof createCapture>,
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
