import { describe, expect, it } from 'vitest'

import { CloudPerceptionFailurePolicy } from './cloud-failure-policy'

describe('cloud perception failure policy', () => {
  it('uses bounded backoff and becomes terminal without an infinite retry loop', () => {
    const policy = new CloudPerceptionFailurePolicy()
    expect(policy.record('network-failed')).toEqual({ retry: true, attempt: 1, delayMs: 1_000 })
    expect(policy.record('provider-unavailable')).toEqual({ retry: true, attempt: 2, delayMs: 2_000 })
    expect(policy.record('rate-limited')).toEqual({ retry: true, attempt: 3, delayMs: 4_000 })
    expect(policy.record('network-failed')).toEqual({ retry: false, attempt: 3, terminalReason: 'network-failed' })
    expect(policy.record('provider-unavailable')).toEqual({ retry: false, attempt: 3, terminalReason: 'network-failed' })
  })

  it('does not retry cost, consent or invalid completed responses and can reset after success', () => {
    for (const failure of ['cost-guard', 'permission-revoked', 'invalid-response'] as const) {
      const policy = new CloudPerceptionFailurePolicy()
      expect(policy.record(failure)).toEqual({ retry: false, attempt: 0, terminalReason: failure })
    }

    const policy = new CloudPerceptionFailurePolicy()
    policy.record('network-failed')
    policy.resetAfterSuccess()
    expect(policy.record('network-failed')).toEqual({ retry: true, attempt: 1, delayMs: 1_000 })
  })
})
