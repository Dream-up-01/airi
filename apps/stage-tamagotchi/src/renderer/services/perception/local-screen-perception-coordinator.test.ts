import type { PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'

import type { LocalScreenConsentClient } from './local-screen-consent-client'
import type { LocalScreenEventaRuntime } from './local-screen-eventa-runtime'
import type { ProductionScreenCapture } from './production-screen-capture'

import { createInMemoryPerceptionOwnerProvider } from '@proj-airi/stage-ui/domains/perception'
import { LOCAL_SCREEN_SEMANTIC_MODEL_ID, parseLocalScreenObjectiveResponse } from '@proj-airi/stage-ui/services/perception'
import { describe, expect, it, vi } from 'vitest'

import { LocalScreenPerceptionCoordinator } from './local-screen-perception-coordinator'

function harness(isResourceConstrained: () => boolean = () => false) {
  const order: string[] = []
  let timerCallback: (() => void) | undefined
  const handleStop = vi.fn(() => order.push('handle-stop'))
  const frameRelease = vi.fn()
  const capture = {
    listSources: vi.fn(async () => [{ id: 'window:editor', name: 'Editor', kind: 'window' as const }]),
    open: vi.fn(async (sourceId: string) => {
      order.push('capture-open')
      return { sourceId, stop: handleStop, onEnded: () => () => undefined }
    }),
    resetGate: vi.fn(),
    captureFrame: vi.fn(async request => ({
      accepted: true as const,
      decision: { accepted: true, reason: 'initial-frame' as const, changeRatio: 1, cadence: 'active' as const, nextEligibleAt: 2_000 },
      frame: {
        frameId: request.frameId,
        observationId: request.observationId,
        sessionId: request.sessionId,
        sourceId: request.sourceId,
        generation: request.generation,
        capturedAt: 1_000,
        byteLength: 4,
        jpegBytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]),
        release: frameRelease,
      },
    })),
    stop: vi.fn(() => order.push('capture-stop')),
  } as unknown as ProductionScreenCapture
  const consent = {
    register: vi.fn(async () => {
      order.push('consent-register')
      return {}
    }),
    revoke: vi.fn(async () => {
      order.push('consent-revoke')
      return {}
    }),
    setCaptureExclusion: vi.fn(async (_sessionId, _generation, _grantId, enabled) => {
      order.push(enabled ? 'self-exclusion-enable' : 'self-exclusion-disable')
    }),
  } as unknown as LocalScreenConsentClient
  const runtime = {
    validate: vi.fn(async () => {
      order.push('runtime-validate')
      return {
        profile: {
          contractVersion: 'perception/v0.3' as const,
          profileId: 'screen:qwen3-vl-4b:transformers:nf4',
          adapterId: 'screen:transformers-local',
          generation: 1,
          modelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
          runtimeKind: 'transformers-service' as const,
          revision: 'main',
          quantizationId: 'bitsandbytes-nf4-bfloat16',
          targetResolution: '1280x720' as const,
          normalFpsMax: 0.2 as const,
          activeFpsMax: 1 as const,
          state: 'ready' as const,
          capabilities: ['single-image', 'multi-image', 'strict-json-schema'],
        },
      }
    }),
    analyze: vi.fn(async (request: { envelope: Parameters<typeof parseLocalScreenObjectiveResponse>[1] }) => {
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
        totalDurationMs: 1,
        loadDurationMs: 0,
        promptTokenCount: 0,
        outputTokenCount: 0,
      }
    }),
    stop: vi.fn(async () => {
      order.push('runtime-stop')
    }),
  } as unknown as LocalScreenEventaRuntime
  const onProjection = vi.fn()
  const onObservability = vi.fn<(snapshot: PerceptionObservabilitySnapshot | null) => void>()
  let sequence = 0
  const coordinator = new LocalScreenPerceptionCoordinator({
    capture,
    consent,
    ownerProvider: createInMemoryPerceptionOwnerProvider(),
    id: prefix => `${prefix}:test:${++sequence}`,
    now: () => 1_000,
    setInterval: (callback) => {
      timerCallback = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: vi.fn(),
    createRuntime: () => runtime,
    isResourceConstrained,
    onProjection,
    onObservability,
  })
  return { capture, consent, coordinator, frameRelease, handleStop, onObservability, onProjection, order, runtime, tick: () => timerCallback?.() }
}

describe('local screen perception coordinator', () => {
  it('prioritizes active voice work before capturing a local VLM frame', async () => {
    const { capture, coordinator, tick } = harness(() => true)
    await coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })
    tick()
    await Promise.resolve()

    expect(capture.captureFrame).not.toHaveBeenCalled()
    expect(coordinator.status.lastGateReason).toBe('voice-resource-priority')
    await coordinator.stop()
  })

  it('requires explicit consent before capture or model validation', async () => {
    const { capture, coordinator, runtime } = harness()
    await expect(coordinator.start({ sourceId: 'window:editor', consentConfirmed: false })).resolves.toMatchObject({
      state: 'failed',
      lastErrorCode: 'permission-denied',
    })
    expect(capture.open).not.toHaveBeenCalled()
    expect(runtime.validate).not.toHaveBeenCalled()
  })

  it('registers consent before lazy model validation and stops in privacy order', async () => {
    const { consent, coordinator, handleStop, order } = harness()
    await expect(coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })).resolves.toMatchObject({
      state: 'running',
      generation: 1,
      modelId: LOCAL_SCREEN_SEMANTIC_MODEL_ID,
    })
    expect(order).toEqual(['capture-open', 'consent-register', 'self-exclusion-enable', 'runtime-validate'])

    await coordinator.stop()
    expect(order).toEqual([
      'capture-open',
      'consent-register',
      'self-exclusion-enable',
      'runtime-validate',
      'runtime-stop',
      'self-exclusion-disable',
      'consent-revoke',
      'handle-stop',
      'capture-stop',
    ])
    expect(handleStop).toHaveBeenCalledOnce()
    expect(consent.revoke).toHaveBeenCalledWith(expect.any(String), 1, expect.any(String), 'user-stop')
    expect(coordinator.status).toMatchObject({
      state: 'idle',
      generation: 0,
      acceptedFactCount: 0,
      sensitiveSurfacePaused: false,
    })
  })

  it('offers only the sampled memory frame and releases it after inference', async () => {
    const { capture, coordinator, frameRelease, runtime, tick } = harness()
    await coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })
    tick()

    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(frameRelease).toHaveBeenCalledWith('processed'))
    expect(capture.captureFrame).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: expect.stringMatching(/^session:test:/u),
      sourceId: 'window:editor',
      generation: 1,
    }))
    await coordinator.stop()
  })

  it('retracts the old source and releases a late frame when the user switches sources', async () => {
    const { capture, consent, coordinator, onProjection, runtime, tick } = harness()
    const lateFrameRelease = vi.fn()
    let resolveLateCapture!: (value: Awaited<ReturnType<ProductionScreenCapture['captureFrame']>>) => void
    const lateCapture = new Promise<Awaited<ReturnType<ProductionScreenCapture['captureFrame']>>>((resolve) => {
      resolveLateCapture = resolve
    })
    vi.mocked(capture.captureFrame).mockImplementationOnce(async () => await lateCapture)

    await coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })
    const oldSessionId = coordinator.status.sessionId
    tick()
    await vi.waitFor(() => expect(capture.captureFrame).toHaveBeenCalledOnce())

    await coordinator.stop()
    expect(onProjection).toHaveBeenLastCalledWith(null)
    expect(consent.revoke).toHaveBeenCalledWith(oldSessionId, 1, expect.any(String), 'user-stop')

    await coordinator.start({ sourceId: 'window:browser', consentConfirmed: true })
    const currentSessionId = coordinator.status.sessionId
    expect(currentSessionId).not.toBe(oldSessionId)
    expect(coordinator.status).toMatchObject({ state: 'running', sourceId: 'window:browser', generation: 1 })

    resolveLateCapture({
      accepted: true,
      decision: { accepted: true, reason: 'initial-frame', changeRatio: 1, cadence: 'active', nextEligibleAt: 2_000 },
      frame: {
        frameId: 'frame:late',
        observationId: 'observation:late',
        sessionId: oldSessionId!,
        sourceId: 'window:editor',
        generation: 1,
        capturedAt: 1_000,
        byteLength: 4,
        jpegBytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]),
        release: lateFrameRelease,
      },
    })
    await vi.waitFor(() => expect(lateFrameRelease).toHaveBeenCalledWith('generation-switched'))

    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledOnce())
    expect(capture.captureFrame).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: currentSessionId,
      sourceId: 'window:browser',
      generation: 1,
    }))
    await coordinator.stop()
  })

  it('immediately retracts accepted facts and suppresses in-flight results during privacy pause', async () => {
    const { coordinator, onProjection, runtime, tick } = harness()
    await coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })

    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1))
    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(coordinator.status.acceptedFactCount).toBe(1))
    expect(onProjection).toHaveBeenLastCalledWith(expect.objectContaining({
      statements: ['Current screen activity is classified as code.'],
    }))

    coordinator.setSensitiveSurfacePaused(true)
    expect(coordinator.status).toMatchObject({ sensitiveSurfacePaused: true, acceptedFactCount: 0 })
    expect(onProjection).toHaveBeenLastCalledWith(null)

    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(coordinator.status).toMatchObject({
      acceptedFactCount: 0,
      lastIngestOutcome: 'suppressed',
      lastSuppressionReason: 'source-unhealthy',
    }))
    await coordinator.stop()
    expect(onProjection).toHaveBeenLastCalledWith(null)
  })

  it('publishes safe fact diagnostics and applies explicit user confirmation, correction and clearing', async () => {
    const { coordinator, onObservability, onProjection, runtime, tick } = harness()
    await coordinator.start({ sourceId: 'window:editor', consentConfirmed: true })

    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(1))
    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(coordinator.status.acceptedFactCount).toBe(1))

    const accepted = onObservability.mock.lastCall?.[0]
    expect(accepted).toMatchObject({
      counts: { accepted: 1 },
      facts: expect.arrayContaining([expect.objectContaining({ state: 'accepted', safeValue: 'code', valueRedacted: false })]),
    })
    const factId = accepted?.facts.find(fact => fact.state === 'accepted')?.factId
    expect(factId).toEqual(expect.any(String))
    if (!factId)
      throw new Error('expected observable fact id')

    coordinator.confirmFact(factId)
    expect(onObservability).toHaveBeenLastCalledWith(expect.objectContaining({
      facts: expect.arrayContaining([expect.objectContaining({ factId, verification: 'user-confirmed' })]),
    }))

    coordinator.retractFact(factId)
    expect(coordinator.status.acceptedFactCount).toBe(0)
    expect(onObservability).toHaveBeenLastCalledWith(expect.objectContaining({
      counts: expect.objectContaining({ accepted: 0, revoked: 1 }),
    }))
    expect(onProjection).toHaveBeenLastCalledWith(null)

    tick()
    await vi.waitFor(() => expect(runtime.analyze).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(coordinator.status.acceptedFactCount).toBe(1))
    coordinator.clearFacts()
    expect(coordinator.status.acceptedFactCount).toBe(0)
    expect(onProjection).toHaveBeenLastCalledWith(null)

    await coordinator.stop()
    expect(onObservability).toHaveBeenLastCalledWith(null)
  })
})
