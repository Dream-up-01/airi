import type {
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
  PerceptionOwnerProvider,
  PerceptionSamplingRate,
  PerceptionStateSnapshot,
} from '@proj-airi/stage-ui/domains/perception'
import type { LocalScreenAnalyzerControllerErrorCode } from '@proj-airi/stage-ui/services/perception'

import type { LocalScreenConsentClient } from './local-screen-consent-client'
import type { ProductionScreenCapture, ProductionScreenSource } from './production-screen-capture'

import {
  createPerceptionContextProjection,
  createPerceptionObservabilitySnapshot,
  createWebLockPerceptionOwnerProvider,
  defaultPerceptionSamplingRate,
  perceptionSamplingIntervalMs,
  PerceptionSessionController,
  PerceptionStateManager,
} from '@proj-airi/stage-ui/domains/perception'
import {
  LocalScreenAnalyzerController,
  PerceptionDownstreamPolicyController,
  ProductionScreenCaptureLifecycle,
} from '@proj-airi/stage-ui/services/perception'

import { LocalScreenEventaRuntime } from './local-screen-eventa-runtime'

export type LocalScreenPerceptionState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed'

export interface LocalScreenPerceptionStatus {
  state: LocalScreenPerceptionState
  sessionId?: string
  generation: number
  samplingRate: PerceptionSamplingRate
  sourceId?: string
  modelId?: string
  lastErrorCode?: string
  lastGateReason?: string
  acceptedFactCount: number
  lastIngestOutcome?: 'accepted' | 'suppressed' | 'revoked'
  lastSuppressionReason?: string
  lastConfidence?: number
  captureAttemptCount: number
  acceptedFrameCount: number
  gateDroppedFrameCount: number
  analyzerReplacedFrameCount: number
  inferenceFactCount: number
  lastFrameAcceptedAt?: number
  lastInferenceAt?: number
  sensitiveSurfacePaused: boolean
}

export interface LocalScreenPerceptionStartRequest {
  sourceId: string
  consentConfirmed: boolean
}

export interface LocalScreenPerceptionCoordinatorOptions {
  capture: ProductionScreenCapture
  consent: LocalScreenConsentClient
  ownerProvider?: PerceptionOwnerProvider
  ownerId?: string
  samplingRate?: PerceptionSamplingRate
  id?: (prefix: 'session' | 'grant' | 'frame' | 'observation') => string
  now?: () => number
  monotonicNow?: () => number
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  createRuntime?: (options: ConstructorParameters<typeof LocalScreenEventaRuntime>[0]) => LocalScreenEventaRuntime
  isResourceConstrained?: () => boolean
  onStatus?: (status: LocalScreenPerceptionStatus) => void
  onSnapshot?: (snapshot: PerceptionStateSnapshot) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
}

interface ActiveRun {
  sessionId: string
  generation: number
  sourceId: string
  grant: PerceptionConsentGrant
  manager: PerceptionStateManager
  session: PerceptionSessionController
  lifecycle: ProductionScreenCaptureLifecycle
  analyzer?: LocalScreenAnalyzerController
  consentRegistered: boolean
  captureExclusionEnabled: boolean
  timer?: ReturnType<typeof setInterval>
  sampling: boolean
  downstream: PerceptionDownstreamPolicyController
}

/**
 * Coordinates explicit consent, the sole renderer owner, memory-only capture,
 * the directed Eventa runtime and the sole PerceptionStateManager write path.
 */
export class LocalScreenPerceptionCoordinator {
  readonly #capture: ProductionScreenCapture
  readonly #consent: LocalScreenConsentClient
  readonly #ownerProvider: PerceptionOwnerProvider
  readonly #ownerId: string
  #samplingRate: PerceptionSamplingRate
  readonly #id: NonNullable<LocalScreenPerceptionCoordinatorOptions['id']>
  readonly #now: () => number
  readonly #setInterval: NonNullable<LocalScreenPerceptionCoordinatorOptions['setInterval']>
  readonly #clearInterval: NonNullable<LocalScreenPerceptionCoordinatorOptions['clearInterval']>
  readonly #createRuntime: NonNullable<LocalScreenPerceptionCoordinatorOptions['createRuntime']>
  readonly #isResourceConstrained: () => boolean
  readonly #onStatus?: (status: LocalScreenPerceptionStatus) => void
  readonly #onSnapshot?: (snapshot: PerceptionStateSnapshot) => void
  readonly #onProjection?: (projection: PerceptionContextProjection | null) => void
  readonly #onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
  #run?: ActiveRun
  #status: LocalScreenPerceptionStatus = {
    state: 'idle',
    generation: 0,
    samplingRate: defaultPerceptionSamplingRate('screen'),
    acceptedFactCount: 0,
    captureAttemptCount: 0,
    acceptedFrameCount: 0,
    gateDroppedFrameCount: 0,
    analyzerReplacedFrameCount: 0,
    inferenceFactCount: 0,
    sensitiveSurfacePaused: false,
  }

  #operation?: Promise<void>

  constructor(options: LocalScreenPerceptionCoordinatorOptions) {
    this.#capture = options.capture
    this.#consent = options.consent
    this.#ownerProvider = options.ownerProvider ?? createWebLockPerceptionOwnerProvider(navigator.locks)
    this.#ownerId = options.ownerId ?? 'renderer:main'
    this.#samplingRate = options.samplingRate ?? defaultPerceptionSamplingRate('screen')
    this.#id = options.id ?? (prefix => `${prefix}:screen:${crypto.randomUUID()}`)
    this.#now = options.now ?? Date.now
    this.#setInterval = options.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
    this.#clearInterval = options.clearInterval ?? (timer => clearInterval(timer))
    this.#createRuntime = options.createRuntime ?? (runtimeOptions => new LocalScreenEventaRuntime(runtimeOptions))
    this.#isResourceConstrained = options.isResourceConstrained ?? (() => false)
    this.#onStatus = options.onStatus
    this.#onSnapshot = options.onSnapshot
    this.#onProjection = options.onProjection
    this.#onObservability = options.onObservability
  }

  get status(): LocalScreenPerceptionStatus {
    return { ...this.#status }
  }

  setSamplingRate(rate: PerceptionSamplingRate): void {
    if (this.#samplingRate === rate)
      return
    this.#samplingRate = rate
    this.#setStatus({ samplingRate: rate })
    const run = this.#run
    if (!run || this.#status.state !== 'running')
      return
    if (run.timer)
      this.#clearInterval(run.timer)
    run.timer = this.#setInterval(() => void this.#sample(run), perceptionSamplingIntervalMs(this.#samplingRate))
  }

  async listSources(): Promise<ProductionScreenSource[]> {
    return await this.#capture.listSources()
  }

  async start(request: LocalScreenPerceptionStartRequest): Promise<LocalScreenPerceptionStatus> {
    if (this.#operation || this.#run || ['starting', 'running', 'stopping'].includes(this.#status.state))
      return this.#fail('capture-busy')
    if (!request.sourceId || !request.consentConfirmed)
      return this.#fail(request.consentConfirmed ? 'consent-invalid' : 'permission-denied')

    this.#setStatus({
      state: 'starting',
      generation: 0,
      samplingRate: this.#samplingRate,
      sourceId: request.sourceId,
      lastErrorCode: undefined,
      lastGateReason: undefined,
      acceptedFactCount: 0,
      captureAttemptCount: 0,
      acceptedFrameCount: 0,
      gateDroppedFrameCount: 0,
      analyzerReplacedFrameCount: 0,
      inferenceFactCount: 0,
      lastFrameAcceptedAt: undefined,
      lastInferenceAt: undefined,
      sensitiveSurfacePaused: false,
    })

    const sessionId = this.#id('session')
    const grant: PerceptionConsentGrant = {
      contractVersion: 'perception/v0.3',
      grantId: this.#id('grant'),
      sourceKind: 'screen',
      sourceId: request.sourceId,
      processingMode: 'local-only',
      allowedModalities: ['screen-frames'],
      allowedFactCategories: ['screen.activity', 'screen.application', 'screen.task', 'screen.window', 'screen.health'],
      grantedAt: this.#now(),
      showPersistentIndicator: true,
    }
    const manager = new PerceptionStateManager({ sessionId, generation: 0, clock: { now: this.#now } })
    const session = new PerceptionSessionController({
      sessionId,
      processingMode: 'local-only',
      ownerId: this.#ownerId,
      ownerProvider: this.#ownerProvider,
      now: this.#now,
      hooks: {
        onGenerationChanged: (changedSessionId, generation) => {
          manager.setGeneration(changedSessionId, generation)
          const active = this.#run
          if (active && active.sessionId === changedSessionId && generation !== active.generation)
            void this.#cleanup('failed', 'generation-stale', 'source-ended', false)
        },
        onSourceRevoked: (_kind, sourceId) => manager.revokeSource(sourceId),
      },
    })
    const lifecycle = new ProductionScreenCaptureLifecycle(session, this.#capture)
    const started = await lifecycle.start({
      sourceId: request.sourceId,
      requestConsentGrant: async () => grant,
    })
    if (!started.ok)
      return this.#fail(started.code)

    const generation = started.session.generation
    const run: ActiveRun = {
      sessionId,
      generation,
      sourceId: request.sourceId,
      grant,
      manager,
      session,
      lifecycle,
      consentRegistered: false,
      captureExclusionEnabled: false,
      sampling: false,
      downstream: new PerceptionDownstreamPolicyController(),
    }
    this.#run = run
    this.#capture.resetGate(request.sourceId, generation)
    this.#setStatus({ sessionId, generation })

    try {
      await this.#consent.register(sessionId, generation, grant)
      run.consentRegistered = true
      await this.#consent.setCaptureExclusion(sessionId, generation, grant.grantId, true)
      run.captureExclusionEnabled = true
      if (this.#run !== run || session.session.state !== 'running')
        throw new Error('screen-runtime-start-cancelled')

      const runtime = this.#createRuntime({
        consentGrantId: grant.grantId,
        sessionId,
        generation,
        sourceId: request.sourceId,
      })
      run.analyzer = new LocalScreenAnalyzerController({
        sessionId,
        sourceId: request.sourceId,
        generation,
        adapterId: 'screen:transformers-local',
        runtime,
        stateManager: manager,
        getConsentGrant: () => this.#run === run && run.consentRegistered ? grant : undefined,
        isSourceHealthy: () => this.#run === run
          && this.#status.state === 'running'
          && !this.#status.sensitiveSurfacePaused,
        onIngestResult: (result) => {
          this.#setStatus({
            lastIngestOutcome: result.outcome,
            lastSuppressionReason: result.ok ? undefined : result.reason,
            lastConfidence: result.fact?.confidence,
            inferenceFactCount: this.#status.inferenceFactCount + 1,
            lastInferenceAt: this.#now(),
          })
          this.#publishSnapshot(run)
        },
        onError: code => this.#handleAnalyzerError(run, code),
      })
      const analyzerStarted = await run.analyzer.start()
      if (!analyzerStarted.ok)
        throw new Error(analyzerStarted.code)
      if (this.#run !== run || session.session.state !== 'running')
        throw new Error('screen-runtime-start-cancelled')

      manager.setSourceHealth({ sourceId: request.sourceId, sourceKind: 'screen', status: 'healthy', updatedAt: this.#now() })
      this.#setStatus({ state: 'running', modelId: analyzerStarted.profile.modelId })
      run.timer = this.#setInterval(() => void this.#sample(run), perceptionSamplingIntervalMs(this.#samplingRate))
      this.#publishSnapshot(run)
      return this.status
    }
    catch (error) {
      const code = stableErrorCode(error)
      await this.#cleanup('failed', code, 'generation-stale', true)
      return this.status
    }
  }

  async pause(): Promise<LocalScreenPerceptionStatus> {
    if (!this.#run)
      return this.status
    await this.#cleanup('paused', undefined, 'user-stop', true, true)
    return this.status
  }

  async stop(): Promise<LocalScreenPerceptionStatus> {
    if (!this.#run) {
      this.#capture.stop()
      this.#setStatus({
        state: 'idle',
        sessionId: undefined,
        generation: 0,
        samplingRate: this.#samplingRate,
        sourceId: undefined,
        modelId: undefined,
        lastGateReason: undefined,
        acceptedFactCount: 0,
        captureAttemptCount: 0,
        acceptedFrameCount: 0,
        gateDroppedFrameCount: 0,
        analyzerReplacedFrameCount: 0,
        inferenceFactCount: 0,
        lastFrameAcceptedAt: undefined,
        lastInferenceAt: undefined,
        sensitiveSurfacePaused: false,
      })
      return this.status
    }
    await this.#cleanup('idle', undefined, 'user-stop', true)
    return this.status
  }

  async dispose(): Promise<void> {
    if (this.#run)
      await this.#cleanup('idle', undefined, 'unmount', true)
    else
      this.#capture.stop()
  }

  setSensitiveSurfacePaused(paused: boolean): void {
    this.#setStatus({ sensitiveSurfacePaused: paused })
    const run = this.#run
    if (paused && run) {
      run.manager.revokeSource(run.sourceId, 'source-revoked')
      this.#publishSnapshot(run)
    }
  }

  confirmFact(factId: string): void {
    const run = this.#run
    if (!run || !run.manager.confirmFact(factId))
      return
    this.#publishSnapshot(run)
  }

  retractFact(factId: string): void {
    const run = this.#run
    if (!run || !run.manager.retractFact(factId))
      return
    this.#publishSnapshot(run)
  }

  clearFacts(): void {
    const run = this.#run
    if (!run)
      return
    run.manager.revokeAll('user-retracted')
    this.#publishSnapshot(run)
  }

  async #sample(run: ActiveRun): Promise<void> {
    if (this.#run !== run || this.#status.state !== 'running' || run.sampling || !run.analyzer)
      return
    if (this.#isResourceConstrained()) {
      this.#setStatus({ lastGateReason: 'voice-resource-priority' })
      return
    }
    run.sampling = true
    try {
      this.#setStatus({ captureAttemptCount: this.#status.captureAttemptCount + 1 })
      const frameId = this.#id('frame')
      const observationId = this.#id('observation')
      const result = await this.#capture.captureFrame({
        frameId,
        observationId,
        sessionId: run.sessionId,
        sourceId: run.sourceId,
        generation: run.generation,
        sensitiveSurface: this.#status.sensitiveSurfacePaused,
      })
      if (this.#run !== run) {
        if (result.accepted)
          result.frame.release('generation-switched')
        return
      }
      this.#setStatus({ lastGateReason: result.decision.reason })
      if (!result.accepted) {
        this.#setStatus({ gateDroppedFrameCount: this.#status.gateDroppedFrameCount + 1 })
        return
      }

      const offer = run.analyzer.offer(result.frame)
      this.#setStatus({
        acceptedFrameCount: this.#status.acceptedFrameCount + 1,
        analyzerReplacedFrameCount: this.#status.analyzerReplacedFrameCount + (offer === 'queued-latest' ? 1 : 0),
        lastFrameAcceptedAt: this.#now(),
      })
    }
    catch (error) {
      if (this.#run === run)
        await this.#cleanup('failed', stableErrorCode(error), 'source-ended', true)
    }
    finally {
      run.sampling = false
    }
  }

  #handleAnalyzerError(run: ActiveRun, code: LocalScreenAnalyzerControllerErrorCode): void {
    if (this.#run !== run)
      return
    this.#setStatus({ lastErrorCode: code })
  }

  #publishSnapshot(run: ActiveRun): void {
    if (this.#run !== run)
      return
    run.downstream.evaluate(run.manager)
    const snapshot = run.manager.snapshot()
    const facts = run.manager.listFacts()
    this.#setStatus({ acceptedFactCount: snapshot.acceptedFactIds.length })
    this.#onSnapshot?.(snapshot)
    this.#onObservability?.(createPerceptionObservabilitySnapshot({ facts, snapshot }))
    this.#onProjection?.(createPerceptionContextProjection({
      facts,
      snapshot,
      now: this.#now(),
    }))
  }

  async #cleanup(
    targetState: LocalScreenPerceptionState,
    errorCode: string | undefined,
    revokeReason: Parameters<LocalScreenConsentClient['revoke']>[3],
    stopLifecycle: boolean,
    pauseLifecycle = false,
  ): Promise<void> {
    if (this.#operation)
      return await this.#operation
    const run = this.#run
    if (!run)
      return
    this.#run = undefined
    this.#setStatus({ state: 'stopping', lastErrorCode: errorCode })
    this.#operation = (async () => {
      if (run.timer)
        this.#clearInterval(run.timer)
      run.timer = undefined
      await run.analyzer?.stop().catch(() => undefined)
      run.manager.setSourceHealth({ sourceId: run.sourceId, sourceKind: 'screen', status: targetState === 'failed' ? 'failed' : 'stopped', updatedAt: this.#now(), errorCode })
      if (run.captureExclusionEnabled) {
        await this.#consent.setCaptureExclusion(run.sessionId, run.generation, run.grant.grantId, false).catch(() => undefined)
        run.captureExclusionEnabled = false
      }
      if (run.consentRegistered) {
        await this.#consent.revoke(run.sessionId, run.generation, run.grant.grantId, revokeReason).catch(() => undefined)
        run.consentRegistered = false
      }
      if (stopLifecycle) {
        if (pauseLifecycle)
          await run.lifecycle.pause()
        else
          await run.lifecycle.stop()
      }
      this.#capture.stop()
      run.manager.revokeAll(targetState === 'failed' ? 'source-revoked' : 'session-stopped')
      run.downstream.cancelAll(run.manager)
      this.#onObservability?.(null)
      this.#onProjection?.(null)
      this.#setStatus({
        state: targetState,
        sessionId: targetState === 'paused' || targetState === 'failed' ? run.sessionId : undefined,
        generation: targetState === 'paused' || targetState === 'failed' ? run.session.session.generation : 0,
        samplingRate: this.#samplingRate,
        sourceId: targetState === 'paused' || targetState === 'failed' ? run.sourceId : undefined,
        modelId: undefined,
        acceptedFactCount: 0,
        lastIngestOutcome: undefined,
        lastSuppressionReason: undefined,
        lastConfidence: undefined,
        sensitiveSurfacePaused: false,
        lastGateReason: undefined,
        lastErrorCode: errorCode,
      })
    })().finally(() => {
      this.#operation = undefined
    })
    await this.#operation
  }

  #fail(code: string): LocalScreenPerceptionStatus {
    this.#setStatus({ state: 'failed', lastErrorCode: code })
    return this.status
  }

  #setStatus(patch: Partial<LocalScreenPerceptionStatus>): void {
    this.#status = { ...this.#status, ...patch }
    this.#onStatus?.(this.status)
  }
}

function stableErrorCode(error: unknown): string {
  if (error instanceof Error && /^[a-z][a-z0-9-]{1,79}$/u.test(error.message))
    return error.message
  return 'screen-perception-failed'
}
