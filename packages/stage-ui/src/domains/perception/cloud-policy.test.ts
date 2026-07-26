import { describe, expect, it } from 'vitest'

import {
  approvedQwenCloudPerceptionPolicy,
  estimateQwenRealtimeCost,
  evaluateQwenCloudReadiness,
  parseQwenCloudPerceptionPolicy,
  QWEN_CLOUD_PRICE_PROFILE_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
  QWEN_PLUS_REALTIME_MODEL_ID,
  QwenCloudCostLedger,
} from './cloud-policy'

describe('qwen cloud perception policy', () => {
  it('accepts only the approved China mainland policy', () => {
    expect(parseQwenCloudPerceptionPolicy(structuredClone(approvedQwenCloudPerceptionPolicy)).success).toBe(true)

    const cameraPlus = structuredClone(approvedQwenCloudPerceptionPolicy) as any
    cameraPlus.camera.modelId = QWEN_PLUS_REALTIME_MODEL_ID
    expect(parseQwenCloudPerceptionPolicy(cameraPlus)).toEqual({ success: false, errorCode: 'cloud-policy-invalid' })

    const expandedConsent = structuredClone(approvedQwenCloudPerceptionPolicy) as any
    expandedConsent.consent.cameraFrames = 'always'
    expect(parseQwenCloudPerceptionPolicy(expandedConsent)).toEqual({ success: false, errorCode: 'cloud-policy-invalid' })
  })

  it('reports every missing external prerequisite without exposing values', () => {
    expect(evaluateQwenCloudReadiness({
      workspaceConfigured: false,
      apiKeyConfigured: false,
      providerRetentionVerified: false,
      modelAvailabilityVerified: false,
      providerClientAvailable: false,
    })).toEqual({
      state: 'blocked',
      blockingCodes: [
        'workspace-missing',
        'api-key-missing',
        'provider-retention-unverified',
        'model-availability-unverified',
        'provider-client-unavailable',
      ],
      workspaceConfigured: false,
      apiKeyConfigured: false,
      providerRetentionVerified: false,
      modelAvailabilityVerified: false,
      providerClientAvailable: false,
    })
  })

  it('uses the rechecked text-only China mainland price profile', () => {
    expect(estimateQwenRealtimeCost(QWEN_FLASH_REALTIME_MODEL_ID, {
      inputTextImageTokens: 1_000_000,
      inputAudioTokens: 1_000_000,
      outputTextTokens: 1_000_000,
    })).toEqual({
      ok: true,
      amountMicros: 50_300_000,
      amountCny: 50.3,
      priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
    })
    expect(estimateQwenRealtimeCost(QWEN_PLUS_REALTIME_MODEL_ID, {
      inputTextImageTokens: 0,
      inputAudioTokens: 0,
      outputTextTokens: 0,
      outputAudioTokens: 1,
    })).toEqual({ ok: false, errorCode: 'cloud-output-audio-forbidden' })
  })
})

describe('qwen cloud cost ledger', () => {
  const now = Date.UTC(2026, 6, 17, 2)

  it('stops before session, China-day, or China-month limits are exceeded', () => {
    const ledger = new QwenCloudCostLedger({ now: () => now })
    expect(ledger.record(entry('session-a', 4_900_000, now)).allowed).toBe(true)
    expect(ledger.authorize('session-a', 100_001)).toMatchObject({ allowed: false, boundary: 'session' })

    expect(ledger.record(entry('session-b', 5_000_000, now)).allowed).toBe(true)
    expect(ledger.authorize('session-c', 100_001)).toMatchObject({ allowed: false, boundary: 'day' })

    const restored = Array.from({ length: 9 }, (_, index) => entry(`prior-${index}`, 5_000_000, Date.UTC(2026, 6, 1 + index)))
    const monthlyLedger = new QwenCloudCostLedger({ now: () => now, restoredEntries: restored })
    expect(monthlyLedger.authorize('session-new', 5_000_001)).toMatchObject({ allowed: false, boundary: 'session' })
    expect(monthlyLedger.authorize('session-new', 5_000_000)).toMatchObject({ allowed: true })
    expect(monthlyLedger.record(entry('session-new', 5_000_000, now)).allowed).toBe(true)
    expect(monthlyLedger.authorize('session-final', 5_000_001)).toMatchObject({ allowed: false, boundary: 'session' })
    expect(monthlyLedger.authorize('session-final', 5_000_000)).toMatchObject({ allowed: false, boundary: 'month' })
  })

  it('exports only sanitized cost metadata', () => {
    const ledger = new QwenCloudCostLedger({ now: () => now })
    ledger.record(entry('session-safe', 250_000, now))
    expect(ledger.exportEntries()).toEqual([entry('session-safe', 250_000, now)])
    expect(JSON.stringify(ledger.exportEntries())).not.toMatch(/audio|image|response|api.?key|workspace/iu)
  })

  it('records already-incurred cost even when the request crosses a limit', () => {
    const ledger = new QwenCloudCostLedger({ now: () => now })
    expect(ledger.record(entry('session-crossing', 4_900_000, now)).allowed).toBe(true)
    expect(ledger.recordIncurred(entry('session-crossing', 200_000, now))).toMatchObject({
      allowed: false,
      boundary: 'session',
      snapshot: { sessionSpent: 5.1 },
    })
    expect(ledger.authorize('session-crossing', 1)).toMatchObject({ allowed: false, boundary: 'session' })
  })
})

function entry(sessionId: string, amountMicros: number, incurredAt: number) {
  return {
    sessionId,
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    incurredAt,
    amountMicros,
    priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
  } as const
}
