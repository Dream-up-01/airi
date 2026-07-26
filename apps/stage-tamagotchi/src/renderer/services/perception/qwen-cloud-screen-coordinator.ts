import type {
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
  PerceptionOwnerProvider,
  ScreenModelRouteReason,
} from '@proj-airi/stage-ui/domains/perception'

import type { ProductionScreenSource } from './production-screen-capture'
import type { QwenCloudWindowRunnerStatus } from './qwen-cloud-window-runner'

import {
  PERCEPTION_CONTRACT_VERSION,
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

export interface QwenCloudScreenStatus extends QwenCloudWindowRunnerStatus {
  sourceId?: string
  captureState: 'idle' | 'starting' | 'running' | 'paused' | 'failed'
  lastGateReason?: string
}

export interface QwenCloudScreenCoordinatorOptions {
  ownerProvider: PerceptionOwnerProvider
  acquireMicrophone: (grant: PerceptionConsentGrant) => Promise<CloudMicrophoneLease>
  isAudioAllowed: () => boolean
  capture?: ProductionScreenCapture
  now?: () => number
  monotonicNow?: () => number
  id?: (prefix: string) => string
  onStatus?: (status: QwenCloudScreenStatus) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
}

interface ActiveRun {
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

export class QwenCloudScreenCoordinator {
  readonly #capture: ProductionScreenCapture
  readonly #ownerProvider: PerceptionOwnerProvider
  readonly #acquireMicrophone: QwenCloudScreenCoordinatorOptions['acquireMicrophone']
  readonly #isAudioAllowed: () => boolean
  readonly #now: () => number
  readonly #monotonicNow: () => number
  readonly #id: (prefix: string) => string
  readonly #onStatus?: QwenCloudScreenCoordinatorOptions['onStatus']
  readonly #onProjection?: QwenCloudScreenCoordinatorOptions['onProjection']
  readonly #onObservability?: QwenCloudScreenCoordinatorOptions['onObservability']
  #run?: ActiveRun
  #status: QwenCloudScreenStatus = initialStatus()

  constructor(options: QwenCloudScreenCoordinatorOptions) {
    this.#capture = options.capture ?? new ProductionScreenCapture({ maxJpegBytes: 190 * 1024, unchangedRefreshIntervalMs: undefined })
    this.#ownerProvider = options.ownerProvider
    this.#acquireMicrophone = options.acquireMicrophone
    this.#isAudioAllowed = options.isAudioAllowed
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

  listSources(): Promise<ProductionScreenSource[]> {
    return this.#capture.listSources()
  }

  requestEscalation(reason: ScreenModelRouteReason, evidenceFactIds: string[]): void {
    if (!this.#run)
      throw new Error('cloud-screen-route-unavailable')
    this.#run.runner.requestScreenEscalation(reason, evidenceFactIds)
  }

  async start(sourceId: string, consentConfirmed: boolean): Promise<QwenCloudScreenStatus> {
    if (this.#run || this.#status.captureState === 'starting')
      return this.#fail('cloud-screen-busy')
    if (!sourceId || !consentConfirmed)
      return this.#fail('permission-denied')
    this.#setStatus({ ...initialStatus(), captureState: 'starting', sourceId })
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
    const combinedGrant: PerceptionConsentGrant = {
      ...grants.frame,
      grantId: this.#id('grant:session'),
      allowedModalities: ['screen-frames', 'microphone-audio'],
    }
    const started = await lifecycle.start({ sourceId, requestConsentGrant: async () => combinedGrant })
    if (!started.ok)
      return this.#fail(started.code)
    const generation = started.session.generation
    if (generation !== provisionalGeneration) {
      await lifecycle.stop()
      return this.#fail('stale-generation')
    }

    let microphone: CloudMicrophoneLease
    try {
      microphone = await this.#acquireMicrophone(grants.audio)
    }
    catch {
      await lifecycle.stop()
      return this.#fail('cloud-microphone-unavailable')
    }

    let run!: ActiveRun
    const runner = new QwenCloudWindowRunner({
      isAudioAllowed: this.#isAudioAllowed,
      now: this.#now,
      id: this.#id,
      onStatus: status => this.#run === run && this.#setStatus(status),
      onProjection: this.#onProjection,
      onObservability: this.#onObservability,
    })
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
    try {
      await pcm.start(microphone.stream)
    }
    catch {
      await runner.stop('source-ended')
      microphone.release()
      await lifecycle.stop()
      return this.#fail('cloud-pcm-unavailable')
    }

    this.#capture.resetGate(sourceId, generation)
    run = {
      session,
      lifecycle,
      runner,
      pcm,
      microphone,
      sourceId,
      generation,
      timer: undefined as unknown as ReturnType<typeof setInterval>,
      sampling: false,
    }
    this.#run = run
    this.#setStatus({ captureState: 'running', state: 'running', sessionId, generation, sourceId, modelId: QWEN_FLASH_REALTIME_MODEL_ID })
    run.timer = setInterval(() => void this.#sample(run), 500)
    return this.status
  }

  async stop(reason = 'user-stop'): Promise<void> {
    const run = this.#run
    if (!run) {
      this.#capture.stop()
      this.#setStatus(initialStatus())
      return
    }
    this.#run = undefined
    clearInterval(run.timer)
    await run.runner.stop(reason)
    await run.pcm.stop()
    run.microphone.release()
    await run.lifecycle.stop()
    this.#capture.stop()
    this.#onProjection?.(null)
    this.#onObservability?.(null)
    this.#setStatus({ ...initialStatus(), generation: run.generation + 1 })
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
        await this.stop('source-ended')
        this.#setStatus({ captureState: 'failed', state: 'failed', generation: run.generation + 1, lastErrorCode: errorCode })
      }
    }
    finally {
      run.sampling = false
    }
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
  }
}
