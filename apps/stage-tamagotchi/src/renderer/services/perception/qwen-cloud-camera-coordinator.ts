import type { PerceptionConsentGrant, PerceptionContextProjection, PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'

import type { LocalCameraPerceptionStatus } from './local-camera-perception-coordinator'
import type { ProductionCameraFrame } from './production-camera-capture'
import type { CloudMicrophoneLease } from './qwen-cloud-screen-coordinator'
import type { QwenCloudWindowRunnerStatus } from './qwen-cloud-window-runner'

import {
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
}

export interface QwenCloudCameraCoordinatorOptions {
  getLocalStatus: () => LocalCameraPerceptionStatus
  startLocalMixed: () => Promise<void>
  stopLocal: () => Promise<void>
  subscribeFrames: (listener: (frame: ProductionCameraFrame) => void) => () => void
  acquireMicrophone: (grant: PerceptionConsentGrant) => Promise<CloudMicrophoneLease>
  getPersonPresent: () => boolean
  isAudioAllowed: () => boolean
  now?: () => number
  monotonicNow?: () => number
  id?: (prefix: string) => string
  onStatus?: (status: QwenCloudCameraStatus) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
}

interface ActiveRun {
  sessionId: string
  generation: number
  runner: QwenCloudWindowRunner
  pcm: QwenCloudPcmCapture
  encoder: QwenCloudCameraFrameEncoder
  microphone: CloudMicrophoneLease
  unsubscribeFrames: () => void
}

export class QwenCloudCameraCoordinator {
  readonly #options: QwenCloudCameraCoordinatorOptions
  readonly #now: () => number
  readonly #monotonicNow: () => number
  readonly #id: (prefix: string) => string
  #run?: ActiveRun
  #privacyMode = false
  #status: QwenCloudCameraStatus = initialStatus()

  constructor(options: QwenCloudCameraCoordinatorOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#id = options.id ?? (prefix => `${prefix}:camera-cloud:${crypto.randomUUID()}`)
  }

  get status(): QwenCloudCameraStatus {
    return { ...this.#status }
  }

  async start(consentConfirmed: boolean): Promise<QwenCloudCameraStatus> {
    if (this.#run || this.#status.captureState === 'starting')
      return this.#fail('cloud-camera-busy')
    if (!consentConfirmed)
      return this.#fail('permission-denied')
    this.#setStatus({ ...initialStatus(), captureState: 'starting' })

    let local = this.#options.getLocalStatus()
    if (local.state === 'running' && local.processingMode !== 'mixed') {
      await this.#options.stopLocal()
      local = this.#options.getLocalStatus()
    }
    if (local.state !== 'running') {
      await this.#options.startLocalMixed()
      local = this.#options.getLocalStatus()
    }
    if (local.state !== 'running' || local.processingMode !== 'mixed' || !local.sessionId || !local.sourceId || local.generation < 1)
      return this.#fail('cloud-camera-local-lane-unavailable')

    const grants = createGrants({ sourceId: local.sourceId, now: this.#now, id: this.#id })
    let microphone: CloudMicrophoneLease
    try {
      microphone = await this.#options.acquireMicrophone(grants.audio)
    }
    catch {
      return this.#fail('cloud-microphone-unavailable')
    }

    let run!: ActiveRun
    const runner = new QwenCloudWindowRunner({
      isAudioAllowed: this.#options.isAudioAllowed,
      now: this.#now,
      id: this.#id,
      onStatus: status => this.#run === run && this.#setStatus(status),
      onProjection: this.#options.onProjection,
      onObservability: this.#options.onObservability,
    })
    runner.start({
      sessionId: local.sessionId,
      generation: local.generation,
      sourceKind: 'camera-cloud',
      sourceId: local.sourceId,
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      frameGrant: grants.frame,
      audioGrant: grants.audio,
    })
    const pcm = new QwenCloudPcmCapture({ onChunk: chunk => runner.offerAudio(chunk), now: this.#now, monotonicNow: this.#monotonicNow })
    try {
      await pcm.start(microphone.stream)
    }
    catch {
      microphone.release()
      await runner.stop('source-ended')
      return this.#fail('cloud-pcm-unavailable')
    }
    const encoder = new QwenCloudCameraFrameEncoder({
      generation: local.generation,
      getPersonPresent: this.#options.getPersonPresent,
      getBusy: () => runner.status.uploadActive,
      getPrivacyMode: () => this.#privacyMode,
      onFrame: frame => runner.offerFrame(frame),
      onError: (errorCode) => {
        if (this.#run !== run)
          return
        void this.stop('source-ended').then(() => this.#fail(errorCode))
      },
      monotonicNow: this.#monotonicNow,
      id: this.#id,
    })
    const unsubscribeFrames = this.#options.subscribeFrames(frame => encoder.offer(frame))
    run = {
      sessionId: local.sessionId,
      generation: local.generation,
      runner,
      pcm,
      encoder,
      microphone,
      unsubscribeFrames,
    }
    this.#run = run
    this.#setStatus({ captureState: 'running', state: 'running', sessionId: local.sessionId, generation: local.generation, sourceKind: 'camera-cloud', modelId: QWEN_FLASH_REALTIME_MODEL_ID })
    return this.status
  }

  setPrivacyMode(enabled: boolean): void {
    this.#privacyMode = enabled
    if (enabled)
      this.#run?.runner.blockForEcho()
    this.#setStatus({ privacyMode: enabled })
  }

  async stop(reason = 'user-stop'): Promise<void> {
    const run = this.#run
    if (!run) {
      this.#setStatus({ ...initialStatus(), privacyMode: this.#privacyMode })
      return
    }
    this.#run = undefined
    run.unsubscribeFrames()
    run.encoder.stop()
    await run.runner.stop(reason)
    await run.pcm.stop()
    run.microphone.release()
    this.#options.onProjection?.(null)
    this.#options.onObservability?.(null)
    this.#setStatus({ ...initialStatus(), generation: run.generation + 1, privacyMode: this.#privacyMode })
  }

  async pause(): Promise<void> {
    await this.stop('user-stop')
    this.#setStatus({ captureState: 'paused' })
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
  }
}
