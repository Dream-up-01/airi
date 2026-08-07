import type {
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
  PerceptionOwnerProvider,
  PerceptionSamplingRate,
  ScreenModelRouteReason,
} from '@proj-airi/stage-ui/domains/perception'

import type { ProductionScreenSource } from './production-screen-capture'
import type { QwenCloudWindowRunnerStatus } from './qwen-cloud-window-runner'

import {
  defaultPerceptionSamplingRate,
  PERCEPTION_CONTRACT_VERSION,
  perceptionSamplingIntervalMs,
  PerceptionSessionController,
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'
import { ProductionScreenCaptureLifecycle } from '@proj-airi/stage-ui/services/perception'

import { ProductionScreenCapture } from './production-screen-capture'
import { QwenCloudPcmCapture } from './qwen-cloud-pcm-capture'
import { QwenCloudWindowRunner } from './qwen-cloud-window-runner'

export interface CloudMicrophoneLease {
  stream: MediaStream
  release: () => void
}

export function acquireAbortableCloudMicrophone(
  acquisition: Promise<CloudMicrophoneLease>,
  signal: AbortSignal,
): Promise<CloudMicrophoneLease> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled)
        return
      settled = true
      reject(new Error('cloud-microphone-acquire-cancelled'))
    }

    if (signal.aborted)
      onAbort()
    else
      signal.addEventListener('abort', onAbort, { once: true })

    void acquisition.then(
      (lease) => {
        signal.removeEventListener('abort', onAbort)
        if (settled || signal.aborted) {
          void Promise.resolve().then(() => lease.release()).catch(() => {})
          return
        }
        settled = true
        resolve(lease)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        if (settled)
          return
        settled = true
        reject(error)
      },
    )
  })
}

export interface QwenCloudScreenStatus extends QwenCloudWindowRunnerStatus {
  sourceId?: string
  captureState: 'idle' | 'starting' | 'running' | 'paused' | 'failed'
  lastGateReason?: string
  samplingRate: PerceptionSamplingRate
}

export interface QwenCloudScreenCoordinatorOptions {
  ownerProvider: PerceptionOwnerProvider
  acquireMicrophone: (grant: PerceptionConsentGrant, signal: AbortSignal) => Promise<CloudMicrophoneLease>
  isAudioAllowed: () => boolean
  samplingRate?: PerceptionSamplingRate
  capture?: ProductionScreenCapture
  now?: () => number
  monotonicNow?: () => number
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  id?: (prefix: string) => string
  onStatus?: (status: QwenCloudScreenStatus) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
}

interface ActiveRun {
  epoch: number
  session: PerceptionSessionController
  lifecycle: ProductionScreenCaptureLifecycle
  runner: QwenCloudWindowRunner
  pcm: QwenCloudPcmCapture
  microphone: CloudMicrophoneLease
  sourceId: string
  generation: number
  timer: ReturnType<typeof setInterval>
  sampling: boolean
}

interface StartingRun {
  lifecycle: ProductionScreenCaptureLifecycle
  generation: number
  epoch: number
  controller: AbortController
  cancelled: boolean
  lifecycleStop?: Promise<void>
  runner?: QwenCloudWindowRunner
  pcm?: QwenCloudPcmCapture
  microphone?: CloudMicrophoneLease
}

export class QwenCloudScreenCoordinator {
  readonly #capture: ProductionScreenCapture
  readonly #ownerProvider: PerceptionOwnerProvider
  readonly #acquireMicrophone: QwenCloudScreenCoordinatorOptions['acquireMicrophone']
  readonly #isAudioAllowed: () => boolean
  readonly #setInterval: NonNullable<QwenCloudScreenCoordinatorOptions['setInterval']>
  readonly #clearInterval: NonNullable<QwenCloudScreenCoordinatorOptions['clearInterval']>
  #samplingRate: PerceptionSamplingRate
  readonly #now: () => number
  readonly #monotonicNow: () => number
  readonly #id: (prefix: string) => string
  readonly #onStatus?: QwenCloudScreenCoordinatorOptions['onStatus']
  readonly #onProjection?: QwenCloudScreenCoordinatorOptions['onProjection']
  readonly #onObservability?: QwenCloudScreenCoordinatorOptions['onObservability']
  #epoch = 0
  #activeRetirement?: Promise<void>
  #retirement?: Promise<void>
  #starting?: StartingRun
  #run?: ActiveRun
  #status: QwenCloudScreenStatus = initialStatus()

  constructor(options: QwenCloudScreenCoordinatorOptions) {
    this.#capture = options.capture ?? new ProductionScreenCapture({ maxJpegBytes: 190 * 1024, unchangedRefreshIntervalMs: undefined })
    this.#ownerProvider = options.ownerProvider
    this.#acquireMicrophone = options.acquireMicrophone
    this.#isAudioAllowed = options.isAudioAllowed
    this.#samplingRate = options.samplingRate ?? defaultPerceptionSamplingRate('screen')
    this.#setInterval = options.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
    this.#clearInterval = options.clearInterval ?? (timer => clearInterval(timer))
    this.#now = options.now ?? Date.now
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#id = options.id ?? (prefix => `${prefix}:screen-cloud:${crypto.randomUUID()}`)
    this.#onStatus = options.onStatus
    this.#onProjection = options.onProjection
    this.#onObservability = options.onObservability
  }

  get status(): QwenCloudScreenStatus {
    return { ...this.#status }
  }

  setSamplingRate(rate: PerceptionSamplingRate): void {
    if (this.#samplingRate === rate)
      return
    this.#samplingRate = rate
    this.#setStatus({ samplingRate: rate })
    const run = this.#run
    if (!run || this.#status.captureState !== 'running')
      return
    this.#clearInterval(run.timer)
    run.timer = this.#setInterval(() => void this.#sample(run), perceptionSamplingIntervalMs(this.#samplingRate))
  }

  listSources(): Promise<ProductionScreenSource[]> {
    return this.#capture.listSources()
  }

  requestEscalation(reason: ScreenModelRouteReason, evidenceFactIds: string[]): void {
    if (!this.#run)
      throw new Error('cloud-screen-route-unavailable')
    this.#run.runner.requestScreenEscalation(reason, evidenceFactIds)
  }

  async start(sourceId: string, frameConsentConfirmed: boolean, audioConsentConfirmed: boolean): Promise<QwenCloudScreenStatus> {
    if (this.#run || this.#starting || this.#status.captureState === 'starting')
      return this.status
    if (!sourceId || !frameConsentConfirmed || !audioConsentConfirmed)
      return this.#fail('permission-denied')
    await this.#awaitRetirement()
    if (this.#run || this.#starting)
      return this.status
    this.#setStatus({ ...initialStatus(), captureState: 'starting', lastErrorCode: undefined, samplingRate: this.#samplingRate, sourceId })
    const sessionId = this.#id('session')
    const session = new PerceptionSessionController({
      sessionId,
      processingMode: 'cloud-approved',
      ownerId: 'renderer:main',
      ownerProvider: this.#ownerProvider,
      now: this.#now,
    })
    const lifecycle = new ProductionScreenCaptureLifecycle(session, this.#capture)
    const provisionalGeneration = session.session.generation + 1
    const grants = createGrants({ sessionId, generation: provisionalGeneration, sourceId, now: this.#now, id: this.#id })
    const starting = createStartingRun(lifecycle, provisionalGeneration, ++this.#epoch)
    this.#starting = starting
    try {
      const started = await lifecycle.start({ sourceId, requestConsentGrant: async () => grants.frame })
      if (!this.#isCurrentStart(starting)) {
        await this.#cleanupStarting(starting, 'user-stop')
        return this.status
      }
      if (!started.ok)
        return this.#fail(started.code)
      const generation = started.session.generation
      if (generation !== provisionalGeneration) {
        await this.#cleanupStarting(starting, 'source-ended')
        return this.#fail('stale-generation')
      }

      try {
        starting.microphone = await this.#acquireMicrophone(grants.audio, starting.controller.signal)
      }
      catch {
        const status = await this.#failStarting(starting, 'cloud-microphone-unavailable')
        return status
      }
      if (!this.#isCurrentStart(starting)) {
        await this.#cleanupStarting(starting, 'user-stop')
        return this.status
      }

      let run!: ActiveRun
      const runner = new QwenCloudWindowRunner({
        isAudioAllowed: this.#isAudioAllowed,
        now: this.#now,
        id: this.#id,
        onStatus: status => this.#handleRunnerStatus(run, status),
        onProjection: this.#onProjection,
        onObservability: this.#onObservability,
      })
      starting.runner = runner
      runner.start({
        sessionId,
        generation,
        sourceKind: 'screen-cloud',
        sourceId,
        modelId: QWEN_FLASH_REALTIME_MODEL_ID,
        frameGrant: grants.frame,
        audioGrant: grants.audio,
      })
      const pcm = new QwenCloudPcmCapture({ onChunk: chunk => runner.offerAudio(chunk), now: this.#now, monotonicNow: this.#monotonicNow })
      starting.pcm = pcm
      try {
        await pcm.start(starting.microphone.stream, starting.controller.signal)
      }
      catch {
        const status = await this.#failStarting(starting, 'cloud-pcm-unavailable')
        return status
      }
      if (!this.#isCurrentStart(starting)) {
        await this.#cleanupStarting(starting, 'user-stop')
        return this.status
      }

      this.#capture.resetGate(sourceId, generation)
      run = {
        epoch: starting.epoch,
        session,
        lifecycle,
        runner,
        pcm,
        microphone: starting.microphone,
        sourceId,
        generation,
        timer: undefined as unknown as ReturnType<typeof setInterval>,
        sampling: false,
      }
      starting.runner = undefined
      starting.pcm = undefined
      starting.microphone = undefined
      this.#run = run
      this.#starting = undefined
      this.#setStatus({ captureState: 'running', state: 'running', sessionId, generation, sourceId, modelId: QWEN_FLASH_REALTIME_MODEL_ID, samplingRate: this.#samplingRate })
      run.timer = this.#setInterval(() => void this.#sample(run), perceptionSamplingIntervalMs(this.#samplingRate))
      return this.status
    }
    finally {
      if (this.#starting === starting)
        this.#starting = undefined
    }
  }

  async stop(reason = 'user-stop'): Promise<void> {
    const starting = this.#starting
    if (starting) {
      if (starting.cancelled)
        return
      starting.cancelled = true
      starting.controller.abort(reason)
      if (this.#starting === starting)
        this.#starting = undefined
      this.#epoch += 1
      void settleCleanups([
        () => this.#setStatus({ ...initialStatus(), generation: Math.max(this.#status.generation, starting.generation) + 1, samplingRate: this.#samplingRate }),
        () => this.#onProjection?.(null),
        () => this.#onObservability?.(null),
      ])
      starting.lifecycleStop ??= settleCleanups([() => starting.lifecycle.stop()])
      this.#retirement = starting.lifecycleStop
      void this.#cleanupStarting(starting, reason)
      return
    }
    const run = this.#run
    if (!run) {
      await this.#awaitActiveRetirement()
      if (this.#run || this.#starting)
        return
      await settleCleanups([
        () => this.#setStatus({ ...initialStatus(), generation: this.#status.generation, samplingRate: this.#samplingRate }),
        () => this.#onProjection?.(null),
        () => this.#onObservability?.(null),
        () => this.#capture.stop(),
      ])
      return
    }
    await this.#retireRun(run, reason, {
      ...initialStatus(),
      generation: Math.max(this.#status.generation, run.generation) + 1,
      samplingRate: this.#samplingRate,
    })
  }

  async pause(): Promise<void> {
    await this.stop('user-stop')
    this.#setStatus({ captureState: 'paused' })
  }

  async #sample(run: ActiveRun): Promise<void> {
    if (this.#run !== run || run.sampling || this.#status.captureState !== 'running')
      return
    run.sampling = true
    try {
      const result = await this.#capture.captureFrame({
        frameId: this.#id('frame'),
        observationId: this.#id('observation'),
        sessionId: run.session.session.sessionId,
        sourceId: run.sourceId,
        generation: run.generation,
      })
      if (this.#run !== run) {
        if (result.accepted)
          result.frame.release('generation-switched')
        return
      }
      this.#setStatus({ lastGateReason: result.decision.reason })
      if (!result.accepted)
        return
      run.runner.offerFrame({
        frameId: result.frame.frameId,
        observationId: result.frame.observationId,
        capturedAt: result.frame.capturedAt,
        monotonicTimestamp: this.#monotonicNow(),
        width: 1280,
        height: 720,
        jpeg: result.frame.jpegBytes,
        release: reason => result.frame.release(reason === 'completed' ? 'processed' : reason === 'replaced' ? 'replaced-by-latest' : 'scheduler-stopped'),
      })
    }
    catch (error) {
      if (this.#run === run) {
        const errorCode = stableError(error)
        await this.#retireRun(run, 'source-ended', {
          ...initialStatus(),
          captureState: 'failed',
          state: 'failed',
          generation: run.generation + 1,
          lastErrorCode: errorCode,
          samplingRate: this.#samplingRate,
        })
      }
    }
    finally {
      run.sampling = false
    }
  }

  #isCurrentStart(starting: StartingRun): boolean {
    return this.#starting === starting && starting.epoch === this.#epoch && !starting.cancelled && !starting.controller.signal.aborted
  }

  async #awaitRetirement(): Promise<void> {
    const retirement = this.#retirement
    if (!retirement)
      return
    await retirement
    if (this.#retirement === retirement)
      this.#retirement = undefined
  }

  async #awaitActiveRetirement(): Promise<void> {
    const retirement = this.#activeRetirement
    if (retirement)
      await retirement
  }

  async #cleanupStarting(starting: StartingRun, reason: string): Promise<void> {
    starting.controller.abort(reason)
    const runner = starting.runner
    const pcm = starting.pcm
    const microphone = starting.microphone
    starting.microphone = undefined
    starting.lifecycleStop ??= settleCleanups([() => starting.lifecycle.stop()])
    await settleCleanups([
      () => runner?.stop(reason),
      () => pcm?.stop(),
      () => microphone?.release(),
      () => starting.lifecycleStop,
    ])
  }

  #handleRunnerStatus(run: ActiveRun, status: QwenCloudWindowRunnerStatus): void {
    if (this.#run !== run)
      return
    if (status.state !== 'failed') {
      this.#setStatus(status)
      return
    }
    const errorCode = status.lastErrorCode ?? 'cloud-window-failed'
    void this.#retireRun(run, errorCode, { ...status, captureState: 'failed', lastErrorCode: errorCode })
  }

  #retireRun(run: ActiveRun, reason: string, status: Partial<QwenCloudScreenStatus>): Promise<void> {
    if (this.#run !== run || run.epoch !== this.#epoch)
      return this.#awaitRetirement()
    this.#run = undefined
    this.#epoch += 1
    let resolveRetirement!: () => void
    const retirement = new Promise<void>((resolve) => {
      resolveRetirement = resolve
    })
    this.#activeRetirement = retirement
    this.#retirement = retirement
    void retirement.finally(() => {
      if (this.#activeRetirement === retirement)
        this.#activeRetirement = undefined
      if (this.#retirement === retirement)
        this.#retirement = undefined
    })
    try {
      this.#setStatus(status)
    }
    finally {
      void settleCleanups([
        () => this.#onProjection?.(null),
        () => this.#onObservability?.(null),
        () => this.#clearInterval(run.timer),
        () => run.runner.stop(reason),
        () => run.pcm.stop(),
        () => run.microphone.release(),
        () => run.lifecycle.stop(),
        () => this.#capture.stop(),
      ]).then(resolveRetirement, resolveRetirement)
    }
    return retirement
  }

  async #failStarting(starting: StartingRun, errorCode: string): Promise<QwenCloudScreenStatus> {
    const ownedCurrentStart = this.#isCurrentStart(starting)
    await this.#cleanupStarting(starting, 'source-ended')
    if (ownedCurrentStart && this.#starting === starting && starting.epoch === this.#epoch)
      return this.#fail(errorCode)
    return this.status
  }

  #fail(code: string): QwenCloudScreenStatus {
    this.#setStatus({ captureState: 'failed', state: 'failed', lastErrorCode: code })
    return this.status
  }

  #setStatus(patch: Partial<QwenCloudScreenStatus>): void {
    this.#status = { ...this.#status, ...patch }
    this.#onStatus?.(this.status)
  }
}

function createStartingRun(lifecycle: ProductionScreenCaptureLifecycle, generation: number, epoch: number): StartingRun {
  return { lifecycle, generation, epoch, controller: new AbortController(), cancelled: false }
}

async function settleCleanups(cleanups: Array<() => void | Promise<void> | undefined>): Promise<void> {
  const operations = cleanups.map((cleanup) => {
    try {
      return Promise.resolve(cleanup())
    }
    catch {
      return Promise.resolve()
    }
  })
  await Promise.allSettled(operations)
}

function createGrants(input: { sessionId: string, generation: number, sourceId: string, now: () => number, id: (prefix: string) => string }) {
  const base = {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    sourceKind: 'screen' as const,
    sourceId: input.sourceId,
    processingMode: 'cloud-approved' as const,
    allowedFactCategories: ['screen.activity', 'screen.application', 'screen.task', 'screen.window'],
    cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
    cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
    regionId: QWEN_CLOUD_REGION_ID,
    costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
    grantedAt: input.now(),
    showPersistentIndicator: true,
  }
  return {
    frame: { ...base, grantId: input.id('grant:frame'), allowedModalities: ['screen-frames'] as const } as unknown as PerceptionConsentGrant,
    audio: { ...base, grantId: input.id('grant:audio'), allowedModalities: ['microphone-audio'] as const } as unknown as PerceptionConsentGrant,
  }
}

function stableError(error: unknown): string {
  return error instanceof Error && /^[a-z][a-z0-9-]{1,79}$/u.test(error.message) ? error.message : 'cloud-screen-failed'
}

function initialStatus(): QwenCloudScreenStatus {
  return {
    state: 'idle',
    captureState: 'idle',
    generation: 0,
    uploadActive: false,
    acceptedAudioChunks: 0,
    droppedAudioChunks: 0,
    submittedWindows: 0,
    completedWindows: 0,
    droppedFrames: 0,
    acceptedFactCount: 0,
    samplingRate: defaultPerceptionSamplingRate('screen'),
  }
}
