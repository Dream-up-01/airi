import type { ScreenModelRouteReason } from './contracts'

import { describe, expect, it } from 'vitest'

import { parseScreenModelRouteDecision } from './schemas'
import { ScreenCloudRouteController } from './screen-cloud-routing'

const reasons: ScreenModelRouteReason[] = [
  'flash-low-confidence',
  'consecutive-conflict',
  'complex-multi-window-relation',
  'temporal-process-reasoning',
  'user-requested-process-analysis',
  'tool-relevance-uncertain',
]

function harness() {
  let now = 1_000
  let consent = true
  let cost = true
  let sequence = 0
  const controller = new ScreenCloudRouteController({
    sessionId: 'session:1',
    generation: 2,
    consentGrantId: 'grant:cloud-screen',
    costCounterId: 'cost:screen',
    now: () => now,
    id: () => `decision:${++sequence}`,
    isConsentActive: () => consent,
    isCostAllowed: () => cost,
  })
  return {
    controller,
    advance: (value: number) => now += value,
    setConsent: (value: boolean) => consent = value,
    setCost: (value: boolean) => cost = value,
  }
}

describe('screen cloud route controller', () => {
  it('allows only the six reasons, one Plus request, then falls back to Flash with cooldown', () => {
    const value = harness()
    for (const reason of reasons) {
      const result = value.controller.request({
        sessionId: 'session:1',
        generation: 2,
        reason,
        evidenceFactIds: ['fact:1'],
        flashConfidence: reason === 'flash-low-confidence' ? 0.5 : undefined,
      })
      expect(result.ok).toBe(true)
      if (!result.ok)
        throw new Error(result.code)
      expect(parseScreenModelRouteDecision(result.decision).success).toBe(true)
      expect(value.controller.currentModelId).toBe('qwen3.5-omni-plus-realtime')
      expect(value.controller.request({ sessionId: 'session:1', generation: 2, reason, evidenceFactIds: ['fact:1'], flashConfidence: 0.5 })).toEqual({ ok: false, code: 'route-busy' })
      expect(value.controller.finish(result.decision.decisionId)).toBe(true)
      expect(value.controller.currentModelId).toBe('qwen3.5-omni-flash-realtime')
      expect(value.controller.request({ sessionId: 'session:1', generation: 2, reason, evidenceFactIds: ['fact:1'], flashConfidence: 0.5 })).toEqual({ ok: false, code: 'route-cooldown' })
      value.advance(30_000)
    }
  })

  it('requires current generation, low confidence, consent, cost guard and evidence', () => {
    const value = harness()
    const request = { sessionId: 'session:1', generation: 2, reason: 'flash-low-confidence' as const, evidenceFactIds: ['fact:1'], flashConfidence: 0.5 }
    expect(value.controller.request({ ...request, generation: 1 })).toEqual({ ok: false, code: 'route-stale' })
    expect(value.controller.request({ ...request, flashConfidence: 0.65 })).toEqual({ ok: false, code: 'route-confidence-sufficient' })
    expect(value.controller.request({ ...request, evidenceFactIds: [] })).toEqual({ ok: false, code: 'route-evidence-invalid' })
    value.setConsent(false)
    expect(value.controller.request(request)).toEqual({ ok: false, code: 'route-consent-missing' })
    value.setConsent(true)
    value.setCost(false)
    expect(value.controller.request(request)).toEqual({ ok: false, code: 'route-cost-blocked' })
  })
})
