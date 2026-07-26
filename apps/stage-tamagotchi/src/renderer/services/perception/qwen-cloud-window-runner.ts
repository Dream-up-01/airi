import type {
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
  PerceptionStateSnapshot,
  ScreenModelRouteReason,
} from '@proj-airi/stage-ui/domains/perception'

import type { PerceptionMediaTransportMessage } from '../../../shared/eventa/perception'
import type { QwenCloudMediaClientRun } from './qwen-cloud-media-client'
import type { QwenCloudPcmChunk } from './qwen-cloud-pcm-capture'

import {
  createPerceptionContextProjection,
  createPerceptionObservabilitySnapshot,
  PerceptionStateManager,
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_PLUS_REALTIME_MODEL_ID,
  ScreenCloudRouteController,
} from '@proj-airi/stage-ui/domains/perception'
import { parseQwenCloudObjectiveResponse, PerceptionDownstreamPolicyController } from '@proj-airi/stage-ui/services/perception'

import {
  MAX_PERCEPTION_JPEG_BYTES,
  PERCEPTION_AUDIO_FORMAT,
  PERCEPTION_MEDIA_TRANSPORT_VERSION,
} from '../../../shared/eventa/perception'
import { QwenCloudMediaClient } from './qwen-cloud-media-client'

const MAX_AUDIO_CHUNKS = 50
const MAX_SCREEN_KEYFRAMES = 24
const SCREEN_KEYFRAME_TTL_MS = 240_000

type QwenCloudImageFrame = Pick<QwenCloudFrameCandidate, 'capturedAt' | 'jpeg' | 'monotonicTimestamp' | 'width' | 'height'>

export interface QwenCloudFrameCandidate {
  frameId: string
  observationId: string
  capturedAt: number
  monotonicTimestamp: number
  width: number
  height: number
  jpeg: Uint8Array
  release: (reason: 'completed' | 'replaced' | 'stopped' | 'invalid') => void
}

export interface QwenCloudWindowRunnerStatus {
  state: 'idle' | 'running' | 'stopping' | 'failed'
  sessionId?: string
  generation: number
  sourceKind?: 'screen-cloud' | 'camera-cloud'
  modelId?: string
  uploadActive: boolean
  acceptedAudioChunks: number
  droppedAudioChunks: number
  submittedWindows: number
  completedWindows: number
  droppedFrames: number
  acceptedFactCount: number
  lastErrorCode?: string
  activeModelId?: string
  routeReason?: ScreenModelRouteReason
}

export interface QwenCloudWindowRunnerStart {
  sessionId: string
  generation: number
  sourceKind: 'screen-cloud' | 'camera-cloud'
  sourceId: string
  modelId: string
  frameGrant: PerceptionConsentGrant
  audioGrant: PerceptionConsentGrant
}

export interface QwenCloudWindowRunnerOptions {
  client?: { run: (input: QwenCloudMediaClientRun) => Promise<import('../../../shared/eventa/perception').PerceptionMediaCompletedResult> }
  now?: () => number
  id?: (prefix: string) => string
  isAudioAllowed?: () => boolean
  onStatus?: (status: QwenCloudWindowRunnerStatus) => void
  onSnapshot?: (snapshot: PerceptionStateSnapshot) => void
  onProjection?: (projection: PerceptionContextProjection | null) => void
  onObservability?: (snapshot: PerceptionObservabilitySnapshot | null) => void
  isPlusCostAllowed?: () => boolean
}

interface ActiveRun extends QwenCloudWindowRunnerStart {
  manager: PerceptionStateManager
  controller: AbortController
  routeController?: ScreenCloudRouteController
  downstream: PerceptionDownstreamPolicyController
}

export class QwenCloudWindowRunner {
  readonly #client: NonNullable<QwenCloudWindowRunnerOptions['client']>
  readonly #now: () => number
  readonly #id: (prefix: string) => string
  readonly #isAudioAllowed: () => boolean
  readonly #onStatus?: QwenCloudWindowRunnerOptions['onStatus']
  readonly #onSnapshot?: QwenCloudWindowRunnerOptions['onSnapshot']
  readonly #onProjection?: QwenCloudWindowRunnerOptions['onProjection']
  readonly #onObservability?: QwenCloudWindowRunnerOptions['onObservability']
  readonly #isPlusCostAllowed: () => boolean
  readonly #audio: QwenCloudPcmChunk[] = []
  #run?: ActiveRun
  #pendingFrame?: QwenCloudFrameCandidate
  #windowController?: AbortController
  #processing = false
  #status: QwenCloudWindowRunnerStatus = initialStatus()
  #pendingScreenEscalation?: { reason: ScreenModelRouteReason, evidenceFactIds: string[] }
  readonly #screenKeyframes: QwenCloudImageFrame[] = []
  #keyframeExpiryTimer?: ReturnType<typeof setTimeout>

  constructor(options: QwenCloudWindowRunnerOptions = {}) {
    this.#client = options.client ?? new QwenCloudMediaClient()
    this.#now = options.now ?? Date.now
    this.#id = options.id ?? (prefix => `${prefix}:cloud:${crypto.randomUUID()}`)
    this.#isAudioAllowed = options.isAudioAllowed ?? (() => true)
    this.#onStatus = options.onStatus
    this.#onSnapshot = options.onSnapshot
    this.#onProjection = options.onProjection
    this.#onObservability = options.onObservability
    this.#isPlusCostAllowed = options.isPlusCostAllowed ?? (() => true)
  }

  get status(): QwenCloudWindowRunnerStatus {
    return { ...this.#status }
  }

  start(input: QwenCloudWindowRunnerStart): void {
    if (this.#run)
      throw new Error('cloud-window-runner-busy')
    validateStart(input)
    const manager = new PerceptionStateManager({ sessionId: input.sessionId, generation: input.generation, clock: { now: this.#now } })
    manager.setSourceHealth({
      sourceId: input.sourceId,
      sourceKind: input.sourceKind === 'screen-cloud' ? 'screen' : 'camera',
      status: 'healthy',
      updatedAt: this.#now(),
    })
    const run: ActiveRun = { ...input, manager, controller: new AbortController(), downstream: new PerceptionDownstreamPolicyController() }
    if (input.sourceKind === 'screen-cloud') {
      run.routeController = new ScreenCloudRouteController({
        sessionId: input.sessionId,
        generation: input.generation,
        consentGrantId: input.frameGrant.grantId,
        costCounterId: QWEN_CLOUD_COST_BOUNDARY_ID,
        now: this.#now,
        id: () => this.#id('route'),
        isConsentActive: () => this.#run === run && !run.controller.signal.aborted,
        isCostAllowed: this.#isPlusCostAllowed,
      })
    }
    this.#run = run
    this.#setStatus({
      ...initialStatus(),
      state: 'running',
      sessionId: input.sessionId,
      generation: input.generation,
      sourceKind: input.sourceKind,
      modelId: input.modelId,
      activeModelId: input.modelId,
    })
  }

  requestScreenEscalation(reason: ScreenModelRouteReason, evidenceFactIds: string[]): void {
    const run = this.#run
    if (!run?.routeController)
      throw new Error('cloud-screen-route-unavailable')
    const acceptedFactIds = new Set(run.manager.snapshot().acceptedFactIds)
    if (evidenceFactIds.length < 1 || evidenceFactIds.some(factId => !acceptedFactIds.has(factId)))
      throw new Error('cloud-screen-route-evidence-invalid')
    this.#pendingScreenEscalation = { reason, evidenceFactIds: [...evidenceFactIds] }
  }

  offerAudio(chunk: QwenCloudPcmChunk): void {
    if (!this.#run || this.#status.state !== 'running')
      return
    if (!this.#isAudioAllowed()) {
      this.blockForEcho()
      return
    }
    if (!(chunk.pcm instanceof Uint8Array) || chunk.pcm.byteLength === 0 || chunk.pcm.byteLength > 64 * 1024 || chunk.pcm.byteLength % 2 !== 0)
      return
    if (this.#audio.length >= MAX_AUDIO_CHUNKS) {
      zeroChunk(this.#audio.shift())
      this.#setStatus({ droppedAudioChunks: this.#status.droppedAudioChunks + 1 })
    }
    this.#audio.push({ ...chunk, pcm: chunk.pcm.slice() })
    this.#setStatus({ acceptedAudioChunks: this.#status.acceptedAudioChunks + 1 })
  }

  offerFrame(frame: QwenCloudFrameCandidate): void {
    const run = this.#run
    if (!run || this.#status.state !== 'running') {
      frame.release('stopped')
      return
    }
    if (!isValidFrame(frame)) {
      frame.release('invalid')
      this.#setStatus({ droppedFrames: this.#status.droppedFrames + 1 })
      return
    }
    if (this.#pendingFrame) {
      this.#pendingFrame.release('replaced')
      this.#setStatus({ droppedFrames: this.#status.droppedFrames + 1 })
    }
    this.#pendingFrame = frame
    void this.#drain(run)
  }

  blockForEcho(): void {
    this.#clearAudio()
    this.#windowController?.abort('echo-blocked')
    this.#pendingFrame?.release('stopped')
    this.#pendingFrame = undefined
    this.#pendingScreenEscalation = undefined
    this.#clearScreenKeyframes()
  }

  async stop(reason = 'user-stop'): Promise<void> {
    const run = this.#run
    if (!run)
      return
    this.#run = undefined
    this.#setStatus({ state: 'stopping', uploadActive: false })
    run.controller.abort(reason)
    this.#windowController?.abort(reason)
    this.#windowController = undefined
    this.#clearAudio()
    this.#pendingFrame?.release('stopped')
    this.#pendingFrame = undefined
    this.#clearScreenKeyframes()
    run.manager.revokeAll('session-stopped')
    run.downstream.cancelAll(run.manager)
    this.#onProjection?.(null)
    this.#onObservability?.(null)
    this.#setStatus({ ...initialStatus(), generation: run.generation + 1 })
  }

  async #drain(run: ActiveRun): Promise<void> {
    if (this.#processing)
      return
    this.#processing = true
    try {
      while (this.#run === run && this.#pendingFrame) {
        const frame = this.#pendingFrame
        this.#pendingFrame = undefined
        if (this.#audio.length === 0) {
          frame.release('invalid')
          this.#setStatus({ droppedFrames: this.#status.droppedFrames + 1, lastErrorCode: 'cloud-real-audio-required' })
          continue
        }
        const audio = this.#audio.splice(0, this.#audio.length)
        if (run.sourceKind === 'screen-cloud')
          this.#rememberScreenKeyframe(frame)
        await this.#submit(run, frame, audio)
      }
    }
    finally {
      this.#processing = false
    }
  }

  async #submit(run: ActiveRun, frame: QwenCloudFrameCandidate, audio: QwenCloudPcmChunk[]): Promise<void> {
    const windowId = this.#id('window')
    const messages = createMessageStream(run, windowId, frame.observationId, [frame], audio, this.#now())
    this.#setStatus({ uploadActive: true, submittedWindows: this.#status.submittedWindows + 1, lastErrorCode: undefined })
    const windowController = new AbortController()
    this.#windowController = windowController
    const onSessionAbort = () => windowController.abort(run.controller.signal.reason)
    run.controller.signal.addEventListener('abort', onSessionAbort, { once: true })
    try {
      const completed = await this.#client.run({
        sessionId: run.sessionId,
        generation: run.generation,
        windowId,
        frameGrant: run.frameGrant,
        audioGrant: run.audioGrant,
        messages,
        signal: windowController.signal,
      })
      if (this.#run !== run)
        return
      const flash = this.#parseAndIngest(run, frame, windowId, completed)
      if (!flash.ok)
        throw new Error(flash.code)
      const pending = this.#pendingScreenEscalation
      this.#pendingScreenEscalation = undefined
      const minimumConfidence = flash.events.reduce((minimum, event) => Math.min(minimum, event.confidence), 1)
      const routeRequest = pending ?? (flash.events.length > 0 && minimumConfidence < 0.65
        ? { reason: 'flash-low-confidence' as const, evidenceFactIds: flash.factIds }
        : undefined)
      if (routeRequest && run.routeController) {
        const route = run.routeController.request({
          sessionId: run.sessionId,
          generation: run.generation,
          reason: routeRequest.reason,
          evidenceFactIds: routeRequest.evidenceFactIds,
          ...(routeRequest.reason === 'flash-low-confidence' ? { flashConfidence: minimumConfidence } : {}),
        })
        if (route.ok) {
          this.#setStatus({ activeModelId: QWEN_PLUS_REALTIME_MODEL_ID, routeReason: route.decision.reason })
          const plusWindowId = this.#id('window:plus')
          const plusFrameGrant: PerceptionConsentGrant = { ...run.frameGrant, grantId: this.#id('grant:frame:plus'), cloudModelId: QWEN_PLUS_REALTIME_MODEL_ID }
          const plusAudioGrant: PerceptionConsentGrant = { ...run.audioGrant, grantId: this.#id('grant:audio:plus'), cloudModelId: QWEN_PLUS_REALTIME_MODEL_ID }
          try {
            const plusCompleted = await this.#client.run({
              sessionId: run.sessionId,
              generation: run.generation,
              windowId: plusWindowId,
              frameGrant: plusFrameGrant,
              audioGrant: plusAudioGrant,
              messages: createMessageStream(
                { ...run, modelId: QWEN_PLUS_REALTIME_MODEL_ID, frameGrant: plusFrameGrant, audioGrant: plusAudioGrant },
                plusWindowId,
                frame.observationId,
                this.#selectPlusFrames(frame, route.decision.reason),
                audio,
                this.#now(),
              ),
              signal: windowController.signal,
            })
            const plus = this.#parseAndIngest({ ...run, modelId: QWEN_PLUS_REALTIME_MODEL_ID, frameGrant: plusFrameGrant }, frame, plusWindowId, plusCompleted)
            if (!plus.ok)
              throw new Error(plus.code)
          }
          finally {
            run.routeController.finish(route.decision.decisionId)
            this.#clearScreenKeyframes()
            this.#setStatus({ activeModelId: run.modelId, routeReason: undefined })
          }
        }
      }
      this.#publish(run)
      this.#setStatus({ completedWindows: this.#status.completedWindows + 1 })
    }
    catch (error) {
      if (windowController.signal.aborted && windowController.signal.reason === 'echo-blocked') {
        if (this.#run === run)
          this.#setStatus({ lastErrorCode: 'cloud-echo-blocked' })
        return
      }
      if (this.#run === run) {
        run.manager.setSourceHealth({
          sourceId: run.sourceId,
          sourceKind: run.sourceKind === 'screen-cloud' ? 'screen' : 'camera',
          status: 'failed',
          updatedAt: this.#now(),
          errorCode: stableError(error),
        })
        this.#run = undefined
        run.controller.abort('provider-failed')
        this.#clearAudio()
        this.#pendingFrame?.release('stopped')
        this.#pendingFrame = undefined
        this.#clearScreenKeyframes()
        run.manager.revokeAll('source-revoked')
        run.downstream.cancelAll(run.manager)
        this.#onProjection?.(null)
        this.#onObservability?.(null)
        this.#setStatus({ state: 'failed', generation: run.generation + 1, uploadActive: false, acceptedFactCount: 0, lastErrorCode: stableError(error) })
      }
    }
    finally {
      run.controller.signal.removeEventListener('abort', onSessionAbort)
      if (this.#windowController === windowController)
        this.#windowController = undefined
      frame.release('completed')
      audio.forEach(zeroChunk)
      this.#setStatus({ uploadActive: false })
    }
  }

  #parseAndIngest(
    run: ActiveRun,
    frame: QwenCloudFrameCandidate,
    windowId: string,
    completed: import('../../../shared/eventa/perception').PerceptionMediaCompletedResult,
  ): { ok: true, events: import('@proj-airi/stage-ui/domains/perception').ObjectivePerceptionEvent[], factIds: string[] } | { ok: false, code: string } {
    const parsed = parseQwenCloudObjectiveResponse({
      responseId: completed.responseId,
      windowId,
      observationId: frame.observationId,
      sessionId: run.sessionId,
      generation: run.generation,
      modelId: run.modelId,
      completedText: completed.completedText,
    }, {
      windowId,
      observationId: frame.observationId,
      sessionId: run.sessionId,
      generation: run.generation,
      sourceKind: run.sourceKind,
      sourceId: run.sourceId,
      modelId: run.modelId as 'qwen3.5-omni-flash-realtime' | 'qwen3.5-omni-plus-realtime',
      adapterId: 'qwen-realtime:electron-main',
      observedAt: frame.capturedAt,
      eventId: index => this.#id(`event:${index}`),
    })
    if (!parsed.ok)
      return parsed
    const factIds: string[] = []
    for (const event of parsed.events) {
      const result = run.manager.ingest(event, { consentGrant: run.frameGrant, sourceHealthy: true })
      if (result.fact)
        factIds.push(result.fact.factId)
    }
    return { ok: true, events: parsed.events, factIds }
  }

  #publish(run: ActiveRun): void {
    run.downstream.evaluate(run.manager)
    const snapshot = run.manager.snapshot()
    const facts = run.manager.listFacts()
    this.#setStatus({ acceptedFactCount: snapshot.acceptedFactIds.length })
    this.#onSnapshot?.(snapshot)
    this.#onObservability?.(createPerceptionObservabilitySnapshot({ facts, snapshot }))
    this.#onProjection?.(createPerceptionContextProjection({ facts, snapshot, now: this.#now() }))
  }

  #clearAudio(): void {
    this.#audio.splice(0).forEach(zeroChunk)
  }

  #rememberScreenKeyframe(frame: QwenCloudFrameCandidate): void {
    this.#pruneScreenKeyframes()
    while (this.#screenKeyframes.length >= MAX_SCREEN_KEYFRAMES)
      releaseKeyframe(this.#screenKeyframes.shift())
    this.#screenKeyframes.push({
      capturedAt: frame.capturedAt,
      monotonicTimestamp: frame.monotonicTimestamp,
      width: frame.width,
      height: frame.height,
      jpeg: frame.jpeg.slice(),
    })
    this.#scheduleKeyframeExpiry()
  }

  #selectPlusFrames(current: QwenCloudFrameCandidate, reason: ScreenModelRouteReason): QwenCloudImageFrame[] {
    if (reason === 'flash-low-confidence')
      return [current]
    this.#pruneScreenKeyframes()
    return this.#screenKeyframes.length > 0 ? [...this.#screenKeyframes] : [current]
  }

  #pruneScreenKeyframes(): void {
    const cutoff = this.#now() - SCREEN_KEYFRAME_TTL_MS
    while (this.#screenKeyframes[0] && this.#screenKeyframes[0].capturedAt <= cutoff)
      releaseKeyframe(this.#screenKeyframes.shift())
  }

  #scheduleKeyframeExpiry(): void {
    if (this.#keyframeExpiryTimer)
      clearTimeout(this.#keyframeExpiryTimer)
    const first = this.#screenKeyframes[0]
    if (!first) {
      this.#keyframeExpiryTimer = undefined
      return
    }
    this.#keyframeExpiryTimer = setTimeout(() => {
      this.#keyframeExpiryTimer = undefined
      this.#pruneScreenKeyframes()
      this.#scheduleKeyframeExpiry()
    }, Math.max(0, first.capturedAt + SCREEN_KEYFRAME_TTL_MS - this.#now()))
  }

  #clearScreenKeyframes(): void {
    if (this.#keyframeExpiryTimer)
      clearTimeout(this.#keyframeExpiryTimer)
    this.#keyframeExpiryTimer = undefined
    this.#screenKeyframes.splice(0).forEach(releaseKeyframe)
  }

  #setStatus(patch: Partial<QwenCloudWindowRunnerStatus>): void {
    this.#status = { ...this.#status, ...patch }
    this.#onStatus?.(this.status)
  }
}

function createMessageStream(
  run: ActiveRun,
  windowId: string,
  observationId: string,
  frames: readonly QwenCloudImageFrame[],
  audio: QwenCloudPcmChunk[],
  endedAt: number,
): ReadableStream<PerceptionMediaTransportMessage> {
  return new ReadableStream({
    start(controller) {
      const correlation = {
        contractVersion: PERCEPTION_MEDIA_TRANSPORT_VERSION,
        sessionId: run.sessionId,
        generation: run.generation,
        windowId,
      } as const
      controller.enqueue({
        ...correlation,
        type: 'open',
        observationId,
        sourceKind: run.sourceKind,
        sourceId: run.sourceId,
        frameConsentGrantId: run.frameGrant.grantId,
        audioConsentGrantId: run.audioGrant.grantId,
        providerId: run.frameGrant.cloudProviderId!,
        modelId: run.modelId,
        startedAt: audio[0]?.capturedAt ?? frames[0]!.capturedAt,
        monotonicTimestampBase: audio[0]?.monotonicTimestamp ?? frames[0]!.monotonicTimestamp,
      })
      audio.forEach((chunk, sequence) => controller.enqueue({
        ...correlation,
        type: 'audio-chunk',
        sequence,
        capturedAt: chunk.capturedAt,
        monotonicTimestamp: chunk.monotonicTimestamp,
        audioFormat: PERCEPTION_AUDIO_FORMAT,
        pcm: chunk.pcm,
      }))
      frames.forEach((frame, sequence) => controller.enqueue({
        ...correlation,
        type: 'image-frame',
        sequence,
        capturedAt: frame.capturedAt,
        monotonicTimestamp: frame.monotonicTimestamp,
        width: frame.width,
        height: frame.height,
        jpeg: frame.jpeg,
      }))
      controller.enqueue({ ...correlation, type: 'complete', endedAt })
      controller.close()
    },
  })
}

function validateStart(input: QwenCloudWindowRunnerStart): void {
  const expectedFrame = input.sourceKind === 'screen-cloud' ? 'screen-frames' : 'camera-frames'
  if (!input.sessionId || !input.sourceId || input.generation < 1
    || input.frameGrant.allowedModalities[0] !== expectedFrame
    || input.audioGrant.allowedModalities[0] !== 'microphone-audio'
    || input.frameGrant.cloudModelId !== input.modelId
    || input.audioGrant.cloudModelId !== input.modelId) {
    throw new Error('cloud-window-start-invalid')
  }
}

function isValidFrame(frame: QwenCloudFrameCandidate): boolean {
  return !!frame.frameId && !!frame.observationId
    && Number.isInteger(frame.capturedAt)
    && frame.capturedAt >= 0
    && Number.isFinite(frame.monotonicTimestamp)
    && frame.monotonicTimestamp >= 0
    && frame.width > 0
    && frame.height > 0
    && frame.jpeg.byteLength >= 4
    && frame.jpeg.byteLength <= MAX_PERCEPTION_JPEG_BYTES
    && frame.jpeg[0] === 0xFF
    && frame.jpeg[1] === 0xD8
    && frame.jpeg.at(-2) === 0xFF
    && frame.jpeg.at(-1) === 0xD9
}

function zeroChunk(chunk?: QwenCloudPcmChunk): void {
  chunk?.pcm.fill(0)
}

function releaseKeyframe(frame?: QwenCloudImageFrame): void {
  frame?.jpeg.fill(0)
}

function stableError(error: unknown): string {
  return error instanceof Error && /^[a-z][a-z0-9-]{1,79}$/u.test(error.message)
    ? error.message
    : 'cloud-window-failed'
}

function initialStatus(): QwenCloudWindowRunnerStatus {
  return {
    state: 'idle',
    generation: 0,
    uploadActive: false,
    acceptedAudioChunks: 0,
    droppedAudioChunks: 0,
    submittedWindows: 0,
    completedWindows: 0,
    droppedFrames: 0,
    acceptedFactCount: 0,
    activeModelId: undefined,
    routeReason: undefined,
  }
}
