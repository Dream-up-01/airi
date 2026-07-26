import type {
  LocalTransformersScreenAnalysisRequest,
  LocalTransformersScreenAnalysisResult,
  LocalTransformersScreenValidationResult,
} from '@proj-airi/stage-ui/services/perception'

import type {
  LocalScreenAnalyzeMessage,
  LocalScreenAnalyzeResponse,
  LocalScreenGatewayStatus,
  LocalScreenGatewayStopRequest,
  LocalScreenGatewayValidateRequest,
} from '../../../shared/eventa/perception-local-screen'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { errorMessageFrom } from '@moeru/std'
import {
  LOCAL_TRANSFORMERS_MODEL_REVISION,
  LOCAL_TRANSFORMERS_QUANTIZATION_ID,
  LOCAL_TRANSFORMERS_SERVICE_VERSION,
  LocalTransformersScreenError,
} from '@proj-airi/stage-ui/services/perception'

import {
  electronLocalScreenAnalyze,
  electronLocalScreenStop,
  electronLocalScreenValidate,
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_PROFILE_ID,
  parseLocalScreenAnalyzeResponse,
  parseLocalScreenGatewayStatus,
} from '../../../shared/eventa/perception-local-screen'

interface InvokeOptions {
  signal?: AbortSignal
}

export interface LocalScreenEventaInvocations {
  validate: (request: LocalScreenGatewayValidateRequest, options?: InvokeOptions) => Promise<LocalScreenGatewayStatus>
  analyze: (stream: ReadableStream<LocalScreenAnalyzeMessage>, options?: InvokeOptions) => Promise<LocalScreenAnalyzeResponse>
  stop: (request: LocalScreenGatewayStopRequest, options?: InvokeOptions) => Promise<LocalScreenGatewayStatus>
}

export interface LocalScreenEventaRuntimeOptions {
  consentGrantId: string
  sessionId: string
  generation: number
  sourceId: string
  invocations?: LocalScreenEventaInvocations
}

/** Renderer facade for the directed main-process worker gateway; it never receives the worker token. */
export class LocalScreenEventaRuntime {
  readonly #consentGrantId: string
  readonly #sessionId: string
  readonly #generation: number
  readonly #sourceId: string
  readonly #invocations: LocalScreenEventaInvocations

  constructor(options: LocalScreenEventaRuntimeOptions) {
    if (!isIdentifier(options.consentGrantId)
      || !isIdentifier(options.sessionId)
      || !Number.isInteger(options.generation)
      || options.generation < 1
      || !isIdentifier(options.sourceId)) {
      throw new LocalTransformersScreenError('screen-generation-invalid')
    }
    this.#consentGrantId = options.consentGrantId
    this.#sessionId = options.sessionId
    this.#generation = options.generation
    this.#sourceId = options.sourceId
    this.#invocations = options.invocations ?? createElectronInvocations()
  }

  async validate(signal?: AbortSignal): Promise<LocalTransformersScreenValidationResult> {
    try {
      const raw = await this.#invocations.validate({
        contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
        sessionId: this.#sessionId,
        generation: this.#generation,
        consentGrantId: this.#consentGrantId,
        profileId: LOCAL_SCREEN_PROFILE_ID,
      }, { signal })
      const parsed = parseLocalScreenGatewayStatus(raw)
      if (!parsed.ok || parsed.value.state !== 'ready')
        throw new LocalTransformersScreenError('model-identity-mismatch')
      const status = parsed.value
      return {
        runtimeVersion: LOCAL_TRANSFORMERS_SERVICE_VERSION,
        revision: LOCAL_TRANSFORMERS_MODEL_REVISION,
        quantizationId: LOCAL_TRANSFORMERS_QUANTIZATION_ID,
        loadDurationMs: status.loadDurationMs ?? 0,
        profile: {
          contractVersion: 'perception/v0.3',
          profileId: status.profileId,
          adapterId: 'screen:transformers-local',
          generation: status.generation,
          modelId: status.modelId,
          runtimeKind: 'transformers-service',
          revision: status.revision,
          quantizationId: status.quantizationId,
          targetResolution: '1280x720',
          normalFpsMax: 0.2,
          activeFpsMax: 1,
          state: 'ready',
          capabilities: [...status.capabilities],
          latencyClass: 'warm-interactive-cold-slow',
          resourceClass: 'gpu-near-capacity',
        },
      }
    }
    catch (error) {
      throw mapGatewayError(error, 'validate')
    }
  }

  async analyze(request: LocalTransformersScreenAnalysisRequest): Promise<LocalTransformersScreenAnalysisResult> {
    if (request.envelope.sessionId !== this.#sessionId
      || request.envelope.generation !== this.#generation
      || request.envelope.sourceId !== this.#sourceId
      || request.jpegFrames.length < 1
      || request.jpegFrames.length > 4) {
      throw new LocalTransformersScreenError('screen-generation-invalid')
    }

    const correlation = {
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: this.#sessionId,
      generation: this.#generation,
      observationId: request.envelope.observationId,
    } as const
    const stream = new ReadableStream<LocalScreenAnalyzeMessage>({
      start: (controller) => {
        controller.enqueue({
          ...correlation,
          type: 'open',
          consentGrantId: this.#consentGrantId,
          sourceId: this.#sourceId,
          observedAt: request.envelope.observedAt,
        })
        request.jpegFrames.forEach((jpeg, sequence) => controller.enqueue({
          ...correlation,
          type: 'frame',
          sequence,
          capturedAt: request.envelope.observedAt,
          width: 1280,
          height: 720,
          jpeg,
        }))
        controller.enqueue({ ...correlation, type: 'complete', endedAt: Date.now() })
        controller.close()
      },
    })

    try {
      const raw = await this.#invocations.analyze(stream, { signal: request.signal })
      const parsed = parseLocalScreenAnalyzeResponse(raw)
      if (!parsed.ok)
        throw new LocalTransformersScreenError('runtime-response-invalid')
      return {
        events: parsed.value.events,
        totalDurationMs: parsed.value.totalDurationMs,
        loadDurationMs: 0,
        promptTokenCount: 0,
        outputTokenCount: parsed.value.outputTokenCount,
      }
    }
    catch (error) {
      throw mapGatewayError(error, 'analyze')
    }
  }

  async stop(): Promise<void> {
    try {
      const raw = await this.#invocations.stop({
        contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
        sessionId: this.#sessionId,
        generation: this.#generation,
        reason: 'user-stop',
      })
      if (!parseLocalScreenGatewayStatus(raw).ok)
        throw new LocalTransformersScreenError('runtime-response-invalid')
    }
    catch (error) {
      const mapped = mapGatewayError(error, 'stop')
      if (mapped.code !== 'runtime-unavailable')
        throw mapped
    }
  }
}

function createElectronInvocations(): LocalScreenEventaInvocations {
  const { context } = createContext(window.electron.ipcRenderer)
  return {
    validate: defineInvoke(context, electronLocalScreenValidate),
    analyze: defineInvoke(context, electronLocalScreenAnalyze),
    stop: defineInvoke(context, electronLocalScreenStop),
  }
}

function mapGatewayError(error: unknown, phase: 'validate' | 'analyze' | 'stop'): LocalTransformersScreenError {
  if (error instanceof LocalTransformersScreenError)
    return error
  const code = errorMessageFrom(error) ?? ''
  if (code === 'runtime-busy')
    return new LocalTransformersScreenError('screen-runtime-busy')
  if (code === 'runtime-cancelled')
    return new LocalTransformersScreenError(phase === 'validate' ? 'runtime-validation-cancelled' : 'screen-inference-cancelled')
  if (code === 'runtime-timeout')
    return new LocalTransformersScreenError(phase === 'validate' ? 'runtime-validation-timeout' : 'screen-inference-timeout')
  if (code === 'runtime-output-invalid' || code === 'invalid-schema' || code === 'invalid-order' || code === 'payload-too-large')
    return new LocalTransformersScreenError(phase === 'analyze' ? 'screen-output-invalid' : 'runtime-response-invalid')
  if (code === 'stale-generation')
    return new LocalTransformersScreenError('screen-generation-invalid')
  if (code === 'consent-missing' || code === 'runtime-validation-failed')
    return new LocalTransformersScreenError('model-identity-mismatch')
  return new LocalTransformersScreenError('runtime-unavailable')
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}
