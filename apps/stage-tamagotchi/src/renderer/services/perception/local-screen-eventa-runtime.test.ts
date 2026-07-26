import type { ObjectivePerceptionEvent } from '@proj-airi/stage-ui/domains/perception'

import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  LOCAL_SCREEN_MODEL_REVISION,
  LOCAL_SCREEN_PROFILE_ID,
  LOCAL_SCREEN_QUANTIZATION_ID,
} from '../../../shared/eventa/perception-local-screen'
import { LocalScreenEventaRuntime } from './local-screen-eventa-runtime'

const sessionId = 'session:local-screen'
const generation = 2
const observationId = 'observation:1'

function event(): ObjectivePerceptionEvent {
  return {
    contractVersion: 'perception/v0.3',
    eventId: 'observation:1:e0',
    observationId,
    sessionId,
    generation,
    sourceKind: 'screen-local',
    sourceId: 'screen:1',
    analyzers: ['qwen3-vl:screen-objective'],
    eventType: 'screen.activity.observed',
    phase: 'observed',
    subject: 'environment',
    value: { kind: 'enum', value: 'code' },
    confidence: 0.9,
    observedAt: 1_000,
    expiresAt: 31_000,
    verification: 'multi-frame-inferred',
    sensitivity: 'personal',
    provenance: {
      analyzerId: 'qwen3-vl:screen-objective',
      processing: 'local',
      providerId: 'transformers-service',
      modelId: LOCAL_SCREEN_MODEL_ID,
      adapterId: 'screen:transformers-local',
    },
  }
}

function readyStatus() {
  return {
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId,
    generation,
    profileId: LOCAL_SCREEN_PROFILE_ID,
    state: 'ready' as const,
    modelId: LOCAL_SCREEN_MODEL_ID,
    revision: LOCAL_SCREEN_MODEL_REVISION,
    quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
    capabilities: ['single-image', 'multi-image', 'strict-json-schema', 'abort', 'process-exit-unload'],
    loadDurationMs: 12_000,
  }
}

describe('renderer local screen Eventa runtime', () => {
  it('validates through main without exposing a worker token and streams transient JPEG messages', async () => {
    const messages: unknown[] = []
    const invocations = {
      validate: vi.fn(async () => readyStatus()),
      analyze: vi.fn(async (stream: ReadableStream<unknown>) => {
        for await (const message of stream)
          messages.push(message)
        return {
          contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
          sessionId,
          generation,
          observationId,
          events: [event()],
          totalDurationMs: 4_000,
          outputTokenCount: 24,
        }
      }),
      stop: vi.fn(async () => ({ ...readyStatus(), state: 'stopped' as const })),
    }
    const runtime = new LocalScreenEventaRuntime({
      consentGrantId: 'grant:screen-local',
      sessionId,
      generation,
      sourceId: 'screen:1',
      invocations,
    })

    await expect(runtime.validate()).resolves.toMatchObject({
      profile: { state: 'ready', generation, adapterId: 'screen:transformers-local' },
    })
    const result = await runtime.analyze({
      jpegFrames: [new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])],
      envelope: {
        observationId,
        sessionId,
        generation,
        sourceId: 'screen:1',
        observedAt: 1_000,
        eventId: index => `${observationId}:e${index}`,
        adapterId: 'screen:transformers-local',
        runtimeModelId: LOCAL_SCREEN_MODEL_ID,
      },
    })
    expect(result.events[0]?.provenance.providerId).toBe('transformers-service')
    expect(messages.map(message => (message as { type: string }).type)).toEqual(['open', 'frame', 'complete'])
    expect(JSON.stringify(messages)).not.toContain('token')
    await expect(runtime.stop()).resolves.toBeUndefined()
  })

  it('rejects an objective response whose event correlation differs', async () => {
    const runtime = new LocalScreenEventaRuntime({
      consentGrantId: 'grant:screen-local',
      sessionId,
      generation,
      sourceId: 'screen:1',
      invocations: {
        validate: vi.fn(async () => readyStatus()),
        analyze: vi.fn(async () => ({
          contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
          sessionId,
          generation,
          observationId,
          events: [{ ...event(), generation: 1 }],
          totalDurationMs: 4_000,
          outputTokenCount: 24,
        })),
        stop: vi.fn(async () => ({ ...readyStatus(), state: 'stopped' as const })),
      },
    })
    await expect(runtime.analyze({
      jpegFrames: [new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])],
      envelope: {
        observationId,
        sessionId,
        generation,
        sourceId: 'screen:1',
        observedAt: 1_000,
        eventId: index => `${observationId}:e${index}`,
        adapterId: 'screen:transformers-local',
        runtimeModelId: LOCAL_SCREEN_MODEL_ID,
      },
    })).rejects.toMatchObject({ code: 'runtime-response-invalid' })
  })
})
