import { createInMemoryPerceptionOwnerProvider } from '@proj-airi/stage-ui/domains/perception'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { acquireAbortableCloudMicrophone, QwenCloudScreenCoordinator } from './qwen-cloud-screen-coordinator'

function deferred<T>() {
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

    requestScreenEscalation(): void {}
  },
}))

describe('qwen cloud screen coordinator', () => {
  beforeEach(() => {
    qwenMocks.pcmStart.mockReset().mockResolvedValue(undefined)
    qwenMocks.pcmStop.mockReset().mockResolvedValue(undefined)
    qwenMocks.runnerCreate.mockReset()
    qwenMocks.runnerStart.mockReset()
    qwenMocks.runnerStop.mockReset().mockResolvedValue(undefined)
  })

  it('rejects an aborted microphone acquisition and releases its late lease', async () => {
    const acquired = deferred<{ stream: MediaStream, release: () => void }>()
    const release = vi.fn<() => void>()
    const controller = new AbortController()

    const acquisition = acquireAbortableCloudMicrophone(acquired.promise, controller.signal)
    controller.abort('user-stop')
    const settledPromptly = await settlesWithinMicrotasks(acquisition)
    const error = await acquisition.then(() => undefined, reason => reason)
    acquired.resolve({ stream: {} as MediaStream, release })
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())

    expect(settledPromptly).toBe(true)
    expect(error).toEqual(new Error('cloud-microphone-acquire-cancelled'))
  })

  it.each([
    [false, true],
    [true, false],
  ])('requires separate frame and microphone consent before starting (%s, %s)', async (frameConsent, audioConsent) => {
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone,
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start('window:screen', frameConsent, audioConsent)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'permission-denied' })
    expect(capture.open).not.toHaveBeenCalled()
    expect(acquireMicrophone).not.toHaveBeenCalled()
  })

  it('reports a stable failure when microphone acquisition rejects for the current start', async () => {
    const handle = { sourceId: 'window:screen', stop: vi.fn(), onEnded: () => () => undefined }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: {
        listSources: vi.fn(async () => []),
        open: vi.fn(async () => handle),
        resetGate: vi.fn(),
        captureFrame: vi.fn(),
        stop: vi.fn(),
      } as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => { throw new Error('device-failed') }),
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start('window:screen', true, true)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-microphone-unavailable' })
    expect(handle.stop).toHaveBeenCalledOnce()
  })

  it('reports a stable failure when PCM initialization rejects for the current start', async () => {
    const handle = { sourceId: 'window:screen', stop: vi.fn(), onEnded: () => () => undefined }
    const release = vi.fn<() => void>()
    qwenMocks.pcmStart.mockRejectedValueOnce(new Error('audio-worklet-failed'))
    const coordinator = new QwenCloudScreenCoordinator({
      capture: {
        listSources: vi.fn(async () => []),
        open: vi.fn(async () => handle),
        resetGate: vi.fn(),
        captureFrame: vi.fn(),
        stop: vi.fn(),
      } as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release })),
      isAudioAllowed: () => true,
    })

    const status = await coordinator.start('window:screen', true, true)

    expect(status).toMatchObject({ state: 'failed', captureState: 'failed', lastErrorCode: 'cloud-pcm-unavailable' })
    expect(release).toHaveBeenCalledOnce()
    expect(handle.stop).toHaveBeenCalledOnce()
  })

  it('does not let an old PCM failure overwrite a replacement while its cleanup is pending', async () => {
    const oldCleanup = deferred()
    qwenMocks.pcmStart.mockRejectedValueOnce(new Error('audio-worklet-failed')).mockResolvedValueOnce(undefined)
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: vi.fn(), onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      isAudioAllowed: () => true,
    })

    const failedStart = coordinator.start('window:old', true, true)
    await vi.waitFor(() => expect(qwenMocks.runnerStop).toHaveBeenCalledOnce())
    await coordinator.stop()
    const replacement = await coordinator.start('window:replacement', true, true)
    oldCleanup.resolve(undefined)
    await failedStart

    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    await coordinator.stop()
  })

  it('replaces the capture timer when the desktop target rate changes', async () => {
    const intervals: number[] = []
    let timerId = 0
    const clearInterval = vi.fn()
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: vi.fn(), onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(async () => ({ accepted: false as const, decision: { accepted: false as const, reason: 'unchanged' as const, changeRatio: 0, cadence: 'still' as const, nextEligibleAt: 0 } })),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone,
      isAudioAllowed: () => true,
      setInterval: (_callback, intervalMs) => {
        intervals.push(intervalMs)
        return ++timerId as unknown as ReturnType<typeof setInterval>
      },
      clearInterval,
    })

    await coordinator.start('window:screen', true, true)
    const sessionBefore = coordinator.status.sessionId
    const generationBefore = coordinator.status.generation
    expect(coordinator.status.samplingRate).toBe(2)
    expect(intervals.at(-1)).toBe(500)

    coordinator.setSamplingRate(5)

    expect(coordinator.status.samplingRate).toBe(5)
    expect(coordinator.status.sessionId).toBe(sessionBefore)
    expect(coordinator.status.generation).toBe(generationBefore)
    expect(capture.open).toHaveBeenCalledOnce()
    expect(acquireMicrophone).toHaveBeenCalledOnce()
    expect(clearInterval).toHaveBeenCalledOnce()
    expect(intervals.at(-1)).toBe(200)
    await coordinator.stop()
    expect(clearInterval).toHaveBeenCalledTimes(2)
    expect(coordinator.status.samplingRate).toBe(5)
  })

  it('waits for every active run cleanup before opening a replacement capture', async () => {
    const oldCaptureCleanup = deferred<void>()
    const handleStop = vi.fn()
    const microphoneRelease = vi.fn<() => void>()
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: handleStop, onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn()
        .mockImplementationOnce(async () => oldCaptureCleanup.promise)
        .mockResolvedValue(undefined),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: microphoneRelease })),
      isAudioAllowed: () => true,
      setInterval: vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
    })
    await coordinator.start('window:old', true, true)

    const stopping = coordinator.stop()
    const replacement = coordinator.start('window:replacement', true, true)

    expect(await settlesWithinMicrotasks(replacement)).toBe(false)
    expect(qwenMocks.runnerStop).toHaveBeenCalledOnce()
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(microphoneRelease).toHaveBeenCalledOnce()
    expect(handleStop).toHaveBeenCalledOnce()
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(capture.open).toHaveBeenCalledOnce()

    oldCaptureCleanup.resolve()
    await stopping
    const replacementStatus = await replacement

    expect(capture.open).toHaveBeenCalledTimes(2)
    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    await coordinator.stop()
  })

  it.each(['failed', 'idle'] as const)('registers %s retirement before a synchronous onStatus restart', async (triggerState) => {
    const oldCleanup = deferred<void>()
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: vi.fn(), onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    let replacement: ReturnType<QwenCloudScreenCoordinator['start']> | undefined
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone,
      isAudioAllowed: () => true,
      setInterval: vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      onStatus: (status) => {
        if (!replacement && status.captureState === triggerState)
          replacement = coordinator.start('window:replacement', true, true)
      },
    })
    await coordinator.start('window:old', true, true)

    let retiring: Promise<void>
    if (triggerState === 'failed') {
      const onRunnerStatus = (qwenMocks.runnerCreate.mock.calls[0]![0] as { onStatus: (status: Record<string, unknown>) => void }).onStatus
      onRunnerStatus({ state: 'failed', generation: 2, uploadActive: false, acceptedAudioChunks: 0, droppedAudioChunks: 0, submittedWindows: 1, completedWindows: 0, droppedFrames: 0, acceptedFactCount: 0, lastErrorCode: 'provider-failed' })
      retiring = coordinator.stop()
    }
    else {
      retiring = coordinator.stop()
    }

    expect(replacement).toBeDefined()
    expect(await settlesWithinMicrotasks(replacement!)).toBe(false)
    expect(capture.open).toHaveBeenCalledOnce()
    expect(acquireMicrophone).toHaveBeenCalledOnce()
    expect(qwenMocks.runnerStart).toHaveBeenCalledOnce()

    oldCleanup.resolve()
    await retiring
    const replacementStatus = await replacement!

    expect(capture.open).toHaveBeenCalledTimes(2)
    expect(acquireMicrophone).toHaveBeenCalledTimes(2)
    expect(qwenMocks.runnerStart).toHaveBeenCalledTimes(2)
    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    expect(coordinator.status.lastErrorCode).toBeUndefined()
    await coordinator.stop()
  })

  it('awaits sample-error retirement before a replacement can publish status', async () => {
    const oldCleanup = deferred<void>()
    const callbacks: Array<() => void> = []
    qwenMocks.runnerStop.mockImplementationOnce(async () => oldCleanup.promise).mockResolvedValue(undefined)
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: vi.fn(), onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn().mockRejectedValueOnce(new Error('cloud-screen-sample-failed')),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      isAudioAllowed: () => true,
      setInterval: (callback) => {
        callbacks.push(callback)
        return callbacks.length as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: vi.fn(),
    })
    await coordinator.start('window:old', true, true)

    callbacks[0]!()
    await vi.waitFor(() => expect(qwenMocks.runnerStop).toHaveBeenCalledOnce())
    const stopping = coordinator.stop()
    const replacement = coordinator.start('window:replacement', true, true)

    expect(await settlesWithinMicrotasks(stopping)).toBe(false)
    expect(await settlesWithinMicrotasks(replacement)).toBe(false)
    oldCleanup.resolve()
    await stopping
    const replacementStatus = await replacement
    for (let turn = 0; turn < 8; turn += 1)
      await Promise.resolve()

    expect(replacementStatus).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    expect(coordinator.status).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    expect(coordinator.status.lastErrorCode).toBeUndefined()
    await coordinator.stop()
  })

  it('stops promptly while capture.open is pending and cleans a late capture without reviving it', async () => {
    const opened = deferred<{ sourceId: string, stop: ReturnType<typeof vi.fn>, onEnded: () => () => void }>()
    const handle = { sourceId: 'window:screen', stop: vi.fn(), onEnded: () => () => undefined }
    const acquireMicrophone = vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() }))
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async () => opened.promise),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone,
      isAudioAllowed: () => true,
    })

    const starting = coordinator.start('window:screen', true, true)
    await vi.waitFor(() => expect(capture.open).toHaveBeenCalledOnce())

    const repeated = await coordinator.start('window:screen', true, true)
    expect(repeated).toMatchObject({ state: 'idle', captureState: 'starting' })
    expect(repeated.lastErrorCode).toBeUndefined()

    const stopping = coordinator.stop()
    const stoppedStatus = coordinator.status
    const stoppedPromptly = await settlesWithinMicrotasks(stopping)
    const repeatedStopping = coordinator.stop()
    const repeatedStoppedPromptly = await settlesWithinMicrotasks(repeatedStopping)
    const repeatedGeneration = coordinator.status.generation
    opened.resolve(handle)
    await Promise.all([starting, stopping, repeatedStopping])

    expect(stoppedPromptly).toBe(true)
    expect(repeatedStoppedPromptly).toBe(true)
    expect(stoppedStatus).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(stoppedStatus.generation).toBeGreaterThan(0)
    expect(repeatedGeneration).toBe(stoppedStatus.generation)
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(coordinator.status.generation).toBe(stoppedStatus.generation)
    expect(acquireMicrophone).not.toHaveBeenCalled()
    expect(handle.stop).toHaveBeenCalledOnce()
  })

  it('starts a replacement run while the canceled capture remains permanently pending', async () => {
    const neverOpened = deferred<{ sourceId: string, stop: ReturnType<typeof vi.fn>, onEnded: () => () => void }>()
    const replacementHandle = { sourceId: 'window:replacement', stop: vi.fn(), onEnded: () => () => undefined }
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn()
        .mockImplementationOnce(async () => neverOpened.promise)
        .mockResolvedValueOnce(replacementHandle),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: vi.fn() })),
      isAudioAllowed: () => true,
    })

    void coordinator.start('window:pending', true, true)
    await vi.waitFor(() => expect(capture.open).toHaveBeenCalledOnce())
    await coordinator.stop()

    const replacement = await coordinator.start('window:replacement', true, true)

    expect(capture.open).toHaveBeenCalledTimes(2)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:replacement' })
    await coordinator.stop()
    expect(replacementHandle.stop).toHaveBeenCalledOnce()
  })

  it('stops promptly while microphone acquisition is pending and releases the late lease', async () => {
    const acquired = deferred<{ stream: MediaStream, release: () => void }>()
    const handle = { sourceId: 'window:screen', stop: vi.fn(), onEnded: () => () => undefined }
    const release = vi.fn<() => void>()
    const lease = { stream: {} as MediaStream, release }
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async () => handle),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => acquired.promise),
      isAudioAllowed: () => true,
    })

    const starting = coordinator.start('window:screen', true, true)
    await vi.waitFor(() => expect(capture.open).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(coordinator.status.captureState).toBe('starting'))

    const stopping = coordinator.stop()
    const stoppedStatus = coordinator.status
    const stoppedPromptly = await settlesWithinMicrotasks(stopping)
    acquired.resolve(lease)
    await Promise.all([starting, stopping])

    expect(stoppedPromptly).toBe(true)
    expect(stoppedStatus).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(handle.stop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(coordinator.status.generation).toBe(stoppedStatus.generation)
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
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: vi.fn(), onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: vi.fn(),
    }
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone,
      isAudioAllowed: () => true,
    })

    void coordinator.start('window:first', true, true)
    await vi.waitFor(() => expect(acquireMicrophone).toHaveBeenCalledOnce())
    await coordinator.stop()
    const replacement = await coordinator.start('window:second', true, true)

    expect(acquisitionSignals[0]).toBeInstanceOf(AbortSignal)
    expect(acquisitionSignals[0]?.aborted).toBe(true)
    expect(replacement).toMatchObject({ state: 'running', captureState: 'running', sourceId: 'window:second' })
    await coordinator.stop()
    expect(replacementRelease).toHaveBeenCalledOnce()
  })

  it('attempts every active cleanup when runner shutdown fails without exposing its error', async () => {
    const handleStop = vi.fn()
    const microphoneRelease = vi.fn<() => void>()
    const captureStop = vi.fn()
    const capture = {
      listSources: vi.fn(async () => []),
      open: vi.fn(async (sourceId: string) => ({ sourceId, stop: handleStop, onEnded: () => () => undefined })),
      resetGate: vi.fn(),
      captureFrame: vi.fn(),
      stop: captureStop,
    }
    qwenMocks.runnerStop.mockRejectedValueOnce(new Error('raw C:\\Users\\private\\secret'))
    const coordinator = new QwenCloudScreenCoordinator({
      capture: capture as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: microphoneRelease })),
      isAudioAllowed: () => true,
    })
    await coordinator.start('window:screen', true, true)

    await expect(coordinator.stop()).resolves.toBeUndefined()

    expect(qwenMocks.runnerStop).toHaveBeenCalledOnce()
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(microphoneRelease).toHaveBeenCalledOnce()
    expect(handleStop).toHaveBeenCalledOnce()
    expect(captureStop).toHaveBeenCalledOnce()
    expect(coordinator.status).toMatchObject({ state: 'idle', captureState: 'idle' })
    expect(JSON.stringify(coordinator.status)).not.toContain('private')
  })

  it('retires every active resource when the window runner fails', async () => {
    const handleStop = vi.fn()
    const microphoneRelease = vi.fn<() => void>()
    const captureStop = vi.fn()
    const clearInterval = vi.fn()
    const onProjection = vi.fn()
    const onObservability = vi.fn()
    const coordinator = new QwenCloudScreenCoordinator({
      capture: {
        listSources: vi.fn(async () => []),
        open: vi.fn(async (sourceId: string) => ({ sourceId, stop: handleStop, onEnded: () => () => undefined })),
        resetGate: vi.fn(),
        captureFrame: vi.fn(),
        stop: captureStop,
      } as never,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      acquireMicrophone: vi.fn(async () => ({ stream: {} as MediaStream, release: microphoneRelease })),
      isAudioAllowed: () => true,
      setInterval: vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>),
      clearInterval,
      onProjection,
      onObservability,
    })
    await coordinator.start('window:screen', true, true)
    const onStatus = (qwenMocks.runnerCreate.mock.calls[0]![0] as { onStatus: (status: Record<string, unknown>) => void }).onStatus

    onStatus({ state: 'failed', generation: 2, uploadActive: false, acceptedAudioChunks: 0, droppedAudioChunks: 0, submittedWindows: 1, completedWindows: 0, droppedFrames: 0, acceptedFactCount: 0, lastErrorCode: 'provider-failed' })

    await vi.waitFor(() => expect(microphoneRelease).toHaveBeenCalledOnce())
    expect(clearInterval).toHaveBeenCalledWith(42)
    expect(qwenMocks.runnerStop).toHaveBeenCalledWith('provider-failed')
    expect(qwenMocks.pcmStop).toHaveBeenCalledOnce()
    expect(handleStop).toHaveBeenCalledOnce()
    expect(captureStop).toHaveBeenCalledOnce()
    expect(onProjection).toHaveBeenCalledWith(null)
    expect(onObservability).toHaveBeenCalledWith(null)
    expect(coordinator.status).toMatchObject({ state: 'failed', captureState: 'failed', generation: 2, lastErrorCode: 'provider-failed' })
  })
})
