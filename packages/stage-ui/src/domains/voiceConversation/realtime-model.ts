/**
 * Optional realtime-model boundary for voice input.
 *
 * This contract deliberately stops at one validated final transcript. It does
 * not expose model deltas, assistant audio, tool calls, memory writes, or
 * history APIs. A renderer can provide the existing Chat/M1 authority as the
 * final-transcript sink without making this domain aware of that store.
 */

export const REALTIME_MODEL_DEFAULT_ENABLED = false as const
export const REALTIME_MODEL_MAX_TRANSCRIPT_CHARACTERS = 16_000
/**
 * Cancellation must not hold a provider switch indefinitely. Adapters should
 * normally settle as soon as the AbortSignal is observed; this bound is only
 * the last-resort handoff for a provider that does not cooperate promptly.
 */
export const REALTIME_MODEL_CANCEL_WAIT_MS = 250

export type RealtimeModelCancelReason
  = | 'user-stop'
    | 'provider-switch'
    | 'generation-change'
    | 'page-dispose'
    | 'permission-revoked'
    | 'unknown'

export type RealtimeModelErrorCode
  = | 'disabled'
    | 'busy'
    | 'invalid-request'
    | 'cancelled'
    | 'stale-generation'
    | 'response-invalid'
    | 'adapter-error'
    | 'sink-error'

export class RealtimeModelError extends Error {
  constructor(
    readonly code: RealtimeModelErrorCode,
    message: string = code,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'RealtimeModelError'
  }
}

export interface RealtimeModelAdapterRequest {
  /** Correlates one provider request; it is never persisted by this domain. */
  requestId: string
  sessionId: string
  generation: number
  modelId: string
  /** Temporary audio input. Adapters own consumption and release of the stream. */
  audioStream: ReadableStream<ArrayBuffer>
  signal: AbortSignal
}

/**
 * Adapter output is unknown at the boundary on purpose. Provider-specific
 * payloads must be converted to this exact envelope before they cross back
 * into the voice domain.
 */
export interface RealtimeModelAdapter {
  readonly adapterId: string
  readonly modelId: string
  /** Optional realtime models are never enabled by a provider declaration. */
  readonly enabledByDefault: false
  run: (request: RealtimeModelAdapterRequest) => Promise<unknown>
  cancel?: (requestId: string, reason: RealtimeModelCancelReason) => void | Promise<void>
}

export interface RealtimeModelRequest {
  requestId: string
  sessionId: string
  generation: number
  audioStream: ReadableStream<ArrayBuffer>
  signal?: AbortSignal
}

/** The only model result that this domain can release to an upper layer. */
export interface RealtimeModelFinalTranscript {
  requestId: string
  sessionId: string
  generation: number
  modelId: string
  finalTranscript: string
}

export interface RealtimeModelTranscriptSink {
  /**
   * The caller should route this value to the existing Chat/M1 authority.
   * No other output channel is available in this contract.
   */
  onFinalTranscript: (transcript: RealtimeModelFinalTranscript) => void | Promise<void>
}

export interface RealtimeModelControllerOptions {
  adapter: RealtimeModelAdapter
  sessionId: string
  generation: number
  /** Defaults to `false`; enabling is an explicit user/runtime choice. */
  enabled?: boolean
  sink?: RealtimeModelTranscriptSink
}

export type RealtimeModelParseResult
  = | { ok: true, value: RealtimeModelFinalTranscript }
    | { ok: false, code: 'response-invalid' | 'stale-generation' }

/**
 * Strictly validates a provider-normalized completed response.
 *
 * Extra keys are rejected so audio output, deltas, tool calls, provider
 * metadata, and free-form model fields cannot leak into the voice pipeline.
 */
export function parseRealtimeModelFinalTranscript(
  input: unknown,
  expected: Pick<RealtimeModelRequest, 'requestId' | 'sessionId' | 'generation'> & { modelId: string },
): RealtimeModelParseResult {
  if (!isPlainRecord(input) || !hasExactKeys(input, ['finalTranscript', 'generation', 'modelId', 'requestId', 'sessionId']))
    return { ok: false, code: 'response-invalid' }

  if (input.requestId !== expected.requestId
    || input.sessionId !== expected.sessionId
    || input.generation !== expected.generation
    || input.modelId !== expected.modelId) {
    return { ok: false, code: 'stale-generation' }
  }

  if (!isIdentifier(input.requestId)
    || !isIdentifier(input.sessionId)
    || !isIdentifier(input.modelId)
    || !isGeneration(input.generation)
    || typeof input.finalTranscript !== 'string') {
    return { ok: false, code: 'response-invalid' }
  }

  const finalTranscript = input.finalTranscript.trim()
  if (!finalTranscript
    || finalTranscript.length > REALTIME_MODEL_MAX_TRANSCRIPT_CHARACTERS
    || containsControlCharacter(finalTranscript)) {
    return { ok: false, code: 'response-invalid' }
  }

  return {
    ok: true,
    value: {
      requestId: input.requestId,
      sessionId: input.sessionId,
      generation: input.generation,
      modelId: input.modelId,
      finalTranscript,
    },
  }
}

/**
 * Owns the optional realtime-model request lifecycle. It is intentionally a
 * small controller rather than a store: generation and cancellation remain
 * runtime-only and no transcript is retained after the sink call returns.
 */
export class RealtimeModelController {
  readonly #adapter: RealtimeModelAdapter
  readonly #sessionId: string
  readonly #sink?: RealtimeModelTranscriptSink
  #generation: number
  #enabled: boolean
  #active?: {
    requestId: string
    generation: number
    abortController: AbortController
    settled: Promise<void>
    resolveSettled: () => void
  }

  constructor(options: RealtimeModelControllerOptions) {
    if (!isIdentifier(options.adapter.adapterId)
      || !isIdentifier(options.adapter.modelId)
      || options.adapter.enabledByDefault !== REALTIME_MODEL_DEFAULT_ENABLED
      || !isIdentifier(options.sessionId)
      || !isGeneration(options.generation)) {
      throw new RealtimeModelError('invalid-request', 'Invalid realtime-model controller configuration.')
    }
    this.#adapter = options.adapter
    this.#sessionId = options.sessionId
    this.#sink = options.sink
    this.#generation = options.generation
    this.#enabled = options.enabled === true
  }

  get adapterId(): string {
    return this.#adapter.adapterId
  }

  get modelId(): string {
    return this.#adapter.modelId
  }

  get enabled(): boolean {
    return this.#enabled
  }

  get generation(): number {
    return this.#generation
  }

  get busy(): boolean {
    return this.#active !== undefined
  }

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled)
      return
    this.#enabled = enabled
    if (!enabled)
      void this.cancel('user-stop')
  }

  /** Invalidates old requests before a session/source/model switch. */
  async setGeneration(generation: number): Promise<void> {
    if (!isGeneration(generation) || generation < this.#generation)
      throw new RealtimeModelError('invalid-request', 'Realtime-model generation must be a positive monotonic number.')
    if (generation === this.#generation)
      return
    this.#generation = generation
    await this.cancel('generation-change')
  }

  async run(request: RealtimeModelRequest): Promise<RealtimeModelFinalTranscript> {
    if (!this.#enabled)
      throw new RealtimeModelError('disabled', 'Realtime-model input is disabled.')
    if (this.#active)
      throw new RealtimeModelError('busy', 'A realtime-model request is already active.')
    if (!this.#isValidRequest(request))
      throw new RealtimeModelError('invalid-request', 'Invalid realtime-model request.')

    const abortController = new AbortController()
    let resolveSettled!: () => void
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const active = {
      requestId: request.requestId,
      generation: request.generation,
      abortController,
      settled,
      resolveSettled,
    }
    this.#active = active
    const onExternalAbort = () => abortController.abort(request.signal?.reason ?? createAbortError())
    if (request.signal?.aborted)
      onExternalAbort()
    else
      request.signal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      if (abortController.signal.aborted)
        throw new RealtimeModelError('cancelled', 'Realtime-model request was cancelled.')

      let rawResponse: unknown
      try {
        rawResponse = await this.#adapter.run({
          requestId: request.requestId,
          sessionId: request.sessionId,
          generation: request.generation,
          modelId: this.#adapter.modelId,
          audioStream: request.audioStream,
          signal: abortController.signal,
        })
      }
      catch (error) {
        if (this.#generation !== request.generation)
          throw new RealtimeModelError('stale-generation', 'Realtime-model response belongs to an old generation.', { cause: error })
        if (abortController.signal.aborted || isAbortLike(error))
          throw new RealtimeModelError('cancelled', 'Realtime-model request was cancelled.', { cause: error })
        throw new RealtimeModelError('adapter-error', 'Realtime-model adapter failed.', { cause: error })
      }

      if (this.#generation !== request.generation)
        throw new RealtimeModelError('stale-generation', 'Realtime-model response belongs to an old generation.')
      if (abortController.signal.aborted)
        throw new RealtimeModelError('cancelled', 'Realtime-model request was cancelled.')

      const parsed = parseRealtimeModelFinalTranscript(rawResponse, {
        requestId: request.requestId,
        sessionId: request.sessionId,
        generation: request.generation,
        modelId: this.#adapter.modelId,
      })
      if (!parsed.ok) {
        throw new RealtimeModelError(parsed.code, 'Realtime-model completed response failed strict validation.')
      }

      if (this.#sink) {
        try {
          await this.#sink.onFinalTranscript(parsed.value)
        }
        catch (error) {
          throw new RealtimeModelError('sink-error', 'Realtime-model transcript authority rejected the final transcript.', { cause: error })
        }
      }

      return parsed.value
    }
    finally {
      request.signal?.removeEventListener('abort', onExternalAbort)
      if (this.#active === active)
        this.#active = undefined
      active.resolveSettled()
    }
  }

  async cancel(reason: RealtimeModelCancelReason = 'unknown'): Promise<void> {
    const active = this.#active
    if (!active)
      return
    active.abortController.abort(createAbortError(reason))
    try {
      // Adapter cancellation is best-effort. Do not let a hung provider-side
      // cancel hook prevent us from waiting on the run completion signal.
      void Promise.resolve(this.#adapter.cancel?.(active.requestId, reason)).catch(() => undefined)
    }
    catch {
      // Calling an adapter cancel hook can itself throw synchronously.
    }

    await waitForSettled(active.settled, REALTIME_MODEL_CANCEL_WAIT_MS)

    // A non-cooperating adapter may still be running after the deadline. Free
    // the controller's active slot so a new generation can start; the old run
    // retains its own abort signal and cannot publish after generation/abort
    // checks fail. Its finally block will not clear a newer active request.
    if (this.#active === active)
      this.#active = undefined
  }

  async dispose(): Promise<void> {
    this.#enabled = false
    await this.cancel('page-dispose')
  }

  #isValidRequest(request: RealtimeModelRequest): boolean {
    return isIdentifier(request.requestId)
      && request.sessionId === this.#sessionId
      && isGeneration(request.generation)
      && request.generation === this.#generation
      && request.audioStream instanceof ReadableStream
  }
}

async function waitForSettled(settled: Promise<void>, timeoutMs: number): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs)
  })

  try {
    await Promise.race([settled, timeout])
  }
  finally {
    if (timeoutId !== undefined)
      clearTimeout(timeoutId)
  }
}

function createAbortError(reason = 'cancelled'): DOMException {
  return new DOMException(`Realtime-model request ${reason}.`, 'AbortError')
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1F || codePoint === 0x7F)
      return true
  }
  return false
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
