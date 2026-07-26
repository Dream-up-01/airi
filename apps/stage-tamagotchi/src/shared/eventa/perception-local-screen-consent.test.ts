import { describe, expect, it } from 'vitest'

import {
  LOCAL_SCREEN_CONSENT_VERSION,
  parseLocalScreenConsentRegisterRequest,
  parseLocalScreenConsentRevokeRequest,
} from './perception-local-screen-consent'

function grant() {
  return {
    contractVersion: 'perception/v0.3',
    grantId: 'grant:screen-local',
    sourceKind: 'screen',
    sourceId: 'screen:primary',
    processingMode: 'local-only',
    allowedModalities: ['screen-frames'],
    allowedFactCategories: ['screen.activity', 'screen.health'],
    grantedAt: 1_000,
    showPersistentIndicator: true,
  }
}

describe('local screen consent Eventa contract', () => {
  it('accepts only local screen-frame grants with a persistent indicator', () => {
    const input = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: grant(),
    }
    expect(parseLocalScreenConsentRegisterRequest(input).ok).toBe(true)
    expect(parseLocalScreenConsentRegisterRequest({
      ...input,
      grant: { ...grant(), showPersistentIndicator: false },
    })).toEqual({ ok: false, errorCode: 'consent-policy-violation' })
    expect(parseLocalScreenConsentRegisterRequest({
      ...input,
      grant: { ...grant(), allowedModalities: ['screen-frames', 'microphone-audio'] },
    })).toEqual({ ok: false, errorCode: 'consent-policy-violation' })
  })

  it('rejects cloud fields, non-screen categories and unknown wire keys', () => {
    const input = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: grant(),
    }
    expect(parseLocalScreenConsentRegisterRequest({
      ...input,
      grant: { ...grant(), cloudProviderId: 'aliyun' },
    })).toEqual({ ok: false, errorCode: 'consent-policy-violation' })
    expect(parseLocalScreenConsentRegisterRequest({
      ...input,
      grant: { ...grant(), allowedFactCategories: ['person.identity'] },
    })).toEqual({ ok: false, errorCode: 'consent-policy-violation' })
    expect(parseLocalScreenConsentRegisterRequest({ ...input, token: 'forbidden' })).toEqual({ ok: false, errorCode: 'invalid-schema' })
  })

  it('strictly validates generation-aware revoke requests', () => {
    const input = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 2,
      grantId: 'grant:screen-local',
      reason: 'generation-stale',
    }
    expect(parseLocalScreenConsentRevokeRequest(input).ok).toBe(true)
    expect(parseLocalScreenConsentRevokeRequest({ ...input, generation: 0 })).toEqual({ ok: false, errorCode: 'invalid-schema' })
  })
})
