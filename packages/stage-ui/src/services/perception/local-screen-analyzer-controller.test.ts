import type {
  LocalOllamaScreenAnalysisResult,
  LocalOllamaScreenValidationResult,
} from './local-ollama-screen-runtime'
import type { LocalScreenRuntimePort } from './local-screen-analyzer-controller'

import { describe, expect, it, vi } from 'vitest'

import {
  PERCEPTION_CONTRACT_VERSION,
  PerceptionStateManager,
} from '../../domains/perception'
import { createConsentGrant } from '../../domains/perception/test-fixtures'
import {
  LocalScreenAnalyzerController,
} from './local-screen-analyzer-controller'
import { parseLocalScreenObjectiveResponse } from './local-screen-objective-parser'

function createRuntime(overrides: Partial<LocalScreenRuntimePort> = {}): LocalScreenRuntimePort {
  return {
    validate: vi.fn(async () => ({
      runtimeVersion: '0.30.11',
      runtimeModelTag: 'qwen3-vl:4b-instruct-q4_K_M' as const,
      digest: 'ee4b975b58c17ce268cd19d40db35d5edc64603035d2ffc1fee1968eb0947f7b',
      license: 'Apache-2.0',
      profile: {
        contractVersion: PERCEPTION_CONTRACT_VERSION,
        profileId: 'screen:qwen3-vl-4b-instruct:ollama',
        adapterId: 'screen:ollama-local',
        generation: 2,
        modelId: 'Qwen/Qwen3-VL-4B-Instruct' as const,
        runtimeKind: 'ollama',
        targetResolution: '1280x720',
        normalFpsMax: 0.2,
        activeFpsMax: 1,
        state: 'ready' as const,
        capabilities: ['single-image', 'multi-image', 'strict-json-schema'],
      },
    } satisfies LocalOllamaScreenValidationResult)),
    analyze: vi.fn(async (request) => {
      const parsed = parseLocalScreenObjectiveResponse(JSON.stringify({
        events: [{
          eventType: 'screen.activity.observed',
          value: { kind: 'enum', value: 'code' },
          confidence: 0.9,
        }],
      }), request.envelope)
      if (!parsed.ok)
        throw new Error(parsed.code)
      return {
        events: parsed.events,
        totalDurationMs: 100,
        loadDurationMs: 10,
        promptTokenCount: 20,
        outputTokenCount: 8,
      }
    }),
    stop: vi.fn(async () => undefined),
    ...overrides,
  }
}

function createFrame(sequence: number, release: (reason: string) => void) {
  const jpegBytes = new Uint8Array([0xFF, 0xD8, sequence, 0xFF, 0xD9])
  return {
    frameId: `frame:${sequence}`,
    observationId: `observation:${sequence}`,
    sessionId: 'session:screen',
    sourceId: 'window:external',
    generation: 2,
    capturedAt: 1_000 + sequence,
    byteLength: jpegBytes.byteLength,
    jpegBytes,
    release,
  }
}

function createHarness(runtime = createRuntime()) {
  const outcomes: boolean[] = []
  const errors: string[] = []
  const manager = new PerceptionStateManager({
    sessionId: 'session:screen',
    generation: 2,
    clock: { now: () => 1_000 },
  })
  const grant = createConsentGrant({
    sourceKind: 'screen',
    sourceId: 'window:external',
    processingMode: 'local-only',
    allowedModalities: ['screen-frames'],
    allowedFactCategories: ['screen.activity'],
  })
  const controller = new LocalScreenAnalyzerController({
    sessionId: 'session:screen',
    sourceId: 'window:external',
    generation: 2,
    runtime,
    stateManager: manager,
    getConsentGrant: () => grant,
    isSourceHealthy: () => true,
    onIngestResult: result => outcomes.push(result.ok),
    onError: code => errors.push(code),
  })
  return { controller, errors, manager, outcomes, runtime }
}

describe('local screen analyzer controller', () => {
  it('allows frames only after validated identity and submits events through the state manager', async () => {
    const { controller, manager, outcomes, runtime } = createHarness()
    const earlyRelease = vi.fn()
    expect(controller.offer(createFrame(0, earlyRelease))).toBe('rejected')
    expect(earlyRelease).toHaveBeenCalledWith('analyzer-not-ready')

    await expect(controller.start()).resolves.toMatchObject({ ok: true })
    await expect(controller.start()).resolves.toMatchObject({ ok: true })
    expect(runtime.validate).toHaveBeenCalledOnce()
    const releases = [vi.fn(), vi.fn()]
    expect(controller.offer(createFrame(1, releases[0]!))).toBe('processing')
    await vi.waitFor(() => expect(releases[0]).toHaveBeenCalledWith('processed'))
    expect(controller.offer(createFrame(2, releases[1]!))).toBe('processing')
    await vi.waitFor(() => expect(releases[1]).toHaveBeenCalledWith('processed'))

    expect(outcomes).toEqual([false, true])
    expect(manager.snapshot().acceptedFactIds).toHaveLength(1)
    expect(manager.listFacts().at(-1)).toMatchObject({
      state: 'accepted',
      source: { kind: 'screen-local', sourceId: 'window:external' },
      predicate: 'activity',
    })
  })

  it('rejects mismatched metadata before raw bytes reach the runtime', async () => {
    const runtime = createRuntime()
    const { controller, errors } = createHarness(runtime)
    await controller.start()
    const release = vi.fn()
    const frame = createFrame(1, release)
    frame.sourceId = 'window:other'

    expect(controller.offer(frame)).toBe('rejected')
    expect(release).toHaveBeenCalledWith('invalid-frame-metadata')
    expect(runtime.analyze).not.toHaveBeenCalled()
    expect(errors).toEqual(['screen-frame-metadata-invalid'])
  })

  it('unloads a validated runtime when its generation does not match the selection', async () => {
    const base = createRuntime()
    const runtime = createRuntime({
      validate: vi.fn(async (signal) => {
        const result = await base.validate(signal)
        return { ...result, profile: { ...result.profile, generation: 3 } }
      }),
    })
    const { controller, errors } = createHarness(runtime)

    await expect(controller.start()).resolves.toEqual({ ok: false, code: 'model-identity-mismatch' })
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(errors).toEqual(['model-identity-mismatch'])
  })

  it('does not expose a degraded or incomplete runtime as production-ready', async () => {
    const base = createRuntime()
    const runtime = createRuntime({
      validate: vi.fn(async (signal) => {
        const result = await base.validate(signal)
        return {
          ...result,
          profile: {
            ...result.profile,
            state: 'degraded' as const,
            capabilities: ['single-image', 'strict-json-schema'],
            lastErrorCode: 'runtime-multi-image-unsupported',
          },
        }
      }),
    })
    const { controller, errors } = createHarness(runtime)

    await expect(controller.start()).resolves.toEqual({ ok: false, code: 'screen-runtime-capability-mismatch' })
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(errors).toEqual(['screen-runtime-capability-mismatch'])
  })

  it('cancels in-flight analysis, releases the frame and revokes facts on stop', async () => {
    let inferenceSignal!: AbortSignal
    const runtime = createRuntime({
      analyze: vi.fn(async request => new Promise<LocalOllamaScreenAnalysisResult>((_resolve, reject) => {
        inferenceSignal = request.signal as AbortSignal
        inferenceSignal.addEventListener('abort', () => reject(new Error('private provider error')), { once: true })
      })),
    })
    const { controller } = createHarness(runtime)
    await controller.start()
    const release = vi.fn()
    controller.offer(createFrame(1, release))
    await vi.waitFor(() => expect(inferenceSignal).toBeInstanceOf(AbortSignal))

    await controller.stop()
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('scheduler-stopped'))
    expect(inferenceSignal.aborted).toBe(true)
    expect(runtime.stop).toHaveBeenCalledOnce()
  })
})
