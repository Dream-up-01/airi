import type { LocalCameraPerceptionStatus } from './local-camera-perception-coordinator'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createGenerationScopedLocalCameraLease, QwenCloudCameraCoordinator } from './qwen-cloud-camera-coordinator'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function settlesWithinMicrotasks(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  void promise.then(
    () => { settled = true },
    () => { settled = true },
  )
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
    if (settled)
      break
  }
  return settled
}

const qwenMocks = vi.hoisted(() => ({
  encoderCreate: vi.fn(),
  encoderStop: vi.fn(),
  pcmStart: vi.fn(),
  pcmStop: vi.fn(),
  runnerCreate: vi.fn(),
  runnerStart: vi.fn(),
  runnerStop: vi.fn(),
}))

vi.mock('./qwen-cloud-pcm-capture', () => ({
  QwenCloudPcmCapture: class {
    async start(stream: MediaStream): Promise<void> {
      await qwenMocks.pcmStart(stream)
    }

    async stop(): Promise<void> {
      await qwenMocks.pcmStop()
    }
  },
}))

vi.mock('./qwen-cloud-window-runner', () => ({
  QwenCloudWindowRunner: class {
    status = { state: 'running', uploadActive: false, completedWindows: 0, submittedWindows: 0, acceptedFactCount: 0 }
    constructor(options: unknown) {
      qwenMocks.runnerCreate(options)
    }

    start(input: unknown): void {
      qwenMocks.runnerStart(input)
    }

    offerAudio(): void {}
    offerFrame(): void {}

    async stop(reason: string): Promise<void> {
      await qwenMocks.runnerStop(reason)
    }

    blockForEcho(): void {}
  },
}))

vi.mock('./qwen-cloud-camera-frame-encoder', () => ({
  QwenCloudCameraFrameEncoder: class {
    constructor(options: unknown) {
      qwenMocks.encoderCreate(options)
    }

    offer(): void {}
    stop(): void {
      qwenMocks.encoderStop()
    }
  },
}))

describe('qwen cloud camera coordinator', () => {
  beforeEach(() => {
    qwenMocks.encoderCreate.mockReset()
    qwenMocks.encoderStop.mockReset()
    qwenMocks.pcmStart.mockReset().mockResolvedValue(undefined)
    qwenMocks.pcmStop.mockReset().mockResolvedValue(undefined)
    qwenMocks.runnerCreate.mockReset()
    qwenMocks.runnerStart.mockReset()
    qwenMocks.runnerStop.mockReset().mockResolvedValue(undefined)
  })

  it('releases a local camera generation at most once and never stops a replacement', async () => {
    let localStatus: LocalCameraPerceptionStatus = { state: 'running', generation: 8, sessionId: 'session:new', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }
    const stop = vi.fn(async () => undefined)
    const oldLease = createGenerationScopedLocalCameraLease({
      sessionId: 'session:old',
      generation: 7,
      getStatus: () => localStatus,
      stop,
    })

    await oldLease.release()
    await oldLease.release()
    expect(stop).not.toHaveBeenCalled()

    const currentLease = createGenerationScopedLocalCameraLease({
      sessionId: 'session:new',
      generation: 8,
      getStatus: () => localStatus,
      stop,
    })
    await currentLease.release()
    localStatus = { ...localStatus, generation: 9 }
    await currentLease.release()

    expect(stop).toHaveBeenCalledOnce()
  })

  it('keeps cloud generation monotonic while reusing the same local mixed generation', async () => {
    const startLocalMixed = vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() }))
    const stopLocalGeneration = vi.fn(async () => undefined)
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 7, sessionId: 'session:7', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed,
      stopLocalGeneration,
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const first = await coordinator.start(true, true)
    await coordinator.stop()
    const stoppedGeneration = coordinator.status.generation
    const replacement = await coordinator.start(true, true)

    expect(first.generation).toBe(7)
    expect(stoppedGeneration).toBeGreaterThan(first.generation)
    expect(replacement.generation).toBe(stoppedGeneration)
    expect(replacement.localGeneration).toBe(7)
    expect(coordinator.isUsingLocalStatus({ state: 'running', generation: 7, sessionId: 'session:7', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 1, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} })).toBe(true)
    expect(coordinator.isUsingLocalStatus({ state: 'running', generation: 8, sessionId: 'session:replacement', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} })).toBe(false)
    expect(qwenMocks.runnerStart.mock.calls.map(([input]) => (input as { generation: number }).generation)).toEqual([7, stoppedGeneration])
    expect(qwenMocks.encoderCreate.mock.calls.map(([input]) => (input as { generation: number }).generation)).toEqual([7, 7])
    expect(startLocalMixed).not.toHaveBeenCalled()
    expect(stopLocalGeneration).not.toHaveBeenCalled()

    await coordinator.stop()
  })

  it('waits for every active run cleanup before starting a replacement', async () => {
    const oldLocalCleanup = deferred()
    const unsubscribeFrames = vi.fn()
    const releaseMicrophone = vi.fn<() => void>()
    let localStatus: LocalCameraPerceptionStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    const releaseReplacementLocal = vi.fn(async () => {
      localStatus = { ...localStatus, state: 'idle', sessionId: undefined, sourceId: undefined }
    })
    const releaseOldLocal = vi.fn(async () => {
      await oldLocalCleanup.promise
      localStatus = { ...localStatus, state: 'idle', sessionId: undefined, sourceId: undefined }
    })
    const startLocalMixed = vi.fn(async () => {
      if (startLocalMixed.mock.calls.length === 1) {
        localStatus = { ...localStatus, state: 'running', generation: 1, sessionId: 'session:old', sourceId: 'camera:default', analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' } }
        return { sessionId: 'session:old', generation: 1, release: releaseOldLocal }
      }
      localStatus = { ...localStatus, state: 'running', generation: 2, sessionId: 'session:replacement', sourceId: 'camera:default', analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' } }
      return { sessionId: 'session:replacement', generation: 2, release: releaseReplacementLocal }
    })
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => localStatus,
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => unsubscribeFrames),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: releaseMicrophone })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })
    await coordinator.start(true, true)

    const stopping = coordinator.stop()
    const replacement = coordinator.start(true, true)

    expect(await settlesWithinMicrotasks(replacement)).toBe(false)
    expect(qwenMocks.runnerStop).toHaveBeenCalledOnce()
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(qwenMocks.encoderStop).toHaveBeenCalledOnce()
    expect(unsubscribeFrames).toHaveBeenCalledOnce()
    expect(releaseMicrophone).toHaveBeenCalledOnce()
    expect(releaseOldLocal).toHaveBeenCalledOnce()
    expect(startLocalMixed).toHaveBeenCalledOnce()

    oldLocalCleanup.resolve()
    await stopping
    const replacementStatus = await replacement

    expect(startLocalMixed).toHaveBeenCalledTimes(2)
    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:replacement', localGeneration: 2 })
    await coordinator.stop()
    expect(releaseReplacementLocal).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'idle'] as const)('registers %s retirement before a synchronous onStatus restart', async (triggerState) => {
    const oldCleanup = deferred()
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const startLocalMixed = vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() }))
    let replacement: ReturnType<QwenCloudCameraCoordinator['start']> | undefined
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 4, sessionId: 'session:4', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone,
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
      onStatus: (status) => {
        if (!replacement && status.captureState === triggerState)
          replacement = coordinator.start(true, true)
      },
    })
    await coordinator.start(true, true)

    let retiring: Promise<void>
    if (triggerState === 'failed') {
      const onRunnerStatus = (qwenMocks.runnerCreate.mock.calls[0]![0] as { onStatus: (status: Record<string, unknown>) => void }).onStatus
      onRunnerStatus({ state: 'failed', generation: 5, uploadActive: false, acceptedAudioChunks: 0, droppedAudioChunks: 0, submittedWindows: 1, completedWindows: 0, droppedFrames: 0, acceptedFactCount: 0, lastErrorCode: 'provider-failed' })
      retiring = coordinator.stop()
    }
    else {
      retiring = coordinator.stop()
    }

    expect(replacement).toBeDefined()
    expect(await settlesWithinMicrotasks(replacement!)).toBe(false)
    expect(acquireMicrophone).toHaveBeenCalledOnce()
    expect(qwenMocks.runnerStart).toHaveBeenCalledOnce()
    expect(startLocalMixed).not.toHaveBeenCalled()

    oldCleanup.resolve()
    await retiring
    const replacementStatus = await replacement!

    expect(acquireMicrophone).toHaveBeenCalledTimes(2)
    expect(qwenMocks.runnerStart).toHaveBeenCalledTimes(2)
    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:4' })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:4' })
    expect(coordinator.status.lastErrorCode).toBeUndefined()
    await coordinator.stop()
  })

  it.each([
    [false, true],
    [true, false],
  ])('requires separate frame and microphone consent before starting (%s, %s)', async (frameConsent, audioConsent) => {
    const startLocalMixed = vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() }))
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }),
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone,
      getPersonPresent: () => false,
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start(frameConsent, audioConsent)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'permission-denied' })
    expect(startLocalMixed).not.toHaveBeenCalled()
    expect(acquireMicrophone).not.toHaveBeenCalled()
  })

  it('reports a stable failure when microphone acquisition rejects for the current start', async () => {
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 4, sessionId: 'session:4', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => { throw new Error('device-failed') }),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start(true, true)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-microphone-unavailable' })
  })

  it('reports a stable failure when PCM initialization rejects for the current start', async () => {
    const release = vi.fn<() => void>()
    qwenMocks.pcmStart.mockRejectedValueOnce(new Error('audio-worklet-failed'))
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 4, sessionId: 'session:4', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start(true, true)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-pcm-unavailable' })
    expect(release).toHaveBeenCalledOnce()
  })

  it('does not let an old PCM failure overwrite a replacement while its cleanup is pending', async () => {
    const oldCleanup = deferred()
    qwenMocks.pcmStart.mockRejectedValueOnce(new Error('audio-worklet-failed')).mockResolvedValueOnce(undefined)
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 4, sessionId: 'session:4', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const failedStart = coordinator.start(true, true)
    await vi.waitFor(() => expect(qwenMocks.runnerStop).toHaveBeenCalledOnce())
    await coordinator.stop()
    const stoppedGeneration = coordinator.status.generation
    const replacement = await coordinator.start(true, true)
    oldCleanup.resolve()
    await failedStart

    expect(stoppedGeneration).toBeGreaterThan(4)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:4', generation: stoppedGeneration })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:4', generation: stoppedGeneration })
    await coordinator.stop()
  })

  it('awaits encoder-error retirement before a replacement can publish status', async () => {
    const oldCleanup = deferred()
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 4, sessionId: 'session:4', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })
    await coordinator.start(true, true)
    const onError = (qwenMocks.encoderCreate.mock.calls[0]![0] as { onError: (errorCode: string) => void }).onError

    onError('cloud-camera-encode-failed')
    await vi.waitFor(() => expect(qwenMocks.runnerStop).toHaveBeenCalledOnce())
    const stopping = coordinator.stop()
    const replacement = coordinator.start(true, true)

    expect(await settlesWithinMicrotasks(stopping)).toBe(false)
    expect(await settlesWithinMicrotasks(replacement)).toBe(false)
    oldCleanup.resolve()
    await stopping
    const replacementStatus = await replacement
    for (let turn = 0; turn < 8; turn += 1)
      await Promise.resolve()

    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running' })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running' })
    expect(coordinator.status.lastErrorCode).toBeUndefined()
    await coordinator.stop()
  })

  it('publishes and updates the shared camera target rate without changing cloud caps', async () => {
    const startLocalMixed = vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() }))
    const stopLocal = vi.fn(async () => undefined)
    const subscribeFrames = vi.fn(() => () => undefined)
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 1, sessionId: 'session:1', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed,
      stopLocalGeneration: stopLocal,
      subscribeFrames,
      acquireMicrophone,
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    await coordinator.start(true, true)
    const sessionBefore = coordinator.status.sessionId
    const generationBefore = coordinator.status.generation
    expect(coordinator.status.samplingRate).toBe(10)
    coordinator.setSamplingRate(30)
    expect(coordinator.status.samplingRate).toBe(30)
    expect(coordinator.status.sessionId).toBe(sessionBefore)
    expect(coordinator.status.generation).toBe(generationBefore)
    expect(startLocalMixed).not.toHaveBeenCalled()
    expect(stopLocal).not.toHaveBeenCalled()
    expect(subscribeFrames).toHaveBeenCalledOnce()
    expect(acquireMicrophone).toHaveBeenCalledOnce()
    await coordinator.stop()
  })

  it('stops promptly while the local mixed lane is pending and cleans it after late startup', async () => {
    const localStarted = deferred()
    let localStatus: LocalCameraPerceptionStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    const stopLocal = vi.fn(async () => {
      localStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    })
    const startLocalMixed = vi.fn(async () => {
      await localStarted.promise
      localStatus = { state: 'running', generation: 1, sessionId: 'session:1', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }
      return { sessionId: 'session:1', generation: 1, release: stopLocal }
    })
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => localStatus,
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone,
      getPersonPresent: () => false,
      isAudioAllowed: () => true,
    })

    const starting = coordinator.start(true, true)
    await vi.waitFor(() => expect(startLocalMixed).toHaveBeenCalledOnce())

    const repeated = await coordinator.start(true, true)
    expect(repeated).toMatchObject({ state: 'idle', captureState: 'starting' })
    expect(repeated.lastErrorCode).toBeUndefined()

    const stopping = coordinator.stop()
    const stoppedStatus = coordinator.status
    const stoppedPromptly = await settlesWithinMicrotasks(stopping)
    const repeatedStopping = coordinator.stop()
    const repeatedStoppedPromptly = await settlesWithinMicrotasks(repeatedStopping)
    const repeatedGeneration = coordinator.status.generation
    localStarted.resolve()
    await Promise.all([starting, stopping, repeatedStopping])

    expect(stoppedPromptly).toBe(true)
    expect(repeatedStoppedPromptly).toBe(true)
    expect(stoppedStatus).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(stoppedStatus.generation).toBeGreaterThan(0)
    expect(repeatedGeneration).toBe(stoppedStatus.generation)
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(coordinator.status.generation).toBe(stoppedStatus.generation)
    expect(acquireMicrophone).not.toHaveBeenCalled()
    expect(stopLocal).toHaveBeenCalled()
  })

  it('starts a replacement while the canceled local startup remains permanently pending', async () => {
    const neverStarted = deferred<{ sessionId: string, generation: number, release: () => Promise<void> }>()
    const replacementRelease = vi.fn(async () => undefined)
    let localStatus: LocalCameraPerceptionStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    const startLocalMixed = vi.fn(async (signal?: AbortSignal) => {
      if (startLocalMixed.mock.calls.length === 1) {
        localStatus = { ...localStatus, state: 'starting' }
        signal?.addEventListener('abort', () => {
          localStatus = { ...localStatus, state: 'idle' }
        }, { once: true })
        return await neverStarted.promise
      }
      localStatus = { state: 'running', generation: 2, sessionId: 'session:replacement', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }
      return { sessionId: 'session:replacement', generation: 2, release: replacementRelease }
    })
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => localStatus,
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    void coordinator.start(true, true)
    await vi.waitFor(() => expect(startLocalMixed).toHaveBeenCalledOnce())
    await coordinator.stop()

    const replacement = await coordinator.start(true, true)

    expect(startLocalMixed).toHaveBeenCalledTimes(2)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:replacement', generation: 2 })
    await coordinator.stop()
    expect(replacementRelease).toHaveBeenCalledOnce()
  })

  it('releases a canceled old local lease once without stopping the newer generation', async () => {
    const oldStarted = deferred<{ sessionId: string, generation: number, release: () => Promise<void> }>()
    const oldRelease = vi.fn(async () => undefined)
    const newRelease = vi.fn(async () => undefined)
    let localStatus: LocalCameraPerceptionStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    const startLocalMixed = vi.fn(async (signal?: AbortSignal) => {
      if (startLocalMixed.mock.calls.length === 1) {
        localStatus = { ...localStatus, state: 'starting' }
        signal?.addEventListener('abort', () => {
          localStatus = { ...localStatus, state: 'idle' }
        }, { once: true })
        return await oldStarted.promise
      }
      localStatus = { state: 'running', generation: 4, sessionId: 'session:new', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }
      return { sessionId: 'session:new', generation: 4, release: newRelease }
    })
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => localStatus,
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const oldStart = coordinator.start(true, true)
    await vi.waitFor(() => expect(startLocalMixed).toHaveBeenCalledOnce())
    await coordinator.stop()
    const replacement = await coordinator.start(true, true)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:new', generation: 4 })

    oldStarted.resolve({ sessionId: 'session:old', generation: 1, release: oldRelease })
    await oldStart

    expect(oldRelease).toHaveBeenCalledOnce()
    expect(newRelease).not.toHaveBeenCalled()
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:new', generation: 4 })
    await coordinator.stop()
    expect(oldRelease).toHaveBeenCalledOnce()
    expect(newRelease).toHaveBeenCalledOnce()
  })

  it('stops promptly while microphone acquisition is pending and releases the late lease', async () => {
    const acquired = deferred()
    const release = vi.fn<() => void>()
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 3, sessionId: 'session:3', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => {
        await acquired.promise
        return { stream: {} as MediaStream, release }
      }),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const starting = coordinator.start(true, true)
    await vi.waitFor(() => expect(coordinator.status.captureState).toBe('starting'))
    const stopping = coordinator.stop()
    const stoppedStatus = coordinator.status
    const stoppedPromptly = await settlesWithinMicrotasks(stopping)
    acquired.resolve()
    await Promise.all([starting, stopping])

    expect(stoppedPromptly).toBe(true)
    expect(stoppedStatus).toMatchObject({ state: 'idle', captureState: 'idle', generation: 4 })
    expect(release).toHaveBeenCalledOnce()
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle', generation: 4 })
  })

  it('starts a replacement while the first microphone acquisition remains permanently pending', async () => {
    const neverAcquired = deferred<{ stream: MediaStream, release: () => void }>()
    const replacementRelease = vi.fn<() => void>()
    const acquisitionSignals: Array<AbortSignal | undefined> = []
    const acquireMicrophone = vi.fn(async (_grant: unknown, signal?: AbortSignal) => {
      acquisitionSignals.push(signal)
      if (acquireMicrophone.mock.calls.length === 1)
        return await neverAcquired.promise
      return { stream: {} as MediaStream, release: replacementRelease }
    })
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 7, sessionId: 'session:7', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone,
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    void coordinator.start(true, true)
    await vi.waitFor(() => expect(acquireMicrophone).toHaveBeenCalledOnce())
    await coordinator.stop()
    const stoppedGeneration = coordinator.status.generation
    const replacement = await coordinator.start(true, true)

    expect(acquisitionSignals[0]).toBeInstanceOf(AbortSignal)
    expect(acquisitionSignals[0]?.aborted).toBe(true)
    expect(stoppedGeneration).toBeGreaterThan(7)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sessionId: 'session:7', generation: stoppedGeneration })
    await coordinator.stop()
    expect(replacementRelease).toHaveBeenCalledOnce()
  })

  it('stops promptly while PCM initialization is pending and stops it again after late completion', async () => {
    const pcmStarted = deferred()
    const release = vi.fn<() => void>()
    qwenMocks.pcmStart.mockImplementation(async () => pcmStarted.promise)
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 5, sessionId: 'session:5', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:unused', generation: 1, release: vi.fn() })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => () => undefined),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })

    const starting = coordinator.start(true, true)
    await vi.waitFor(() => expect(qwenMocks.pcmStart).toHaveBeenCalledOnce())
    const stopping = coordinator.stop()
    const stoppedStatus = coordinator.status
    const stoppedPromptly = await settlesWithinMicrotasks(stopping)
    await vi.waitFor(() => expect(qwenMocks.pcmStop).toHaveBeenCalledOnce())
    pcmStarted.resolve()
    await Promise.all([starting, stopping])

    expect(stoppedPromptly).toBe(true)
    expect(stoppedStatus).toMatchObject({ state: 'idle', captureState: 'idle', generation: 6 })
    expect(qwenMocks.pcmStop).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledOnce()
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle', generation: 6 })
  })

  it('attempts every active cleanup when frame unsubscribe fails without exposing its error', async () => {
    let localStatus: LocalCameraPerceptionStatus = { state: 'idle', generation: 0, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    const stopLocal = vi.fn(async () => {
      localStatus = { state: 'idle', generation: 3, processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' }, analyzerErrorCodes: {} }
    })
    const startLocalMixed = vi.fn(async () => {
      localStatus = { state: 'running', generation: 2, sessionId: 'session:2', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }
      return { sessionId: 'session:2', generation: 2, release: stopLocal }
    })
    const unsubscribeFrames = vi.fn(() => {
      throw new Error('raw C:\\Users\\private\\camera')
    })
    const release = vi.fn<() => void>()
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => localStatus,
      startLocalMixed,
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => unsubscribeFrames),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
    })
    await coordinator.start(true, true)

    await expect(coordinator.stop()).resolves.toBeUndefined()

    expect(unsubscribeFrames).toHaveBeenCalledOnce()
    expect(qwenMocks.encoderStop).toHaveBeenCalledOnce()
    expect(qwenMocks.runnerStop).toHaveBeenCalledOnce()
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(stopLocal).toHaveBeenCalledOnce()
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(JSON.stringify(coordinator.status)).not.toContain('private')
  })

  it('retires every active resource when the window runner fails', async () => {
    const unsubscribeFrames = vi.fn()
    const releaseMicrophone = vi.fn<() => void>()
    const releaseLocal = vi.fn(async () => undefined)
    const onProjection = vi.fn()
    const onObservability = vi.fn()
    const coordinator = new QwenCloudCameraCoordinator({
      getLocalStatus: () => ({ state: 'running', generation: 5, sessionId: 'session:5', sourceId: 'camera:default', processingMode: 'mixed', samplingRate: 10, acceptedFactCount: 0, observationCount: 0, droppedFrameCount: 0, analyzers: { mediapipe: 'ready', opencv: 'ready', yolo: 'ready' }, analyzerErrorCodes: {} }),
      startLocalMixed: vi.fn(async () => ({ sessionId: 'session:5', generation: 5, release: releaseLocal })),
      stopLocalGeneration: vi.fn(async () => undefined),
      subscribeFrames: vi.fn(() => unsubscribeFrames),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: releaseMicrophone })),
      getPersonPresent: () => true,
      isAudioAllowed: () => true,
      onProjection,
      onObservability,
    })
    await coordinator.start(true, true)
    const onStatus = (qwenMocks.runnerCreate.mock.calls[0]![0] as { onStatus: (status: Record<string, unknown>) => void }).onStatus

    onStatus({ state: 'failed', generation: 6, uploadActive: false, acceptedAudioChunks: 0, droppedAudioChunks: 0, submittedWindows: 1, completedWindows: 0, droppedFrames: 0, acceptedFactCount: 0, lastErrorCode: 'provider-failed' })

    await vi.waitFor(() => expect(releaseMicrophone).toHaveBeenCalledOnce())
    expect(unsubscribeFrames).toHaveBeenCalledOnce()
    expect(qwenMocks.encoderStop).toHaveBeenCalledOnce()
    expect(qwenMocks.runnerStop).toHaveBeenCalledWith('provider-failed')
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(releaseLocal).not.toHaveBeenCalled()
    expect(onProjection).toHaveBeenCalledWith(null)
    expect(onObservability).toHaveBeenCalledWith(null)
    expect(coordinator.status).toMatchObject({ state: 'failed', captureState: 'failed', generation: 6, lastErrorCode: 'provider-failed' })
  })
})
