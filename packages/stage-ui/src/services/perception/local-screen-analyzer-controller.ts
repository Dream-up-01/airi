import type {
  LocalScreenAnalyzerProfile,
  ObjectivePerceptionEvent,
  PerceptionConsentGrant,
  PerceptionIngestResult,
  PerceptionStateManager,
} from '../../domains/perception'
import type {
  LocalOllamaScreenErrorCode,
} from './local-ollama-screen-runtime'
import type { LocalScreenObjectiveEnvelope } from './local-screen-objective-parser'
import type { LocalTransformersScreenErrorCode } from './local-transformers-screen-runtime'
import type { EphemeralScreenFrame } from './screen-latest-frame'

import {
  LOCAL_SCREEN_SEMANTIC_MODEL_ID,
  LocalOllamaScreenError,
} from './local-ollama-screen-runtime'
import { LocalTransformersScreenError } from './local-transformers-screen-runtime'
import { ScreenLatestFrameScheduler } from './screen-latest-frame'

export interface LocalScreenRuntimePort {
  validate: (signal?: AbortSignal) => Promise<{ profile: LocalScreenAnalyzerProfile }>
  analyze: (request: {
    jpegFrames: Uint8Array[]
    envelope: LocalScreenObjectiveEnvelope
    signal?: AbortSignal
  }) => Promise<{
    events: ObjectivePerceptionEvent[]
    totalDurationMs: number
    loadDurationMs: number
    promptTokenCount: number
    outputTokenCount: number
  }>
  stop: () => Promise<void>
}

export interface LocalScreenEphemeralJpegFrame extends EphemeralScreenFrame {
  observationId: string
  sessionId: string
  sourceId: string
  jpegBytes: Uint8Array
}

export type LocalScreenAnalyzerControllerErrorCode
  = LocalOllamaScreenErrorCode
    | LocalTransformersScreenErrorCode
    | 'screen-frame-metadata-invalid'
    | 'screen-runtime-capability-mismatch'
    | 'screen-runtime-start-cancelled'

export interface LocalScreenAnalyzerControllerOptions {
  sessionId: string
  sourceId: string
  generation: number
  adapterId?: string
  runtime: LocalScreenRuntimePort
  stateManager: PerceptionStateManager
  getConsentGrant: () => PerceptionConsentGrant | undefined
  isSourceHealthy: () => boolean
  nextEventId?: (observationId: string, index: number) => string
  onIngestResult?: (result: PerceptionIngestResult) => void
  onError?: (code: LocalScreenAnalyzerControllerErrorCode) => void
}

export type LocalScreenAnalyzerStartResult
  = { ok: true, profile: LocalScreenAnalyzerProfile }
    | { ok: false, code: LocalScreenAnalyzerControllerErrorCode }

/**
 * The production-safe bridge from ephemeral local JPEGs to the sole fact writer.
 * It has no chat, context, TTS, tool, memory or persistence dependency.
 */
export class LocalScreenAnalyzerController {
  readonly #sessionId: string
  readonly #sourceId: string
  readonly #generation: number
  readonly #adapterId: string
  readonly #runtime: LocalScreenRuntimePort
  readonly #stateManager: PerceptionStateManager
  readonly #getConsentGrant: () => PerceptionConsentGrant | undefined
  readonly #isSourceHealthy: () => boolean
  readonly #nextEventId: (observationId: string, index: number) => string
  readonly #onIngestResult?: (result: PerceptionIngestResult) => void
  readonly #onError?: (code: LocalScreenAnalyzerControllerErrorCode) => void
  readonly #scheduler: ScreenLatestFrameScheduler<LocalScreenEphemeralJpegFrame>
  #lifecycle = new AbortController()
  #starting = false
  #ready = false
  #profile?: LocalScreenAnalyzerProfile
  #stopped = false

  constructor(options: LocalScreenAnalyzerControllerOptions) {
    if (!options.sessionId || !options.sourceId || !Number.isInteger(options.generation) || options.generation < 1)
      throw new Error('local_screen_analyzer_options_invalid')
    this.#sessionId = options.sessionId
    this.#sourceId = options.sourceId
    this.#generation = options.generation
    this.#adapterId = options.adapterId ?? 'screen:ollama-local'
    this.#runtime = options.runtime
    this.#stateManager = options.stateManager
    this.#getConsentGrant = options.getConsentGrant
    this.#isSourceHealthy = options.isSourceHealthy
    this.#nextEventId = options.nextEventId ?? ((observationId, index) => `${observationId}:event:${index}`)
    this.#onIngestResult = options.onIngestResult
    this.#onError = options.onError
    this.#scheduler = new ScreenLatestFrameScheduler({
      generation: options.generation,
      process: (frame, signal) => this.#process(frame, signal),
    })
  }

  async start(): Promise<LocalScreenAnalyzerStartResult> {
    if (this.#stopped || this.#lifecycle.signal.aborted)
      return { ok: false, code: 'screen-runtime-start-cancelled' }
    if (this.#profile)
      return { ok: true, profile: this.#profile }
    if (this.#starting)
      return { ok: false, code: 'screen-runtime-busy' }
    this.#starting = true
    try {
      const validation = await this.#runtime.validate(this.#lifecycle.signal)
      if (this.#lifecycle.signal.aborted || this.#stopped)
        return { ok: false, code: 'screen-runtime-start-cancelled' }
      if (validation.profile.generation !== this.#generation || validation.profile.modelId !== LOCAL_SCREEN_SEMANTIC_MODEL_ID) {
        this.#onError?.('model-identity-mismatch')
        await this.#runtime.stop()
        return { ok: false, code: 'model-identity-mismatch' }
      }
      if (validation.profile.state !== 'ready'
        || !validation.profile.capabilities.includes('single-image')
        || !validation.profile.capabilities.includes('multi-image')
        || !validation.profile.capabilities.includes('strict-json-schema')) {
        this.#onError?.('screen-runtime-capability-mismatch')
        await this.#runtime.stop()
        return { ok: false, code: 'screen-runtime-capability-mismatch' }
      }
      this.#ready = true
      this.#profile = validation.profile
      return { ok: true, profile: validation.profile }
    }
    catch (error) {
      const code = this.#lifecycle.signal.aborted
        ? 'screen-runtime-start-cancelled'
        : stableRuntimeError(error)
      this.#onError?.(code)
      return { ok: false, code }
    }
    finally {
      this.#starting = false
    }
  }

  offer(frame: LocalScreenEphemeralJpegFrame): 'processing' | 'queued-latest' | 'rejected' {
    if (!this.#ready || this.#stopped) {
      frame.release('analyzer-not-ready')
      return 'rejected'
    }
    if (frame.sessionId !== this.#sessionId
      || frame.sourceId !== this.#sourceId
      || frame.byteLength !== frame.jpegBytes.byteLength) {
      frame.release('invalid-frame-metadata')
      this.#onError?.('screen-frame-metadata-invalid')
      return 'rejected'
    }
    return this.#scheduler.offer(frame)
  }

  async stop(): Promise<void> {
    if (this.#stopped)
      return
    this.#stopped = true
    this.#ready = false
    this.#profile = undefined
    this.#lifecycle.abort('local-screen-analyzer-stopped')
    this.#scheduler.stop()
    this.#stateManager.revokeSource(this.#sourceId, 'source-revoked')
    await this.#runtime.stop()
  }

  async #process(frame: LocalScreenEphemeralJpegFrame, signal: AbortSignal): Promise<void> {
    try {
      const result = await this.#runtime.analyze({
        jpegFrames: [frame.jpegBytes],
        envelope: {
          observationId: frame.observationId,
          sessionId: frame.sessionId,
          generation: frame.generation,
          sourceId: frame.sourceId,
          observedAt: frame.capturedAt,
          eventId: index => this.#nextEventId(frame.observationId, index),
          adapterId: this.#adapterId,
          runtimeModelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
        },
        signal,
      })
      for (const event of result.events) {
        const ingest = this.#stateManager.ingest(event, {
          consentGrant: this.#getConsentGrant(),
          sourceHealthy: this.#isSourceHealthy(),
        })
        this.#onIngestResult?.(ingest)
      }
    }
    catch (error) {
      if (!signal.aborted)
        this.#onError?.(stableRuntimeError(error))
      throw error
    }
  }
}

function stableRuntimeError(error: unknown): LocalScreenAnalyzerControllerErrorCode {
  if (error instanceof LocalOllamaScreenError || error instanceof LocalTransformersScreenError)
    return error.code
  return 'runtime-unavailable'
}
