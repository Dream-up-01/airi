import type { LocalOllamaScreenRuntimeOptions } from './local-ollama-screen-runtime'

import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_SCREEN_OLLAMA_MANIFEST_DIGEST,
  LocalOllamaScreenError,
  LocalOllamaScreenRuntime,
} from './local-ollama-screen-runtime'

const digest = LOCAL_SCREEN_OLLAMA_MANIFEST_DIGEST
const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createFetch(overrides: {
  digest?: string
  model?: string
  quantization?: string
  parameterSize?: string
  license?: string
  chat?: (init: RequestInit) => Promise<Response>
} = {}) {
  const requests: Array<{ path: string, init: RequestInit }> = []
  const fetch = vi.fn(async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input))
    requests.push({ path: url.pathname, init })
    if (url.pathname === '/api/version')
      return jsonResponse({ version: '0.30.11' })
    if (url.pathname === '/api/tags') {
      return jsonResponse({
        models: [{
          name: overrides.model ?? 'qwen3-vl:4b-instruct-q4_K_M',
          digest: overrides.digest ?? digest,
          details: {
            parameter_size: overrides.parameterSize ?? '4.3B',
            quantization_level: overrides.quantization ?? 'Q4_K_M',
          },
        }],
      })
    }
    if (url.pathname === '/api/show')
      return jsonResponse({ license: overrides.license ?? 'Apache License, Version 2.0' })
    if (url.pathname === '/api/chat') {
      if (overrides.chat)
        return overrides.chat(init)
      return jsonResponse({
        message: {
          role: 'assistant',
          content: JSON.stringify({
            events: [{
              eventType: 'screen.activity.observed',
              value: { kind: 'enum', value: 'code' },
              confidence: 0.88,
            }],
          }),
        },
        total_duration: 2_500_000_000,
        load_duration: 1_000_000_000,
        prompt_eval_count: 120,
        eval_count: 28,
      })
    }
    if (url.pathname === '/api/generate')
      return jsonResponse({ done: true })
    return jsonResponse({}, 404)
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests }
}

function runtime(options: Partial<LocalOllamaScreenRuntimeOptions> = {}) {
  const mocked = createFetch()
  return {
    mocked,
    value: new LocalOllamaScreenRuntime({
      generation: 2,
      idleUnloadMs: 0,
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
    adapterId: 'screen:ollama-local',
    runtimeModelId: 'Qwen/Qwen3-VL-4B-Instruct',
  }
}

describe('local Ollama screen runtime', () => {
  it.each([
    'http://0.0.0.0:11434/',
    'http://192.168.1.10:11434/',
    'https://127.0.0.1:11434/',
    'http://user:secret@127.0.0.1:11434/',
  ])('rejects a non-loopback or credential-bearing endpoint', (baseUrl) => {
    expect(() => new LocalOllamaScreenRuntime({
      baseUrl,
      generation: 1,
    })).toThrowError(new LocalOllamaScreenError('runtime-endpoint-not-loopback'))
  })

  it('rejects an invalid analyzer generation', () => {
    expect(() => new LocalOllamaScreenRuntime({
      generation: 0,
    })).toThrowError(new LocalOllamaScreenError('screen-generation-invalid'))
  })

  it('validates exact model identity but reports the measured multi-image limitation as degraded', async () => {
    const { value } = runtime({ deviceClass: 'nvidia-8gb' })
    const result = await value.validate()

    expect(result).toMatchObject({
      runtimeVersion: '0.30.11',
      runtimeModelTag: 'qwen3-vl:4b-instruct-q4_K_M',
      digest,
      license: 'Apache-2.0',
      profile: {
        generation: 2,
        modelId: 'Qwen/Qwen3-VL-4B-Instruct',
        runtimeKind: 'ollama',
        quantizationId: 'Q4_K_M',
        deviceClass: 'nvidia-8gb',
        state: 'degraded',
        capabilities: ['single-image', 'strict-json-schema', 'abort', 'idle-unload'],
        lastErrorCode: 'runtime-multi-image-unsupported',
        latencyClass: 'warm-interactive-cold-slow',
        resourceClass: 'gpu-near-capacity',
      },
    })
  })

  it('bounds a stalled runtime validation with a stable timeout', async () => {
    const fetch = vi.fn(async (_input: URL | RequestInfo, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signal.addEventListener('abort', () => reject(new DOMException('private details', 'AbortError')), { once: true })
    })) as unknown as typeof globalThis.fetch
    const value = new LocalOllamaScreenRuntime({
      generation: 2,
      validationTimeoutMs: 5,
      idleUnloadMs: 0,
      fetch,
    })

    await expect(value.validate()).rejects.toMatchObject({ code: 'runtime-validation-timeout' })
  })

  it.each([
    { digest: '000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    { quantization: 'Q8_0' },
    { parameterSize: '8.2B' },
    { license: 'unknown' },
  ])('rejects an identity mismatch without trying inference', async (identityOverride) => {
    const mocked = createFetch(identityOverride)
    const value = new LocalOllamaScreenRuntime({
      generation: 2,
      idleUnloadMs: 0,
      fetch: mocked.fetch,
    })
    await expect(value.validate()).rejects.toMatchObject({ code: 'model-identity-mismatch' })
    expect(mocked.requests.some(request => request.path === '/api/chat')).toBe(false)
  })

  it('sends only bounded images and strict objective JSON controls', async () => {
    const { mocked, value } = runtime()
    await value.validate()
    const result = await value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
    })

    expect(result).toMatchObject({
      totalDurationMs: 2_500,
      loadDurationMs: 1_000,
      promptTokenCount: 120,
      outputTokenCount: 28,
      events: [{ eventType: 'screen.activity.observed', sourceKind: 'screen-local' }],
    })
    const chat = mocked.requests.find(request => request.path === '/api/chat')
    const body = JSON.parse(String(chat?.init.body))
    expect(body).toMatchObject({
      model: 'qwen3-vl:4b-instruct-q4_K_M',
      stream: false,
      think: false,
      keep_alive: '2m',
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: 'user', images: ['/9j/2Q=='] }],
      format: { type: 'object', additionalProperties: false },
    })
    expect(body).not.toHaveProperty('tools')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content).toContain('ordered oldest to newest')
    expect(body.format.properties.events.items.oneOf).toHaveLength(4)
  })

  it('rejects non-JPEG and oversized frame payloads before inference', async () => {
    const { mocked, value } = runtime()
    await value.validate()

    await expect(value.analyze({
      jpegFrames: [new Uint8Array([1, 2, 3, 4])],
      envelope: envelope(),
    })).rejects.toMatchObject({ code: 'screen-frame-invalid' })
    expect(mocked.requests.some(request => request.path === '/api/chat')).toBe(false)
  })

  it('rejects invalid completed output as a stable error', async () => {
    const mocked = createFetch({
      chat: async () => jsonResponse({ message: { content: '```json\n{"events":[]}\n```' } }),
    })
    const value = new LocalOllamaScreenRuntime({
      generation: 2,
      idleUnloadMs: 0,
      fetch: mocked.fetch,
    })
    await value.validate()
    await expect(value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
    })).rejects.toMatchObject({ code: 'screen-output-invalid' })
  })

  it('propagates upstream cancellation and keeps only one request in flight', async () => {
    let chatSignal!: AbortSignal
    const mocked = createFetch({
      chat: async init => new Promise<Response>((_resolve, reject) => {
        chatSignal = init.signal as AbortSignal
        chatSignal.addEventListener('abort', () => reject(new DOMException('private details', 'AbortError')), { once: true })
      }),
    })
    const value = new LocalOllamaScreenRuntime({
      generation: 2,
      idleUnloadMs: 0,
      fetch: mocked.fetch,
    })
    await value.validate()
    const controller = new AbortController()
    const pending = value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(chatSignal).toBeInstanceOf(AbortSignal))
    await expect(value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
    })).rejects.toMatchObject({ code: 'screen-runtime-busy' })

    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'screen-inference-cancelled' })
    expect(chatSignal.aborted).toBe(true)
  })

  it('turns a provider timeout into a stable error and aborts the request', async () => {
    let chatSignal!: AbortSignal
    const mocked = createFetch({
      chat: async init => new Promise<Response>((_resolve, reject) => {
        chatSignal = init.signal as AbortSignal
        chatSignal.addEventListener('abort', () => reject(new DOMException('private details', 'AbortError')), { once: true })
      }),
    })
    const value = new LocalOllamaScreenRuntime({
      generation: 2,
      requestTimeoutMs: 5,
      idleUnloadMs: 0,
      fetch: mocked.fetch,
    })
    await value.validate()

    await expect(value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
    })).rejects.toMatchObject({ code: 'screen-inference-timeout' })
    expect(chatSignal.aborted).toBe(true)
  })

  it('unloads with keep_alive zero and clears validated readiness', async () => {
    const { mocked, value } = runtime()
    await value.validate()
    await value.stop()
    await value.stop()

    const unloads = mocked.requests.filter(request => request.path === '/api/generate')
    expect(unloads).toHaveLength(1)
    expect(JSON.parse(String(unloads[0]?.init.body))).toEqual({
      model: 'qwen3-vl:4b-instruct-q4_K_M',
      keep_alive: 0,
    })
    await expect(value.analyze({
      jpegFrames: [jpeg],
      envelope: envelope(),
    })).rejects.toMatchObject({ code: 'screen-runtime-not-validated' })
  })
})
