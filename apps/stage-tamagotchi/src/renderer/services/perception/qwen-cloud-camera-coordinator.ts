import type { PerceptionConsentGrant, PerceptionContextProjection, PerceptionObservabilitySnapshot, PerceptionSamplingRate } from '@proj-airi/stage-ui/domains/perception'

import type { LocalCameraPerceptionStatus } from './local-camera-perception-coordinator'
import type { ProductionCameraFrame } from './production-camera-capture'
import type { CloudMicrophoneLease } from './qwen-cloud-screen-coordinator'
import type { QwenCloudWindowRunnerStatus } from './qwen-cloud-window-runner'

import {
  defaultPerceptionSamplingRate,
  PERCEPTION_CONTRACT_VERSION,
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'

import { QwenCloudCameraFrameEncoder } from './qwen-cloud-camera-frame-encoder'
import { QwenCloudPcmCapture } from './qwen-cloud-pcm-capture'
import { QwenCloudWindowRunner } from './qwen-cloud-window-runner'

export interface QwenCloudCameraStatus extends QwenCloudWindowRunnerStatus {
  captureState: 'idle' | 'starting' | 'running' | 'paused' | 'failed'
  resolution: '640x360'
  privacyMode: boolean
  samplingRate: PerceptionSamplingRate
  localGeneration?: number
}

export interface CloudLocalCameraLease {
  sessionId: string
  generation: number
  release: () => void | Promise<void>
}

export function createGenerationScopedLocalCameraLease(input: {
  sessionId: string
  generation: number
  getStatus: () => LocalCameraPerceptionStatus
  stop: () => Promise<void>
}): CloudLocalCameraLease {
  let released = false
  return {
    sessionId: input.sessionId,
    generation: input.generation,
    async release() {
      if (released)
        return
      released = true
      const status = input.getStatus()
      if (status.sessionId === input.sessionId && status.generation === input.generation)
        await input.stop()
    },
  }
}

export interface QwenCloudCameraCoordinatorOptions {
  getLocalStatus: () => LocalCameraPerceptionStatus
  startLocalMixed: (signal: AbortSignal) => Promise<CloudLocalCameraLease>
  stopLocalGeneration: (sessionId: string, generation: number) => Promise<void>
  subscribeFrames: (listener: (frame: ProductionCameraFrame) => void) => () => void
  acquireMicrophone: (grant: PerceptionConsentGrant, signal: AbortSignal) => Promise<CloudMicrophoneLease>
  getPersonPresent: () => boolean
  isAudioAllowed: () => boolean
  samplingRate?: PerceptionSamplingRate
  now?: () => number
  monotonicNow?: () => number
  id?: (prefix: string) => string
  onStatus?: (status: QwenCloudCameraStatus) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
}

interface ActiveRun {
  epoch: number
  sessionId: string
  generation: number
  localGeneration: number
  runner: QwenCloudWindowRunner
  pcm: QwenCloudPcmCapture
  encoder: QwenCloudCameraFrameEncoder
  microphone: CloudMicrophoneLease
  unsubscribeFrames: () => void
  localLease?: CloudLocalCameraLease
}

interface StartingRun {
  epoch: number
  controller: AbortController
  cancelled: boolean
  generation: number
  localGeneration: number
  localLease?: CloudLocalCameraLease
  runner?: QwenCloudWindowRunner
  pcm?: QwenCloudPcmCapture
  encoder?: QwenCloudCameraFrameEncoder
  microphone?: CloudMicrophoneLease
  unsubscribeFrames?: () => void
}

export class QwenCloudCameraCoordinator {
  readonly #options: QwenCloudCameraCoordinatorOptions
  readonly #now: () => number
  readonly #monotonicNow: () => number
  readonly #id: (prefix: string) => string
  #epoch = 0
  #retirement?: Promise<void>
  #starting?: StartingRun
  #run?: ActiveRun
  #privacyMode = false
  #samplingRate: PerceptionSamplingRate
  #status: QwenCloudCameraStatus = initialStatus()

  constructor(options: QwenCloudCameraCoordinatorOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#id = options.id ?? (prefix => `${prefix}:camera-cloud:${crypto.randomUUID()}`)
    this.#samplingRate = options.samplingRate ?? defaultPerceptionSamplingRate('camera')
  }

  get status(): QwenCloudCameraStatus {
    return { ...this.#status }
  }

  setSamplingRate(rate: PerceptionSamplingRate): void {
    if (this.#samplingRate === rate)
      return
    this.#samplingRate = rate
    this.#setStatus({ samplingRate: rate })
  }

  isUsingLocalStatus(status: LocalCameraPerceptionStatus): boolean {
    const run = this.#run
    return !!run
      && status.state === 'running'
      && status.processingMode === 'mixed'
      && status.sessionId === run.sessionId
      && status.generation === run.localGeneration
  }

  async start(frameConsentConfirmed: boolean, audioConsentConfirmed: boolean): Promise<QwenCloudCameraStatus> {
    if (this.#run || this.#starting || this.#status.captureState === 'starting')
      return this.status
    if (!frameConsentConfirmed || !audioConsentConfirmed)
      return this.#fail('permission-denied')
    await this.#awaitRetirement()
    if (this.#run || this.#starting)
      return this.status
    const starting = createStartingRun(++this.#epoch, this.#status.generation)
    this.#setStatus({ ...initialStatus(), captureState: 'starting', generation: starting.generation, lastErrorCode: undefined, samplingRate: this.#samplingRate })
    this.#starting = starting
    try {
      let local = this.#options.getLocalStatus()
      if (local.state === 'running' && local.processingMode !== 'mixed') {
        if (!local.sessionId || local.generation < 1)
          return this.#fail('cloud-camera-local-lane-unavailable')
        await this.#options.stopLocalGeneration(local.sessionId, local.generation)
        if (!this.#isCurrentStart(starting)) {
          await this.#cleanupStarting(starting, 'user-stop')
          return this.status
        }
        local = this.#options.getLocalStatus()
      }
      if (local.state !== 'running') {
        try {
          starting.localLease = await this.#options.startLocalMixed(starting.controller.signal)
        }
        catch {
          const status = await this.#failStarting(starting, 'cloud-camera-local-lane-unavailable')
          return status
        }
        if (!this.#isCurrentStart(starting)) {
          await this.#cleanupStarting(starting, 'user-stop')
          return this.status
        }
        local = this.#options.getLocalStatus()
      }
      if (local.state !== 'running' || local.processingMode !== 'mixed' || !local.sessionId || !local.sourceId || local.generation < 1) {
        await this.#cleanupStarting(starting, 'source-ended')
        return this.#fail('cloud-camera-local-lane-unavailable')
      }
      if (starting.localLease && (starting.localLease.sessionId !== local.sessionId || starting.localLease.generation !== local.generation)) {
        await this.#cleanupStarting(starting, 'source-ended')
        return this.#fail('stale-generation')
      }
      starting.localGeneration = local.generation
      starting.generation = Math.max(starting.generation, local.generation)
      this.#setStatus({ generation: starting.generation })

      const grants = createGrants({ sourceId: local.sourceId, now: this.#now, id: this.#id })
      try {
        starting.microphone = await this.#options.acquireMicrophone(grants.audio, starting.controller.signal)
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
        isAudioAllowed: this.#options.isAudioAllowed,
        now: this.#now,
        id: this.#id,
        onStatus: status => this.#handleRunnerStatus(run, status),
        onProjection: this.#options.onProjection,
        onObservability: this.#options.onObservability,
      })
      starting.runner = runner
      runner.start({
        sessionId: local.sessionId,
        generation: starting.generation,
        sourceKind: 'camera-cloud',
        sourceId: local.sourceId,
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

      const encoder = new QwenCloudCameraFrameEncoder({
        generation: starting.localGeneration,
        getPersonPresent: this.#options.getPersonPresent,
        getBusy: () => runner.status.uploadActive,
        getPrivacyMode: () => this.#privacyMode,
        onFrame: frame => runner.offerFrame(frame),
        onError: (errorCode) => {
          void this.#retireRun(run, 'source-ended', {
            ...initialStatus(),
            captureState: 'failed',
            state: 'failed',
            generation: Math.max(this.#status.generation, run.generation) + 1,
            localGeneration: run.localGeneration,
            lastErrorCode: errorCode,
            privacyMode: this.#privacyMode,
            samplingRate: this.#samplingRate,
          })
        },
        monotonicNow: this.#monotonicNow,
        id: this.#id,
      })
      starting.encoder = encoder
      const unsubscribeFrames = this.#options.subscribeFrames(frame => encoder.offer(frame))
      starting.unsubscribeFrames = unsubscribeFrames
      run = {
        epoch: starting.epoch,
        sessionId: local.sessionId,
        generation: starting.generation,
        localGeneration: starting.localGeneration,
        runner,
        pcm,
        encoder,
        microphone: starting.microphone,
        unsubscribeFrames,
        localLease: starting.localLease,
      }
      starting.runner = undefined
      starting.pcm = undefined
      starting.encoder = undefined
      starting.microphone = undefined
      starting.unsubscribeFrames = undefined
      starting.localLease = undefined
      this.#run = run
      this.#starting = undefined
      this.#setStatus({ captureState: 'running', state: 'running', sessionId: local.sessionId, generation: starting.generation, localGeneration: starting.localGeneration, sourceKind: 'camera-cloud', modelId: QWEN_FLASH_REALTIME_MODEL_ID, samplingRate: this.#samplingRate })
      return this.status
    }
    finally {
      if (this.#starting === starting)
        this.#starting = undefined
    }
  }

  setPrivacyMode(enabled: boolean): void {
    this.#privacyMode = enabled
    if (enabled)
      this.#run?.runner.blockForEcho()
    this.#setStatus({ privacyMode: enabled })
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
        () => this.#setStatus({ ...initialStatus(), generation: Math.max(this.#status.generation, starting.generation) + 1, privacyMode: this.#privacyMode, samplingRate: this.#samplingRate }),
        () => this.#options.onProjection?.(null),
        () => this.#options.onObservability?.(null),
      ])
      void this.#cleanupStarting(starting, reason)
      return
    }
    const run = this.#run
    if (!run) {
      await this.#awaitRetirement()
      if (this.#run || this.#starting)
        return
      await settleCleanups([
        () => this.#setStatus({ ...initialStatus(), generation: this.#status.generation, privacyMode: this.#privacyMode, samplingRate: this.#samplingRate }),
        () => this.#options.onProjection?.(null),
        () => this.#options.onObservability?.(null),
      ])
      return
    }
    await this.#retireRun(run, reason, {
      ...initialStatus(),
      generation: Math.max(this.#status.generation, run.generation) + 1,
      privacyMode: this.#privacyMode,
      samplingRate: this.#samplingRate,
    })
  }

  async pause(): Promise<void> {
    await this.stop('user-stop')
    this.#setStatus({ captureState: 'paused' })
  }

  #isCurrentStart(starting: StartingRun): boolean {
    return this.#starting === starting && starting.epoch === this.#epoch && !starting.cancelled && !starting.controller.signal.aborted
  }

  async #cleanupStarting(starting: StartingRun, reason: string): Promise<void> {
    starting.controller.abort(reason)
    const unsubscribeFrames = starting.unsubscribeFrames
    const encoder = starting.encoder
    const runner = starting.runner
    const pcm = starting.pcm
    const microphone = starting.microphone
    const localLease = starting.localLease
    starting.unsubscribeFrames = undefined
    starting.encoder = undefined
    starting.microphone = undefined
    starting.localLease = undefined
    await settleCleanups([
      () => unsubscribeFrames?.(),
      () => encoder?.stop(),
      () => runner?.stop(reason),
      () => pcm?.stop(),
      () => microphone?.release(),
      () => localLease?.release(),
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
    void this.#retireRun(run, errorCode, { ...status, captureState: 'failed', localGeneration: run.localGeneration, lastErrorCode: errorCode })
  }

  #retireRun(run: ActiveRun, reason: string, status: Partial<QwenCloudCameraStatus>): Promise<void> {
    if (this.#run !== run || run.epoch !== this.#epoch)
      return this.#awaitRetirement()
    this.#run = undefined
    this.#epoch += 1
    let resolveRetirement!: () => void
    const retirement = new Promise<void>((resolve) => {
      resolveRetirement = resolve
    })
    this.#retirement = retirement
    void retirement.finally(() => {
      if (this.#retirement === retirement)
        this.#retirement = undefined
    })
    try {
      this.#setStatus(status)
    }
    finally {
      void settleCleanups([
        () => this.#options.onProjection?.(null),
        () => this.#options.onObservability?.(null),
        () => run.unsubscribeFrames(),
        () => run.encoder.stop(),
        () => run.runner.stop(reason),
        () => run.pcm.stop(),
        () => run.microphone.release(),
        () => run.localLease?.release(),
      ]).then(resolveRetirement, resolveRetirement)
    }
    return retirement
  }

  async #awaitRetirement(): Promise<void> {
    const retirement = this.#retirement
    if (retirement)
      await retirement
  }

  async #failStarting(starting: StartingRun, errorCode: string): Promise<QwenCloudCameraStatus> {
    const ownedCurrentStart = this.#isCurrentStart(starting)
    await this.#cleanupStarting(starting, 'source-ended')
    if (ownedCurrentStart && this.#starting === starting && starting.epoch === this.#epoch)
      return this.#fail(errorCode)
    return this.status
  }

  #fail(code: string): QwenCloudCameraStatus {
    this.#setStatus({ captureState: 'failed', state: 'failed', lastErrorCode: code })
    return this.status
  }

  #setStatus(patch: Partial<QwenCloudCameraStatus>): void {
    this.#status = { ...this.#status, ...patch }
    this.#options.onStatus?.(this.status)
  }
}

function createStartingRun(epoch: number, generation: number): StartingRun {
  return { epoch, controller: new AbortController(), cancelled: false, generation, localGeneration: 0 }
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

function createGrants(input: { sourceId: string, now: () => number, id: (prefix: string) => string }) {
  const base = {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    sourceKind: 'camera' as const,
    sourceId: input.sourceId,
    processingMode: 'mixed' as const,
    allowedFactCategories: ['person.presence', 'person.count', 'person.pose', 'person.gesture', 'person.observable-cue', 'person.activity-like', 'environment.lighting', 'environment.scene', 'object.presence'],
    cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
    cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
    regionId: QWEN_CLOUD_REGION_ID,
    costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
    grantedAt: input.now(),
    showPersistentIndicator: true,
  }
  return {
    frame: { ...base, grantId: input.id('grant:frame'), allowedModalities: ['camera-frames'] } as PerceptionConsentGrant,
    audio: { ...base, grantId: input.id('grant:audio'), allowedModalities: ['microphone-audio'] } as PerceptionConsentGrant,
  }
}

function initialStatus(): QwenCloudCameraStatus {
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
    resolution: '640x360',
    privacyMode: false,
    samplingRate: defaultPerceptionSamplingRate('camera'),
  }
}
