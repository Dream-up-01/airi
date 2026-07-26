import type { RuntimePerceptionFact } from './contracts'

import { describe, expect, it } from 'vitest'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import { PerceptionReactionPolicy, StageActuationPolicy } from './reaction-actuation'

describe('perception reaction and stage actuation policy', () => {
  it('stays context-only by default and never creates stage actuation', () => {
    const policy = new PerceptionReactionPolicy({ now: () => 1_000, id: prefix => `${prefix}:1` })
    const result = policy.evaluate([fact()], settings({ enabled: false }))
    expect(result.candidates).toEqual([expect.objectContaining({ mode: 'context-only', triggerFactIds: ['fact:1'] })])
    expect(new StageActuationPolicy({ now: () => 1_000 }).create(result.candidates[0]!, [fact()])).toBeUndefined()
  })

  it('enforces opt-in, quiet mode, cooldown and bounded stage states', () => {
    let now = 1_000
    const policy = new PerceptionReactionPolicy({ now: () => now, id: prefix => `${prefix}:${now}` })
    expect(policy.evaluate([fact()], settings({ enabled: true, quietMode: true }))).toMatchObject({ candidates: [], suppressedReason: 'quiet-mode' })

    const first = policy.evaluate([fact()], settings({ enabled: true }))
    expect(first.candidates[0]).toMatchObject({ mode: 'suggest-reaction', reasonCode: 'fresh-user-gesture' })
    const intent = new StageActuationPolicy({ now: () => now, id: () => 'actuation:1' }).create(first.candidates[0]!, [fact()])
    expect(intent).toMatchObject({ state: 'attentive', intensity: 0.9, triggerFactIds: ['fact:1'] })
    expect(JSON.stringify(intent)).not.toMatch(/motion|expression|tts|tool/iu)

    now += 1_000
    expect(policy.evaluate([fact({ observedAt: now, expiresAt: now + 5_000 })], settings({ enabled: true }))).toMatchObject({ candidates: [], suppressedReason: 'cooldown' })
  })

  it('rejects sensitive, prohibited, stale and low-confidence facts', () => {
    const policy = new PerceptionReactionPolicy({ now: () => 10_000 })
    for (const candidate of [
      fact({ sensitivity: 'sensitive' }),
      fact({ sensitivity: 'prohibited' }),
      fact({ expiresAt: 9_999 }),
      fact({ confidence: 0.79 }),
    ]) {
      expect(policy.evaluate([candidate], settings({ enabled: true }))).toMatchObject({ candidates: [], suppressedReason: 'no-eligible-fact' })
    }
  })
})

function settings(overrides: Partial<Parameters<PerceptionReactionPolicy['evaluate']>[1]> = {}) {
  return {
    enabled: false,
    quietMode: false,
    cooldownMs: 30_000,
    maxPerHour: 6,
    allowedCategories: ['person.gesture'],
    ...overrides,
  }
}

function fact(overrides: Partial<RuntimePerceptionFact> = {}): RuntimePerceptionFact {
  return {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    factId: 'fact:1',
    eventId: 'event:1',
    observationId: 'observation:1',
    sessionId: 'session:1',
    generation: 1,
    source: { kind: 'camera-local', sourceId: 'camera:default' },
    category: 'person.gesture',
    subject: 'primary-user',
    predicate: 'gesture',
    value: { kind: 'enum', value: 'wave-like' },
    confidence: 0.9,
    observedAt: 900,
    expiresAt: 11_000,
    sensitivity: 'personal',
    provenance: { analyzerId: 'mediapipe:hands', processing: 'local' },
    state: 'accepted',
    verification: 'inferred',
    ...overrides,
  }
}
