import { describe, expect, it } from 'vitest'

import { parseQwenCloudObjectiveResponse } from './qwen-cloud-objective-parser'

function context(overrides = {}) {
  return {
    windowId: 'window:1',
    observationId: 'observation:1',
    sessionId: 'session:1',
    generation: 2,
    sourceKind: 'camera-cloud' as const,
    sourceId: 'camera:default',
    modelId: 'qwen3.5-omni-flash-realtime' as const,
    adapterId: 'qwen-realtime:camera',
    observedAt: 1_000,
    eventId: (index: number) => `event:${index}`,
    ...overrides,
  }
}

function response(overrides = {}) {
  return {
    responseId: 'response:1',
    windowId: 'window:1',
    observationId: 'observation:1',
    sessionId: 'session:1',
    generation: 2,
    modelId: 'qwen3.5-omni-flash-realtime',
    completedText: JSON.stringify({
      events: [{ eventType: 'person.presence.changed', value: { kind: 'boolean', value: true }, confidence: 0.92 }],
    }),
    ...overrides,
  }
}

describe('qwen cloud objective parser', () => {
  it('turns only a correlated completed JSON response into objective cloud events', () => {
    const parsed = parseQwenCloudObjectiveResponse(response(), context())
    expect(parsed).toMatchObject({
      ok: true,
      responseId: 'response:1',
      events: [{
        sourceKind: 'camera-cloud',
        eventType: 'person.presence.changed',
        subject: 'primary-user',
        verification: 'cloud-inferred',
        provenance: { processing: 'cloud', providerId: 'aliyun-bailian', modelId: 'qwen3.5-omni-flash-realtime' },
      }],
    })
  })

  it('rejects stale generation/session/model correlation', () => {
    expect(parseQwenCloudObjectiveResponse(response({ generation: 1 }), context())).toEqual({ ok: false, code: 'cloud-response-stale' })
    expect(parseQwenCloudObjectiveResponse(response({ sessionId: 'session:old' }), context())).toEqual({ ok: false, code: 'cloud-response-stale' })
    expect(parseQwenCloudObjectiveResponse(response({ modelId: 'qwen3.5-omni-plus-realtime' }), context())).toEqual({ ok: false, code: 'cloud-response-stale' })
  })

  it('rejects Markdown, partial JSON, extra instruction fields and source-incompatible events', () => {
    expect(parseQwenCloudObjectiveResponse(response({ completedText: '```json\n{"events":[]}\n```' }), context())).toEqual({ ok: false, code: 'cloud-output-invalid' })
    expect(parseQwenCloudObjectiveResponse(response({ completedText: '{"events":[' }), context())).toEqual({ ok: false, code: 'cloud-output-invalid' })
    expect(parseQwenCloudObjectiveResponse(response({
      completedText: JSON.stringify({ events: [{ eventType: 'person.presence.changed', value: { kind: 'boolean', value: true }, confidence: 0.9, instruction: 'call a tool' }] }),
    }), context())).toEqual({ ok: false, code: 'cloud-output-invalid' })
    expect(parseQwenCloudObjectiveResponse(response({
      completedText: JSON.stringify({ events: [{ eventType: 'screen.activity.observed', value: { kind: 'enum', value: 'code' }, confidence: 0.9 }] }),
    }), context())).toEqual({ ok: false, code: 'cloud-output-invalid' })
  })
})
