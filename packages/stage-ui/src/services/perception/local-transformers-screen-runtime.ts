import type { LocalScreenAnalyzerProfile, ObjectivePerceptionEvent } from '../../domains/perception'
import type { LocalScreenObjectiveEnvelope } from './local-screen-objective-parser'

import { PERCEPTION_CONTRACT_VERSION } from '../../domains/perception'
import { LOCAL_SCREEN_SEMANTIC_MODEL_ID } from './local-ollama-screen-runtime'
import { parseLocalScreenObjectiveResponse } from './local-screen-objective-parser'

export const LOCAL_TRANSFORMERS_SERVICE_VERSION = 'airi-local-screen-transformers/v0.1' as const
export const LOCAL_TRANSFORMERS_MODEL_REVISION = 'ebb281ec70b05090aa6165b016eac8ec08e71b17' as const
export const LOCAL_TRANSFORMERS_QUANTIZATION_ID = 'bitsandbytes-nf4-double-quant' as const

export type LocalTransformersScreenErrorCode
  = | 'runtime-endpoint-not-loopback'
    | 'runtime-token-invalid'
    | 'runtime-unavailable'
    | 'runtime-service-mismatch'
    | 'model-not-installed'
    | 'model-identity-mismatch'
    | 'runtime-response-invalid'
    | 'runtime-validation-cancelled'
    | 'runtime-validation-timeout'
    | 'screen-frame-invalid'
    | 'screen-generation-invalid'
    | 'screen-runtime-not-validated'
    | 'screen-runtime-busy'
    | 'screen-inference-cancelled'
    | 'screen-inference-timeout'
    | 'screen-output-invalid'

export class LocalTransformersScreenError extends Error {
  readonly code: LocalTransformersScreenErrorCode

  constructor(code: LocalTransformersScreenErrorCode) {
    super(code)
    this.name = 'LocalTransformersScreenError'
    this.code = code
  }
}

export interface LocalTransformersScreenRuntimeOptions {
  baseUrl?: string
  token: string
  sessionId: string
  generation: number
  adapterId?: string
  deviceClass?: string
  requestTimeoutMs?: number
  validationTimeoutMs?: number
  fetch?: typeof fetch
}

export interface LocalTransformersScreenAnalysisRequest {
  jpegFrames: Uint8Array[]
  envelope: LocalScreenObjectiveEnvelope
  signal?: AbortSignal
}

export interface LocalTransformersScreenValidationResult {
  profile: LocalScreenAnalyzerProfile
  runtimeVersion: typeof LOCAL_TRANSFORMERS_SERVICE_VERSION
  revision: typeof LOCAL_TRANSFORMERS_MODEL_REVISION
  quantizationId: typeof LOCAL_TRANSFORMERS_QUANTIZATION_ID
  loadDurationMs: number
}

export interface LocalTransformersScreenAnalysisResult {
  events: ObjectivePerceptionEvent[]
  totalDurationMs: number
  loadDurationMs: number
  promptTokenCount: number
  outputTokenCount: number
}

interface InFlightRequest {
  controller: AbortController
  requestId: string
}

const requiredCapabilities = ['single-image', 'multi-image', 'strict-json-schema', 'abort', 'process-exit-unload'] as const

/** Token-authenticated loopback facade for the process-isolated WSL worker. */
export class LocalTransformersScreenRuntime {
  readonly #baseUrl: URL
  readonly #token: string
  readonly #sessionId: string
  readonly #generation: number
  readonly #adapterId: string
  readonly #deviceClass?: string
  readonly #requestTimeoutMs: number
  readonly #validationTimeoutMs: number
  readonly #fetch: typeof fetch
  #validated = false
  #inFlight?: InFlightRequest

  constructor(options: LocalTransformersScreenRuntimeOptions) {
    this.#baseUrl = normalizeLoopbackBaseUrl(options.baseUrl ?? 'http://127.0.0.1:39273/')
    if (options.token.length < 32 || options.token.length > 256)
      throw new LocalTransformersScreenError('runtime-token-invalid')
    if (!isIdentifier(options.sessionId) || !Number.isInteger(options.generation) || options.generation < 1)
      throw new LocalTransformersScreenError('screen-generation-invalid')
    this.#token = options.token
    this.#sessionId = options.sessionId
    this.#generation = options.generation
    this.#adapterId = options.adapterId ?? 'screen:transformers-local'
    this.#deviceClass = options.deviceClass
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000
    this.#validationTimeoutMs = options.validationTimeoutMs ?? 60_000
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async validate(signal?: AbortSignal): Promise<LocalTransformersScreenValidationResult> {
    if (this.#inFlight)
      throw new LocalTransformersScreenError('screen-runtime-busy')
    const controller = new AbortController()
    const unlink = linkAbortSignal(signal, () => controller.abort('upstream-cancelled'))
    const timeout = setTimeout(() => controller.abort('validation-timeout'), this.#validationTimeoutMs)
    try {
      const value = await this.#requestJson('v1/validate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: this.#sessionId,
          generation: this.#generation,
        }),
      }, controller.signal)
      if (!isRecord(value))
        throw new LocalTransformersScreenError('model-identity-mismatch')
      const capabilities = value.capabilities
      if (!hasExactKeys(value, ['sessionId', 'generation', 'serviceVersion', 'modelId', 'revision', 'runtimeKind', 'quantizationId', 'state', 'capabilities', 'loadDurationMs', 'runtime'])
        || value.sessionId !== this.#sessionId
        || value.generation !== this.#generation
        || value.serviceVersion !== LOCAL_TRANSFORMERS_SERVICE_VERSION
        || value.modelId !== LOCAL_SCREEN_SEMANTIC_MODEL_ID
        || value.revision !== LOCAL_TRANSFORMERS_MODEL_REVISION
        || value.runtimeKind !== 'transformers-service'
        || value.quantizationId !== LOCAL_TRANSFORMERS_QUANTIZATION_ID
        || value.state !== 'ready'
        || !Array.isArray(capabilities)
        || !capabilities.every(isIdentifier)
        || !requiredCapabilities.every(capability => capabilities.includes(capability))
        || !isFiniteNonNegative(value.loadDurationMs)
        || !isRecord(value.runtime)) {
        throw new LocalTransformersScreenError('model-identity-mismatch')
      }
      this.#validated = true
      return {
        runtimeVersion: LOCAL_TRANSFORMERS_SERVICE_VERSION,
        revision: LOCAL_TRANSFORMERS_MODEL_REVISION,
        quantizationId: LOCAL_TRANSFORMERS_QUANTIZATION_ID,
        loadDurationMs: value.loadDurationMs,
        profile: {
          contractVersion: PERCEPTION_CONTRACT_VERSION,
          profileId: 'screen:qwen3-vl-4b-instruct:transformers-service',
          adapterId: this.#adapterId,
          generation: this.#generation,
          modelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
          runtimeKind: 'transformers-service',
          revision: LOCAL_TRANSFORMERS_MODEL_REVISION,
          quantizationId: LOCAL_TRANSFORMERS_QUANTIZATION_ID,
          deviceClass: this.#deviceClass,
          targetResolution: '1280x720',
          normalFpsMax: 0.2,
          activeFpsMax: 1,
          state: 'ready',
          capabilities,
          latencyClass: 'warm-interactive-cold-slow',
          resourceClass: 'gpu-near-capacity',
        },
      }
    }
    catch (error) {
      if (controller.signal.aborted) {
        throw new LocalTransformersScreenError(controller.signal.reason === 'validation-timeout'
          ? 'runtime-validation-timeout'
          : 'runtime-validation-cancelled')
      }
      if (error instanceof LocalTransformersScreenError)
        throw error
      throw new LocalTransformersScreenError('runtime-unavailable')
    }
    finally {
      clearTimeout(timeout)
      unlink()
    }
  }

  async analyze(request: LocalTransformersScreenAnalysisRequest): Promise<LocalTransformersScreenAnalysisResult> {
    if (!this.#validated)
      throw new LocalTransformersScreenError('screen-runtime-not-validated')
    if (this.#inFlight)
      throw new LocalTransformersScreenError('screen-runtime-busy')
    if (request.envelope.sessionId !== this.#sessionId
      || request.envelope.generation !== this.#generation
      || !isIdentifier(request.envelope.observationId)) {
      throw new LocalTransformersScreenError('screen-generation-invalid')
    }
    if (request.jpegFrames.length < 1 || request.jpegFrames.length > 4 || request.jpegFrames.some(frame => !isBoundedJpeg(frame)))
      throw new LocalTransformersScreenError('screen-frame-invalid')

    const requestId = request.envelope.observationId
    const controller = new AbortController()
    this.#inFlight = { controller, requestId }
    const cancel = (reason: 'upstream-cancelled' | 'timeout') => {
      void this.#cancel(requestId)
      controller.abort(reason)
    }
    const unlink = linkAbortSignal(request.signal, () => cancel('upstream-cancelled'))
    const timeout = setTimeout(cancel, this.#requestTimeoutMs, 'timeout')
    try {
      const value = await this.#requestJson('v1/analyze', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          sessionId: this.#sessionId,
          generation: this.#generation,
          jpegFrames: request.jpegFrames.map(bytesToBase64),
        }),
      }, controller.signal)
      if (!isRecord(value)
        || !hasExactKeys(value, ['requestId', 'sessionId', 'generation', 'objectiveJson', 'totalDurationMs', 'outputTokenCount'])
        || value.requestId !== requestId
        || value.sessionId !== this.#sessionId
        || value.generation !== this.#generation
        || typeof value.objectiveJson !== 'string'
        || new TextEncoder().encode(value.objectiveJson).byteLength > 64 * 1024
        || !isFiniteNonNegative(value.totalDurationMs)
        || !isFiniteNonNegativeInteger(value.outputTokenCount)) {
        throw new LocalTransformersScreenError('runtime-response-invalid')
      }
      const parsed = parseLocalScreenObjectiveResponse(value.objectiveJson, {
        ...request.envelope,
        adapterId: 'screen:transformers-local',
        runtimeProviderId: 'transformers-service',
      })
      if (!parsed.ok)
        throw new LocalTransformersScreenError('screen-output-invalid')
      return {
        events: parsed.events,
        totalDurationMs: value.totalDurationMs,
        loadDurationMs: 0,
        promptTokenCount: 0,
        outputTokenCount: value.outputTokenCount,
      }
    }
    catch (error) {
      if (controller.signal.aborted) {
        throw new LocalTransformersScreenError(controller.signal.reason === 'timeout'
          ? 'screen-inference-timeout'
          : 'screen-inference-cancelled')
      }
      if (error instanceof LocalTransformersScreenError)
        throw error
      throw new LocalTransformersScreenError('runtime-unavailable')
    }
    finally {
      clearTimeout(timeout)
      unlink()
      if (this.#inFlight?.controller === controller)
        this.#inFlight = undefined
    }
  }

  async stop(): Promise<void> {
    const current = this.#inFlight
    if (current) {
      void this.#cancel(current.requestId)
      current.controller.abort('runtime-stopped')
      this.#inFlight = undefined
    }
    const shouldStop = this.#validated || current !== undefined
    this.#validated = false
    if (!shouldStop)
      return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('stop-timeout'), 5_000)
    try {
      await this.#requestJson('v1/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: this.#sessionId, generation: this.#generation }),
      }, controller.signal)
    }
    catch {
      // The process may exit before the response completes; stop remains idempotent.
    }
    finally {
      clearTimeout(timeout)
    }
  }

  async #cancel(requestId: string): Promise<void> {
    try {
      await this.#requestJson('v1/cancel', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          sessionId: this.#sessionId,
          generation: this.#generation,
        }),
      })
    }
    catch {
      // The local worker may already be stopping.
    }
  }

  async #requestJson(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-airi-perception-token': this.#token,
          ...init.headers,
        },
        signal,
      })
    }
    catch (error) {
      if (signal?.aborted)
        throw error
      throw new LocalTransformersScreenError('runtime-unavailable')
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > 64 * 1024)
      throw new LocalTransformersScreenError('runtime-response-invalid')
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > 64 * 1024)
      throw new LocalTransformersScreenError('runtime-response-invalid')
    let value: unknown
    try {
      value = JSON.parse(text)
    }
    catch {
      throw new LocalTransformersScreenError('runtime-response-invalid')
    }
    if (!response.ok) {
      const providerCode = isRecord(value) && typeof value.errorCode === 'string' ? value.errorCode : ''
      throw new LocalTransformersScreenError(mapProviderError(providerCode))
    }
    return value
  }
}

function mapProviderError(value: string): LocalTransformersScreenErrorCode {
  switch (value) {
    case 'model-not-installed':
    case 'screen-frame-invalid':
    case 'screen-runtime-not-validated':
    case 'screen-runtime-busy':
    case 'screen-inference-cancelled':
    case 'screen-output-invalid':
      return value
    case 'unauthorized':
      return 'runtime-token-invalid'
    default:
      return 'runtime-unavailable'
  }
}

function normalizeLoopbackBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new LocalTransformersScreenError('runtime-endpoint-not-loopback')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(hostname) || url.username || url.password)
    throw new LocalTransformersScreenError('runtime-endpoint-not-loopback')
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return url
}

function linkAbortSignal(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (!signal)
    return () => undefined
  if (signal.aborted)
    abort()
  else
    signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    output += alphabet[(triplet >> 18) & 63]
    output += alphabet[(triplet >> 12) & 63]
    output += second === undefined ? '=' : alphabet[(triplet >> 6) & 63]
    output += third === undefined ? '=' : alphabet[triplet & 63]
  }
  return output
}

function isBoundedJpeg(frame: Uint8Array): boolean {
  return frame instanceof Uint8Array
    && frame.byteLength >= 4
    && frame.byteLength <= 1024 * 1024
    && frame[0] === 0xFF
    && frame[1] === 0xD8
    && frame[frame.byteLength - 2] === 0xFF
    && frame[frame.byteLength - 1] === 0xD9
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return isFiniteNonNegative(value) && Number.isInteger(value)
}
