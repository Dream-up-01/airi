import type { RealtimeModelAdapter } from './realtime-model'

import { describe, expect, it, vi } from 'vitest'

import {
  parseRealtimeModelFinalTranscript,
  REALTIME_MODEL_CANCEL_WAIT_MS,
  REALTIME_MODEL_DEFAULT_ENABLED,
  RealtimeModelController,
} from './realtime-model'

function audioStream() {
  return new ReadableStream<ArrayBuffer>({
    start(controller) {
      controller.close()
    },
  })
}

function adapter(overrides: Partial<Pick<RealtimeModelAdapter, 'run' | 'cancel'>> = {}) {
  return {
    adapterId: 'test.realtime',
    modelId: 'test-realtime-model',
    enabledByDefault: REALTIME_MODEL_DEFAULT_ENABLED,
    run: vi.fn(async (request: Parameters<RealtimeModelAdapter['run']>[0]) => ({
      requestId: request.requestId,
      sessionId: request.sessionId,
      generation: request.generation,
      modelId: request.modelId,
      finalTranscript: '  你好  ',
    })),
    cancel: vi.fn(),
    ...overrides,
  } satisfies RealtimeModelAdapter
}

function request(generation = 1, signal?: AbortSignal) {
  return {
    requestId: `request-${generation}`,
    sessionId: 'voice-session',
    generation,
    audioStream: audioStream(),
    ...(signal ? { signal } : {}),
  }
}

describe('realtime model contract', () => {
  it('is disabled by default and only releases a final transcript through the sink', async () => {
    const sink = vi.fn()
    const provider = adapter()
    const controller = new RealtimeModelController({
      adapter: provider,
      sessionId: 'voice-session',
      generation: 1,
      sink: { onFinalTranscript: sink },
    })

    expect(controller.enabled).toBe(false)
    await expect(controller.run(request())).rejects.toMatchObject({ code: 'disabled' })
    expect(provider.run).not.toHaveBeenCalled()

    controller.setEnabled(true)
    const result = await controller.run(request())
    expect(result).toEqual({
      requestId: 'request-1',
      sessionId: 'voice-session',
      generation: 1,
      modelId: 'test-realtime-model',
      finalTranscript: '你好',
    })
    expect(sink).toHaveBeenCalledOnce()
    expect(sink).toHaveBeenCalledWith(result)
  })

  it('rejects extra provider output and mismatched generations at the response boundary', () => {
    const expected = { requestId: 'request-1', sessionId: 'voice-session', generation: 1, modelId: 'test-realtime-model' }
    expect(parseRealtimeModelFinalTranscript({ ...expected, finalTranscript: 'ok', audio: 'forbidden' }, expected)).toEqual({ ok: false, code: 'response-invalid' })
    expect(parseRealtimeModelFinalTranscript({ ...expected, generation: 2, finalTranscript: 'ok' }, expected)).toEqual({ ok: false, code: 'stale-generation' })
    expect(parseRealtimeModelFinalTranscript({ ...expected, finalTranscript: 'line\nbreak' }, expected)).toEqual({ ok: false, code: 'response-invalid' })
  })

  it('propagates AbortSignal and cancellation without emitting a stale transcript', async () => {
    let rejectRun!: (reason?: unknown) => void
    const provider = adapter({
      run: vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<unknown>((_, reject) => {
        rejectRun = reject
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })),
    })
    const sink = vi.fn()
    const controller = new RealtimeModelController({
      adapter: provider,
      sessionId: 'voice-session',
      generation: 1,
      enabled: true,
      sink: { onFinalTranscript: sink },
    })

    const pending = controller.run(request())
    expect(provider.run).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      generation: 1,
      signal: expect.any(AbortSignal),
    }))
    await controller.cancel('user-stop')
    rejectRun(new DOMException('late provider result', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(provider.cancel).toHaveBeenCalledWith('request-1', 'user-stop')
    expect(sink).not.toHaveBeenCalled()
  })

  it('invalidates an active request when generation advances', async () => {
    let resolveRun!: (value: unknown) => void
    const provider = adapter({
      run: vi.fn(() => new Promise<unknown>((resolve) => {
        resolveRun = resolve
      })),
    })
    const sink = vi.fn()
    const controller = new RealtimeModelController({
      adapter: provider,
      sessionId: 'voice-session',
      generation: 1,
      enabled: true,
      sink: { onFinalTranscript: sink },
    })

    const pending = controller.run(request())
    await controller.setGeneration(2)
    resolveRun({
      requestId: 'request-1',
      sessionId: 'voice-session',
      generation: 1,
      modelId: 'test-realtime-model',
      finalTranscript: 'stale',
    })
    await expect(pending).rejects.toMatchObject({ code: 'stale-generation' })
    expect(sink).not.toHaveBeenCalled()
    expect(controller.generation).toBe(2)
  })

  it('releases a timed-out old run before starting the next generation', async () => {
    vi.useFakeTimers()
    try {
      let resolveFirst!: (value: unknown) => void
      const provider = adapter({
        run: vi.fn()
          .mockImplementationOnce(() => new Promise<unknown>((resolve) => {
            resolveFirst = resolve
          }))
          .mockImplementationOnce(async (request: Parameters<RealtimeModelAdapter['run']>[0]) => ({
            requestId: request.requestId,
            sessionId: request.sessionId,
            generation: request.generation,
            modelId: request.modelId,
            finalTranscript: 'new generation',
          })),
      })
      const controller = new RealtimeModelController({
        adapter: provider,
        sessionId: 'voice-session',
        generation: 1,
        enabled: true,
      })

      const first = controller.run(request(1))
      const switching = controller.setGeneration(2)
      await vi.advanceTimersByTimeAsync(REALTIME_MODEL_CANCEL_WAIT_MS)
      await switching

      await expect(controller.run(request(2))).resolves.toMatchObject({
        generation: 2,
        finalTranscript: 'new generation',
      })

      resolveFirst({
        requestId: 'request-1',
        sessionId: 'voice-session',
        generation: 1,
        modelId: 'test-realtime-model',
        finalTranscript: 'stale',
      })
      await expect(first).rejects.toMatchObject({ code: 'stale-generation' })
    }
    finally {
      vi.useRealTimers()
    }
  })
})
