import type { LocalTransformersScreenRuntimeOptions } from './local-transformers-screen-runtime'

import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_TRANSFORMERS_MODEL_REVISION,
  LOCAL_TRANSFORMERS_QUANTIZATION_ID,
  LOCAL_TRANSFORMERS_SERVICE_VERSION,
  LocalTransformersScreenError,
  LocalTransformersScreenRuntime,
} from './local-transformers-screen-runtime'

const token = '0123456789abcdef0123456789abcdef'
const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function validationResponse(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session:screen',
    generation: 2,
    serviceVersion: LOCAL_TRANSFORMERS_SERVICE_VERSION,
    modelId: 'Qwen/Qwen3-VL-4B-Instruct',
    revision: LOCAL_TRANSFORMERS_MODEL_REVISION,
    runtimeKind: 'transformers-service',
    quantizationId: LOCAL_TRANSFORMERS_QUANTIZATION_ID,
    state: 'ready',
    capabilities: ['single-image', 'multi-image', 'strict-json-schema', 'abort', 'process-exit-unload'],
    loadDurationMs: 16_500,
    runtime: {
      torch: '2.12.0+cu130',
      transformers: '5.14.0',
      bitsandbytes: '0.49.2',
      cuda: '13.0',
    },
    ...overrides,
  }
}

function createFetch(overrides: {
  validate?: () => Promise<Response>
  analyze?: (init: RequestInit) => Promise<Response>
} = {}) {
  const requests: Array<{ path: string, init: RequestInit }> = []
  const fetch = vi.fn(async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input))
    requests.push({ path: url.pathname, init })
    if (url.pathname === '/v1/validate')
      return overrides.validate?.() ?? jsonResponse(validationResponse())
    if (url.pathname === '/v1/analyze') {
      if (overrides.analyze)
        return overrides.analyze(init)
      const request = JSON.parse(String(init.body))
      return jsonResponse({
        requestId: request.requestId,
        sessionId: request.sessionId,
        generation: request.generation,
        objectiveJson: JSON.stringify({
          events: [{
            eventType: 'screen.activity.observed',
            value: { kind: 'enum', value: 'code' },
            confidence: 0.91,
          }],
        }),
        totalDurationMs: 4_500,
        outputTokenCount: 29,
      })
    }
    if (url.pathname === '/v1/cancel') {
      const request = JSON.parse(String(init.body))
      return jsonResponse({ ...request, cancelled: true })
    }
    if (url.pathname === '/v1/stop') {
      const request = JSON.parse(String(init.body))
      return jsonResponse({ ...request, stopping: true })
    }
    return jsonResponse({ errorCode: 'not-found' }, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

function runtime(options: Partial<LocalTransformersScreenRuntimeOptions> = {}) {
  const mocked = createFetch()
  return {
    mocked,
    value: new LocalTransformersScreenRuntime({
      token,
      sessionId: 'session:screen',
      generation: 2,
      fetch: mocked.fetch,
      ...options,
    }),
  }
}

function envelope() {
  return {
    observationId: 'observation:screen:1',
    sessionId: 'session:screen',
    generation: 2,
    sourceId: 'window:external',
    observedAt: 1_000,
    eventId: (index: number) => `event:screen:${index}`,
    adapterId: 'screen:transformers-local',
    runtimeModelId: 'Qwen/Qwen3-VL-4B-Instruct',
  }
}

describe('local Transformers screen runtime', () => {
  it.each([
    'http://0.0.0.0:39273/',
    'http://192.168.1.10:39273/',
    'https://127.0.0.1:39273/',
    'http://user:secret@127.0.0.1:39273/',
  ])('rejects non-loopback or credential-bearing endpoints', (baseUrl) => {
    expect(() => new LocalTransformersScreenRuntime({
      baseUrl,
      token,
      sessionId: 'session:screen',
      generation: 2,
    })).toThrowError(new LocalTransformersScreenError('runtime-endpoint-not-loopback'))
  })

  it('rejects short tokens and invalid generations before IO', () => {
    expect(() => new LocalTransformersScreenRuntime({
      token: 'short',
      sessionId: 'session:screen',
      generation: 2,
    })).toThrowError(new LocalTransformersScreenError('runtime-token-invalid'))
    expect(() => new LocalTransformersScreenRuntime({
      token,
      sessionId: 'session:screen',
      generation: 0,
    })).toThrowError(new LocalTransformersScreenError('screen-generation-invalid'))
  })

  it('validates fixed service, model, revision, quantization and capabilities', async () => {
    const { mocked, value } = runtime({ deviceClass: 'nvidia-8gb' })
    const result = await value.validate()

    expect(result).toMatchObject({
      runtimeVersion: LOCAL_TRANSFORMERS_SERVICE_VERSION,
      revision: LOCAL_TRANSFORMERS_MODEL_REVISION,
      quantizationId: LOCAL_TRANSFORMERS_QUANTIZATION_ID,
      loadDurationMs: 16_500,
      profile: {
        generation: 2,
        modelId: 'Qwen/Qwen3-VL-4B-Instruct',
        runtimeKind: 'transformers-service',
        state: 'ready',
        deviceClass: 'nvidia-8gb',
      },
    })
    const request = mocked.requests[0]!
    expect(request.path).toBe('/v1/validate')
    expect(new Headers(request.init.headers).get('x-airi-perception-token')).toBe(token)
    expect(JSON.parse(String(request.init.body))).toEqual({ sessionId: 'session:screen', generation: 2 })
  })

  it.each([
    { revision: 'wrong-revision' },
    { quantizationId: 'unknown-quantization' },
    { modelId: 'Qwen/Qwen3-VL-4B-Thinking' },
    { capabilities: ['single-image', 'strict-json-schema'] },
  ])('rejects a service identity or capability mismatch', async (override) => {
    const mocked = createFetch({ validate: async () => jsonResponse(validationResponse(override)) })
    const value = new LocalTransformersScreenRuntime({
      token,
      sessionId: 'session:screen',
      generation: 2,
      fetch: mocked.fetch,
    })
    await expect(value.validate()).rejects.toMatchObject({ code: 'model-identity-mismatch' })
  })

  it('sends only bounded JPEGs and turns strict objective JSON into events', async () => {
    const { mocked, value } = runtime()
    await value.validate()
    const result = await value.analyze({ jpegFrames: [jpeg, jpeg], envelope: envelope() })

    expect(result).toMatchObject({
      totalDurationMs: 4_500,
      outputTokenCount: 29,
      events: [{
        eventType: 'screen.activity.observed',
        value: { kind: 'enum', value: 'code' },
        sourceKind: 'screen-local',
      }],
    })
    const request = mocked.requests.find(item => item.path === '/v1/analyze')!
    expect(JSON.parse(String(request.init.body))).toEqual({
      requestId: 'observation:screen:1',
      sessionId: 'session:screen',
      generation: 2,
      jpegFrames: ['/9j/2Q==', '/9j/2Q=='],
    })
    expect(String(request.init.body)).not.toContain('prompt')
    expect(String(request.init.body)).not.toContain('tools')
  })

  it('rejects invalid output and stale request metadata', async () => {
    const mocked = createFetch({
      analyze: async () => jsonResponse({
        requestId: 'observation:screen:1',
        sessionId: 'session:screen',
        generation: 2,
        objectiveJson: '```json\n{}\n```',
        totalDurationMs: 100,
        outputTokenCount: 4,
      }),
    })
    const value = new LocalTransformersScreenRuntime({
      token,
      sessionId: 'session:screen',
      generation: 2,
      fetch: mocked.fetch,
    })
    await value.validate()
    await expect(value.analyze({ jpegFrames: [jpeg], envelope: envelope() })).rejects.toMatchObject({ code: 'screen-output-invalid' })
    await expect(value.analyze({
      jpegFrames: [jpeg],
      envelope: { ...envelope(), generation: 3 },
    })).rejects.toMatchObject({ code: 'screen-generation-invalid' })
  })

  it('propagates abort to the worker cancel endpoint', async () => {
    let analyzeSignal!: AbortSignal
    const mocked = createFetch({
      analyze: async init => new Promise<Response>((_resolve, reject) => {
        analyzeSignal = init.signal as AbortSignal
        analyzeSignal.addEventListener('abort', () => reject(new DOMException('private', 'AbortError')), { once: true })
      }),
    })
    const value = new LocalTransformersScreenRuntime({
      token,
      sessionId: 'session:screen',
      generation: 2,
      fetch: mocked.fetch,
    })
    await value.validate()
    const controller = new AbortController()
    const pending = value.analyze({ jpegFrames: [jpeg], envelope: envelope(), signal: controller.signal })
    await vi.waitFor(() => expect(analyzeSignal).toBeInstanceOf(AbortSignal))
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'screen-inference-cancelled' })
    await vi.waitFor(() => expect(mocked.requests.some(request => request.path === '/v1/cancel')).toBe(true))
    expect(analyzeSignal.aborted).toBe(true)
  })

  it('stops the process worker and clears validated readiness', async () => {
    const { mocked, value } = runtime()
    await value.validate()
    await value.stop()
    await value.stop()

    expect(mocked.requests.filter(request => request.path === '/v1/stop')).toHaveLength(1)
    await expect(value.analyze({ jpegFrames: [jpeg], envelope: envelope() })).rejects.toMatchObject({ code: 'screen-runtime-not-validated' })
  })
})
