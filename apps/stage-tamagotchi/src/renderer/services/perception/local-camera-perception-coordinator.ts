import type { MocapBackend } from '@proj-airi/model-driver-mediapipe'
import type {
  CameraMediaPipeEvidence,
  CameraOpenCvEvidence,
  CameraYoloEvidence,
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
  PerceptionOwnerProvider,
  PerceptionSamplingRate,
  PerceptionStateSnapshot,
} from '@proj-airi/stage-ui/domains/perception'

import type { ProductionCameraCapture, ProductionCameraFrame } from './production-camera-capture'

import { createMediaPipeBackend } from '@proj-airi/model-driver-mediapipe'
import {
  bindPerceptionLifecycleToStateManager,
  createCameraLocalObjectiveEvents,
  createPerceptionContextProjection,
  createPerceptionObservabilitySnapshot,
  defaultPerceptionSamplingRate,
  PERCEPTION_CONTRACT_VERSION,
  perceptionSamplingIntervalMs,
  PerceptionSessionController,
  PerceptionStateManager,
} from '@proj-airi/stage-ui/domains/perception'
import {
  analyzeOpenCvCameraMetrics,
  createCameraMediaPipeEvidenceNarrower,
  createLatestCameraAnalyzer,
  PerceptionDownstreamPolicyController,
  ProductionCameraCaptureLifecycle,
} from '@proj-airi/stage-ui/services/perception'

import { CameraOpenCvWorkerClient } from './camera-opencv-worker-client'
import { CameraYoloXRuntime } from './camera-yolox-runtime'

export type CameraAnalyzerState = 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed'

export interface LocalCameraPerceptionStatus {
  state: 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed'
  generation: number
  samplingRate: PerceptionSamplingRate
  sessionId?: string
  sourceId?: string
  processingMode?: 'local-only' | 'mixed'
  lastErrorCode?: string
  acceptedFactCount: number
  observationCount: number
  droppedFrameCount: number
  analyzers: {
    mediapipe: CameraAnalyzerState
    opencv: CameraAnalyzerState
    yolo: CameraAnalyzerState
  }
  analyzerErrorCodes: Partial<Record<'mediapipe' | 'opencv' | 'yolo', string>>
}

export interface LocalCameraPerceptionCoordinatorOptions {
  capture: CameraCaptureRuntime
  ownerProvider: PerceptionOwnerProvider
  samplingRate?: PerceptionSamplingRate
  now?: () => number
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  id?: (prefix: string) => string
  createMediaPipe?: () => MocapBackend
  createOpenCv?: () => CameraOpenCvRuntime
  createYolo?: () => CameraYoloRuntime
  isResourceConstrained?: () => boolean
  onStatus?: (status: LocalCameraPerceptionStatus) => void
  onSnapshot?: (snapshot: PerceptionStateSnapshot) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onFrame?: (frame: ProductionCameraFrame) => void
}

export interface CameraCaptureRuntime {
  open: ProductionCameraCapture['open']
  captureFrame: () => ProductionCameraFrame
}

export interface CameraOpenCvRuntime {
  analyze: CameraOpenCvWorkerClient['analyze']
  dispose: () => void
}

export interface CameraYoloRuntime {
  analyze: CameraYoloXRuntime['analyze']
  dispose: () => Promise<void>
}

interface ActiveCameraRun {
  session: PerceptionSessionController
  lifecycle: ProductionCameraCaptureLifecycle
  manager: PerceptionStateManager
  grant: PerceptionConsentGrant
  mediaPipe: MocapBackend
  openCv: CameraOpenCvRuntime
  yolo: CameraYoloRuntime
  timer: ReturnType<typeof setInterval>
  mediaPipeAnalyzer: ReturnType<typeof createLatestCameraAnalyzer<HTMLVideoElement, CameraMediaPipeEvidence[]>>
  openCvAnalyzer: ReturnType<typeof createLatestCameraAnalyzer<ImageData, CameraOpenCvEvidence>>
  yoloAnalyzer: ReturnType<typeof createLatestCameraAnalyzer<ImageData, CameraYoloEvidence>>
  sequence: number
  lastOpenCvAt: number
  lastYoloAt: number
  downstream: PerceptionDownstreamPolicyController
}

interface StartingCameraRun {
  epoch: number
  controller: AbortController
  cancelled: boolean
  lifecycle?: ProductionCameraCaptureLifecycle
  lifecycleStop?: Promise<void>
  mediaPipe?: MocapBackend
  mediaPipeInit?: Promise<void>
  mediaPipeInitSettled: boolean
  mediaPipeCleanup?: Promise<void>
  openCv?: CameraOpenCvRuntime
  yolo?: CameraYoloRuntime
  retirement?: Promise<LocalCameraPerceptionStatus>
}

const CAMERA_SOURCE_ID = 'camera:default'
const OPENCV_MAX_FPS = 10
const OPENCV_MIN_INTERVAL_MS = 1_000 / OPENCV_MAX_FPS
const CAMERA_FACT_CATEGORIES = [
  'person.presence',
  'person.count',
  'person.pose',
  'person.gesture',
  'person.observable-cue',
  'person.activity-like',
  'environment.lighting',
  'object.presence',
  'camera.health',
]

export class LocalCameraPerceptionCoordinator {
  readonly #capture: CameraCaptureRuntime
  readonly #ownerProvider: PerceptionOwnerProvider
  readonly #setInterval: NonNullable<LocalCameraPerceptionCoordinatorOptions['setInterval']>
  readonly #clearInterval: NonNullable<LocalCameraPerceptionCoordinatorOptions['clearInterval']>
  #samplingRate: PerceptionSamplingRate
  readonly #now: () => number
  readonly #id: (prefix: string) => string
  readonly #createMediaPipe: () => MocapBackend
  readonly #createOpenCv: () => CameraOpenCvRuntime
  readonly #createYolo: () => CameraYoloRuntime
  readonly #isResourceConstrained: () => boolean
  readonly #onStatus?: (status: LocalCameraPerceptionStatus) => void
  readonly #onSnapshot?: (snapshot: PerceptionStateSnapshot) => void
  readonly #onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
  readonly #onProjection?: (projection: PerceptionContextProjection | null) => void
  readonly #onFrame?: (frame: ProductionCameraFrame) => void
  #epoch = 0
  #starting?: StartingCameraRun
  #retirement?: Promise<void>
  #run?: ActiveCameraRun
  #status: LocalCameraPerceptionStatus = createInitialStatus()

  constructor(options: LocalCameraPerceptionCoordinatorOptions) {
    this.#capture = options.capture
    this.#ownerProvider = options.ownerProvider
    this.#samplingRate = options.samplingRate ?? defaultPerceptionSamplingRate('camera')
    this.#setInterval = options.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
    this.#clearInterval = options.clearInterval ?? (timer => clearInterval(timer))
    this.#now = options.now ?? Date.now
    this.#id = options.id ?? (prefix => `${prefix}:camera:${crypto.randomUUID()}`)
    this.#createMediaPipe = options.createMediaPipe ?? createMediaPipeBackend
    this.#createOpenCv = options.createOpenCv ?? (() => new CameraOpenCvWorkerClient())
    this.#createYolo = options.createYolo ?? (() => new CameraYoloXRuntime())
    this.#isResourceConstrained = options.isResourceConstrained ?? (() => false)
    this.#onStatus = options.onStatus
    this.#onSnapshot = options.onSnapshot
    this.#onObservability = options.onObservability
    this.#onProjection = options.onProjection
    this.#onFrame = options.onFrame
  }

  get status(): LocalCameraPerceptionStatus {
    return cloneStatus(this.#status)
  }

  setSamplingRate(rate: PerceptionSamplingRate): void {
    if (this.#samplingRate === rate)
      return
    this.#samplingRate = rate
    this.#setStatus({ samplingRate: rate })
    const run = this.#run
    if (!run || this.#status.state !== 'running')
      return
    this.#clearInterval(run.timer)
    run.timer = this.#setInterval(() => this.#captureAndSchedule(run), perceptionSamplingIntervalMs(this.#samplingRate))
  }

  async start(
    consentConfirmed: boolean,
    processingMode: 'local-only' | 'mixed' = 'local-only',
    signal?: AbortSignal,
  ): Promise<LocalCameraPerceptionStatus> {
    if (this.#starting || this.#run)
      return this.#fail('camera-capture-busy')
    if (!consentConfirmed)
      return this.#fail('permission-denied')
    if (signal?.aborted)
      return this.status
    await this.#awaitRetirement()
    if (this.#starting || this.#run)
      return this.#fail('camera-capture-busy')
    this.#setStatus({ ...createInitialStatus(), state: 'starting', samplingRate: this.#samplingRate, analyzers: { mediapipe: 'starting', opencv: 'starting', yolo: 'starting' } })
    const starting = createStartingRun(++this.#epoch)
    this.#starting = starting
    const operation = this.#startRun(starting, processingMode)
    const onAbort = () => void this.#retireStarting(starting, 'stop')
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted)
      onAbort()
    try {
      await settleOnAbort(operation, starting.controller.signal)
    }
    finally {
      signal?.removeEventListener('abort', onAbort)
      if (this.#starting === starting)
        this.#starting = undefined
    }
    return this.status
  }

  async pause(): Promise<LocalCameraPerceptionStatus> {
    if (this.#starting)
      return this.#retireStarting(this.#starting, 'pause')
    if (!this.#run)
      return this.status
    this.#setStatus({ state: 'stopping' })
    await this.#disposeRun(this.#run, 'pause')
    this.#setStatus({
      state: 'paused',
      generation: this.#status.generation + 1,
      acceptedFactCount: 0,
      analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
      analyzerErrorCodes: {},
    })
    return this.status
  }

  async stop(): Promise<LocalCameraPerceptionStatus> {
    if (this.#starting)
      return this.#retireStarting(this.#starting, 'stop')
    await this.#awaitRetirement()
    if (!this.#run) {
      this.#setStatus({
        state: 'idle',
        lastErrorCode: undefined,
        analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
        analyzerErrorCodes: {},
      })
      return this.status
    }
    this.#setStatus({ state: 'stopping' })
    await this.#disposeRun(this.#run, 'stop')
    this.#setStatus({
      state: 'idle',
      generation: this.#status.generation + 1,
      lastErrorCode: undefined,
      acceptedFactCount: 0,
      analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
      analyzerErrorCodes: {},
    })
    return this.status
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  confirmFact(factId: string): void {
    const run = this.#run
    if (!run || !run.manager.confirmFact(factId))
      return
    this.#publishManager(run.manager)
  }

  retractFact(factId: string): void {
    const run = this.#run
    if (!run || !run.manager.retractFact(factId))
      return
    this.#publishManager(run.manager)
  }

  clearFacts(): void {
    const run = this.#run
    if (!run)
      return
    run.manager.revokeAll('user-retracted')
    this.#publishManager(run.manager)
  }

  async #startRun(starting: StartingCameraRun, processingMode: 'local-only' | 'mixed'): Promise<void> {
    const now = this.#now()
    const sessionId = this.#id('session')
    const manager = new PerceptionStateManager({ sessionId, generation: 0, clock: { now: this.#now }, maxEventsPerSourcePerSecond: 64 })
    const session = new PerceptionSessionController({
      sessionId,
      processingMode,
      ownerId: 'renderer:main',
      ownerProvider: this.#ownerProvider,
      now: this.#now,
      hooks: bindPerceptionLifecycleToStateManager(manager),
    })
    const lifecycle = new ProductionCameraCaptureLifecycle(session, this.#capture)
    starting.lifecycle = lifecycle
    const grant: PerceptionConsentGrant = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      grantId: this.#id('grant'),
      sourceKind: 'camera',
      sourceId: CAMERA_SOURCE_ID,
      processingMode: 'local-only',
      allowedModalities: ['camera-frames'],
      allowedFactCategories: CAMERA_FACT_CATEGORIES,
      grantedAt: now,
      showPersistentIndicator: true,
    }
    const started = await lifecycle.start({ sourceId: CAMERA_SOURCE_ID, requestConsentGrant: async () => grant })
    if (!this.#isCurrentStart(starting)) {
      await this.#cleanupStarting(starting)
      return
    }
    if (!started.ok) {
      await this.#failStarting(starting, started.code)
      return
    }

    const mediaPipe = this.#createMediaPipe()
    const openCv = this.#createOpenCv()
    const yolo = this.#createYolo()
    starting.mediaPipe = mediaPipe
    starting.openCv = openCv
    starting.yolo = yolo
    const mediaPipeInit = mediaPipe.init({
      enabled: { pose: true, hands: true, face: true },
      hz: { pose: 10, hands: 8, face: 5 },
      maxPeople: 1,
    })
    starting.mediaPipeInit = mediaPipeInit
    try {
      await mediaPipeInit
    }
    catch {
      starting.mediaPipeInitSettled = true
      await this.#failStarting(starting, 'camera-mediapipe-init-failed')
      return
    }
    starting.mediaPipeInitSettled = true
    if (!this.#isCurrentStart(starting)) {
      await this.#cleanupStarting(starting)
      return
    }

    manager.setSourceHealth({ sourceId: CAMERA_SOURCE_ID, sourceKind: 'camera', status: 'healthy', updatedAt: this.#now() })
    const narrower = createCameraMediaPipeEvidenceNarrower()
    let run!: ActiveCameraRun
    const publish = (evidence: { mediaPipe?: CameraMediaPipeEvidence[], openCv?: CameraOpenCvEvidence, yolo?: CameraYoloEvidence }, observationId: string) => {
      if (this.#run !== run || run.session.session.generation !== this.#status.generation)
        return
      const events = createCameraLocalObjectiveEvents({
        sessionId,
        generation: run.session.session.generation,
        sourceId: CAMERA_SOURCE_ID,
        observationId,
        ...evidence,
      }, { createId: () => this.#id('event') })
      for (const event of events)
        manager.ingest(event, { consentGrant: grant, sourceHealthy: true })
      this.#publishManager(manager)
    }
    const onAnalyzerFailure = (analyzer: 'mediapipe' | 'opencv' | 'yolo', errorCode = 'camera-analyzer-failed') => {
      this.#setStatus({
        analyzers: { ...this.#status.analyzers, [analyzer]: 'degraded' },
        analyzerErrorCodes: { ...this.#status.analyzerErrorCodes, [analyzer]: errorCode },
      })
    }
    const mediaPipeAnalyzer = createLatestCameraAnalyzer<HTMLVideoElement, CameraMediaPipeEvidence[]>({
      timeoutMs: 5_000,
      analyze: async (video, capturedAt, signal) => {
        if (signal.aborted)
          throw new Error('camera-mediapipe-cancelled')
        const partial = await mediaPipe.run(video, ['pose', 'hands', 'face'], performance.now())
        return narrower.narrow(partial, capturedAt)
      },
      onResult: (result) => {
        if (this.#run !== run)
          return
        if (result.status === 'completed' && result.evidence) {
          this.#markAnalyzerReady('mediapipe')
          publish({ mediaPipe: result.evidence }, this.#id('observation'))
        }
        else if (result.status === 'dropped') {
          this.#setStatus({ droppedFrameCount: this.#status.droppedFrameCount + 1 })
        }
        else if (result.status === 'failed' || result.status === 'timed-out') {
          onAnalyzerFailure('mediapipe', result.errorCode)
        }
      },
    })
    const openCvAnalyzer = createLatestCameraAnalyzer<ImageData, CameraOpenCvEvidence>({
      timeoutMs: 1_000,
      analyze: async (imageData, capturedAt, signal) => analyzeOpenCvCameraMetrics(await openCv.analyze(imageData, capturedAt, signal)).evidence,
      onResult: (result) => {
        if (this.#run !== run)
          return
        if (result.status === 'completed' && result.evidence) {
          this.#markAnalyzerReady('opencv')
          publish({ openCv: result.evidence }, this.#id('observation'))
        }
        else if (result.status === 'dropped') {
          this.#setStatus({ droppedFrameCount: this.#status.droppedFrameCount + 1 })
        }
        else if (result.status === 'failed' || result.status === 'timed-out') {
          onAnalyzerFailure('opencv', result.errorCode)
        }
      },
    })
    const yoloAnalyzer = createLatestCameraAnalyzer<ImageData, CameraYoloEvidence>({
      timeoutMs: 3_000,
      analyze: (imageData, capturedAt, signal) => yolo.analyze(imageData, capturedAt, signal),
      onResult: (result) => {
        if (this.#run !== run)
          return
        if (result.status === 'completed' && result.evidence) {
          this.#markAnalyzerReady('yolo')
          publish({ yolo: result.evidence }, this.#id('observation'))
        }
        else if (result.status === 'dropped') {
          this.#setStatus({ droppedFrameCount: this.#status.droppedFrameCount + 1 })
        }
        else if (result.status === 'failed' || result.status === 'timed-out') {
          onAnalyzerFailure('yolo', result.errorCode)
        }
      },
    })
    run = {
      session,
      lifecycle,
      manager,
      grant,
      mediaPipe,
      openCv,
      yolo,
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      mediaPipeAnalyzer,
      openCvAnalyzer,
      yoloAnalyzer,
      sequence: 0,
      lastOpenCvAt: Number.NEGATIVE_INFINITY,
      lastYoloAt: 0,
      downstream: new PerceptionDownstreamPolicyController(),
    }
    starting.mediaPipe = undefined
    starting.openCv = undefined
    starting.yolo = undefined
    this.#run = run
    this.#starting = undefined
    this.#setStatus({
      state: 'running',
      generation: session.session.generation,
      samplingRate: this.#samplingRate,
      sessionId,
      sourceId: CAMERA_SOURCE_ID,
      processingMode,
      analyzers: { mediapipe: 'ready', opencv: 'starting', yolo: 'starting' },
    })
    run.timer = this.#setInterval(() => this.#captureAndSchedule(run), perceptionSamplingIntervalMs(this.#samplingRate))
  }

  #isCurrentStart(starting: StartingCameraRun): boolean {
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

  #retireStarting(starting: StartingCameraRun, kind: 'stop' | 'pause'): Promise<LocalCameraPerceptionStatus> {
    if (starting.retirement)
      return starting.retirement
    if (this.#starting !== starting)
      return Promise.resolve(this.status)

    starting.cancelled = true
    starting.controller.abort(kind)
    this.#starting = undefined
    const retirementEpoch = ++this.#epoch
    this.#setStatus({ state: 'stopping' })
    const retirement = (async () => {
      await this.#cleanupStarting(starting)
      if (this.#epoch === retirementEpoch && !this.#starting && !this.#run) {
        this.#setStatus({
          ...createInitialStatus(),
          state: kind === 'pause' ? 'paused' : 'idle',
          generation: this.#status.generation + 1,
          samplingRate: this.#samplingRate,
        })
      }
      return this.status
    })()
    starting.retirement = retirement
    this.#retirement = retirement.then(() => undefined, () => undefined)
    return retirement
  }

  async #cleanupStarting(starting: StartingCameraRun): Promise<void> {
    if (starting.lifecycle && !starting.lifecycleStop)
      starting.lifecycleStop = settleCleanups([() => starting.lifecycle?.stop()])

    const openCv = starting.openCv
    const yolo = starting.yolo
    const mediaPipe = starting.mediaPipe
    starting.openCv = undefined
    starting.yolo = undefined
    starting.mediaPipe = undefined

    let immediateMediaPipeCleanup: Promise<void> | undefined
    if (mediaPipe && !starting.mediaPipeCleanup) {
      if (starting.mediaPipeInit && !starting.mediaPipeInitSettled) {
        starting.mediaPipeCleanup = starting.mediaPipeInit
          .then(() => undefined, () => undefined)
          .then(() => settleCleanups([() => mediaPipe.dispose?.()]))
      }
      else {
        starting.mediaPipeCleanup = settleCleanups([() => mediaPipe.dispose?.()])
        immediateMediaPipeCleanup = starting.mediaPipeCleanup
      }
    }

    await settleCleanups([
      () => starting.lifecycleStop,
      () => openCv?.dispose(),
      () => yolo?.dispose(),
      () => immediateMediaPipeCleanup,
    ])
  }

  async #failStarting(starting: StartingCameraRun, errorCode: string): Promise<void> {
    const ownedCurrentStart = this.#isCurrentStart(starting)
    await this.#cleanupStarting(starting)
    if (ownedCurrentStart && this.#starting === starting && starting.epoch === this.#epoch)
      this.#fail(errorCode)
  }

  #captureAndSchedule(run: ActiveCameraRun): void {
    if (this.#run !== run || this.#status.state !== 'running')
      return
    try {
      const frame = this.#capture.captureFrame()
      this.#onFrame?.(frame)
      run.sequence += 1
      this.#setStatus({ observationCount: this.#status.observationCount + 1 })
      run.mediaPipeAnalyzer.submit({ frame: frame.video, capturedAt: frame.capturedAt, release: () => undefined })
      if (frame.capturedAt - run.lastOpenCvAt >= OPENCV_MIN_INTERVAL_MS) {
        run.lastOpenCvAt = frame.capturedAt
        const openCvImage = new ImageData(new Uint8ClampedArray(frame.imageData.data), frame.imageData.width, frame.imageData.height)
        run.openCvAnalyzer.submit({ frame: openCvImage, capturedAt: frame.capturedAt, release: () => openCvImage.data.fill(0) })
      }
      if (this.#isResourceConstrained()) {
        this.#setStatus({
          analyzers: { ...this.#status.analyzers, yolo: 'degraded' },
          analyzerErrorCodes: { ...this.#status.analyzerErrorCodes, yolo: 'voice-resource-priority' },
        })
        frame.imageData.data.fill(0)
      }
      else if (frame.capturedAt - run.lastYoloAt >= 500) {
        run.lastYoloAt = frame.capturedAt
        run.yoloAnalyzer.submit({ frame: frame.imageData, capturedAt: frame.capturedAt, release: () => frame.imageData.data.fill(0) })
      }
      else {
        frame.imageData.data.fill(0)
      }
    }
    catch {
      void this.#handleCaptureFailure(run)
    }
  }

  async #handleCaptureFailure(run: ActiveCameraRun): Promise<void> {
    if (this.#run !== run)
      return
    run.manager.setSourceHealth({ sourceId: CAMERA_SOURCE_ID, sourceKind: 'camera', status: 'failed', updatedAt: this.#now(), errorCode: 'camera-capture-failed' })
    await this.#disposeRun(run, 'capture-failed')
    this.#fail('camera-capture-failed')
  }

  #publishManager(manager: PerceptionStateManager): void {
    const run = this.#run
    if (run?.manager === manager)
      run.downstream.evaluate(manager)
    const snapshot = manager.snapshot()
    const facts = manager.listFacts()
    this.#setStatus({
      acceptedFactCount: snapshot.acceptedFactIds.length,
    })
    this.#onSnapshot?.(snapshot)
    this.#onObservability?.(createPerceptionObservabilitySnapshot({ facts, snapshot }))
    this.#onProjection?.(createPerceptionContextProjection({ facts, snapshot, now: this.#now() }))
  }

  async #disposeRun(run: ActiveCameraRun, reason: string): Promise<void> {
    if (this.#run !== run)
      return
    this.#run = undefined
    await settleCleanups([
      () => this.#clearInterval(run.timer),
      () => run.mediaPipeAnalyzer.dispose(),
      () => run.openCvAnalyzer.dispose(),
      () => run.yoloAnalyzer.dispose(),
      () => run.lifecycle.stop(),
      () => run.mediaPipe.dispose?.(),
      () => run.openCv.dispose(),
      () => run.yolo.dispose(),
      () => run.manager.revokeAll(reason === 'stop' ? 'session-stopped' : 'source-revoked'),
      () => run.downstream.cancelAll(run.manager),
      () => this.#onSnapshot?.(run.manager.snapshot()),
      () => this.#onObservability?.(null),
      () => this.#onProjection?.(null),
    ])
  }

  #fail(code: string): LocalCameraPerceptionStatus {
    this.#setStatus({ state: 'failed', lastErrorCode: code })
    return this.status
  }

  #markAnalyzerReady(analyzer: 'mediapipe' | 'opencv' | 'yolo'): void {
    if (this.#status.analyzers[analyzer] === 'ready')
      return
    const analyzerErrorCodes = { ...this.#status.analyzerErrorCodes }
    delete analyzerErrorCodes[analyzer]
    this.#setStatus({
      analyzers: { ...this.#status.analyzers, [analyzer]: 'ready' },
      analyzerErrorCodes,
    })
  }

  #setStatus(patch: Partial<LocalCameraPerceptionStatus>): void {
    this.#status = {
      ...this.#status,
      ...patch,
      analyzers: patch.analyzers ?? this.#status.analyzers,
      analyzerErrorCodes: patch.analyzerErrorCodes ?? this.#status.analyzerErrorCodes,
    }
    this.#onStatus?.(this.status)
  }
}

function createInitialStatus(): LocalCameraPerceptionStatus {
  return {
    state: 'idle',
    generation: 0,
    samplingRate: defaultPerceptionSamplingRate('camera'),
    sessionId: undefined,
    sourceId: undefined,
    processingMode: undefined,
    acceptedFactCount: 0,
    observationCount: 0,
    droppedFrameCount: 0,
    analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
    analyzerErrorCodes: {},
  }
}

function cloneStatus(status: LocalCameraPerceptionStatus): LocalCameraPerceptionStatus {
  return { ...status, analyzers: { ...status.analyzers }, analyzerErrorCodes: { ...status.analyzerErrorCodes } }
}

function createStartingRun(epoch: number): StartingCameraRun {
  return {
    epoch,
    controller: new AbortController(),
    cancelled: false,
    mediaPipeInitSettled: false,
  }
}

async function settleOnAbort(operation: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
