import type { ObjectivePerceptionEvent } from '@proj-airi/stage-ui/domains/perception'

import { describe, expect, it } from 'vitest'

import {
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_PROFILE_ID,
  MAX_LOCAL_SCREEN_FRAME_BYTES,
  parseLocalScreenAnalyzeMessage,
  parseLocalScreenAnalyzeResponse,
  parseLocalScreenGatewayValidateRequest,
} from './perception-local-screen'

const correlation = {
  contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
  sessionId: 'session:local-screen',
  generation: 2,
  observationId: 'observation:1',
} as const

function jpeg(size = 4): Uint8Array {
  const value = new Uint8Array(size)
  value[0] = 0xFF
  value[1] = 0xD8
  value[size - 2] = 0xFF
  value[size - 1] = 0xD9
  return value
}

function event(): ObjectivePerceptionEvent {
  return {
    contractVersion: 'perception/v0.3',
    eventId: 'observation:1:e0',
    observationId: correlation.observationId,
    sessionId: correlation.sessionId,
    generation: correlation.generation,
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
      modelId: 'Qwen/Qwen3-VL-4B-Instruct',
      adapterId: 'screen:transformers-local',
    },
  }
}

describe('local screen Eventa contract', () => {
  it('strictly validates the control request and rejects secret-shaped extras', () => {
    const request = {
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: correlation.sessionId,
      generation: correlation.generation,
      consentGrantId: 'grant:screen-local',
      profileId: LOCAL_SCREEN_PROFILE_ID,
    }
    expect(parseLocalScreenGatewayValidateRequest(request)).toEqual({ ok: true, value: request })
    expect(parseLocalScreenGatewayValidateRequest({ ...request, token: 'forbidden' })).toEqual({ ok: false, errorCode: 'invalid-schema' })
  })

  it('accepts only exact 1280x720 bounded JPEG stream messages', () => {
    const frame = {
      ...correlation,
      type: 'frame',
      sequence: 1,
      capturedAt: 1_000,
      width: 1280,
      height: 720,
      jpeg: jpeg(),
    }
    expect(parseLocalScreenAnalyzeMessage(frame).ok).toBe(true)
    expect(parseLocalScreenAnalyzeMessage({ ...frame, width: 640 })).toEqual({ ok: false, errorCode: 'invalid-schema' })
    expect(parseLocalScreenAnalyzeMessage({ ...frame, jpeg: jpeg(MAX_LOCAL_SCREEN_FRAME_BYTES + 1) })).toEqual({ ok: false, errorCode: 'payload-too-large' })
  })

  it('validates objective events and their response correlation at the renderer edge', () => {
    const response = {
      ...correlation,
      events: [event()],
      totalDurationMs: 4_000,
      outputTokenCount: 24,
    }
    expect(parseLocalScreenAnalyzeResponse(response).ok).toBe(true)
    expect(parseLocalScreenAnalyzeResponse({
      ...response,
      events: [{ ...event(), generation: 1 }],
    })).toEqual({ ok: false, errorCode: 'invalid-schema' })
  })
})
