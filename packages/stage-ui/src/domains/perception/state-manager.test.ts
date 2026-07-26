import type { ObjectivePerceptionEvent } from './contracts'

import { describe, expect, it } from 'vitest'

import { PerceptionStateManager } from './state-manager'
import { createConsentGrant, createPerceptionEvent } from './test-fixtures'

function createHarness(now = 1_000) {
  let current = now
  let id = 0
  const manager = new PerceptionStateManager({
    sessionId: 'session:1',
    generation: 1,
    clock: { now: () => current },
    ids: { next: prefix => `${prefix}:${++id}` },
  })
  return {
    manager,
    setNow(value: number) {
      current = value
    },
  }
}

const healthyContext = { consentGrant: createConsentGrant(), sourceHealthy: true }

describe('perception state manager', () => {
  it('publishes only bounded downstream candidate identifiers and clears them on revoke', () => {
    const manager = new PerceptionStateManager({ sessionId: 'session:1', generation: 1 })
    manager.setDownstreamCandidateIds(['reaction:1'], ['actuation:1'])
    expect(manager.snapshot()).toMatchObject({ reactionCandidateIds: ['reaction:1'], stageActuationCandidateIds: ['actuation:1'] })
    manager.revokeAll()
    expect(manager.snapshot()).toMatchObject({ reactionCandidateIds: [], stageActuationCandidateIds: [] })
    expect(() => manager.setDownstreamCandidateIds(['invalid id'], [])).toThrowError('perception_candidate_ids_invalid')
  })
  it('is the single gate from proposed to accepted and publishes a bounded snapshot', () => {
    const { manager } = createHarness()
    const result = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(result.ok).toBe(true)
    if (!result.ok)
      throw new Error(result.reason)
    expect(result.fact.state).toBe('accepted')

    const snapshot = manager.snapshot()
    expect(snapshot.acceptedFactIds).toEqual([result.fact.factId])
    expect(snapshot.activeStates).toEqual([{
      factId: result.fact.factId,
      category: 'person.presence',
      predicate: 'present',
      subject: 'primary-user',
    }])
    expect(JSON.stringify(snapshot)).not.toContain('imageDataUrl')
  })

  it('suppresses missing consent, unhealthy sources, prohibited facts and low confidence', () => {
    const cases = [
      [createPerceptionEvent({ eventId: 'event:no-consent' }), { sourceHealthy: true }, 'consent-missing'],
      [createPerceptionEvent({ eventId: 'event:unhealthy' }), { ...healthyContext, sourceHealthy: false }, 'source-unhealthy'],
      [createPerceptionEvent({ eventId: 'event:prohibited', sensitivity: 'prohibited' }), healthyContext, 'prohibited-sensitivity'],
      [createPerceptionEvent({ eventId: 'event:low', confidence: 0.1 }), healthyContext, 'low-confidence'],
    ] as const

    const { manager } = createHarness()
    for (const [event, context, reason] of cases) {
      const result = manager.ingest(event, context)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toBe(reason)
    }
  })

  it('isolates stale generations and invalidates accepted facts on a generation switch', () => {
    const { manager } = createHarness()
    const accepted = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(accepted.ok).toBe(true)

    manager.setGeneration('session:1', 2)
    expect(manager.snapshot().acceptedFactIds).toEqual([])
    const stale = manager.ingest(createPerceptionEvent({ eventId: 'event:stale' }), healthyContext)
    expect(stale.ok).toBe(false)
    if (!stale.ok)
      expect(stale.reason).toBe('stale-generation')
  })

  it('requires multiple observations for gesture/activity facts and rejects excessive TTL', () => {
    const { manager } = createHarness()
    const gesture = (eventId: string, observedAt: number): ObjectivePerceptionEvent => createPerceptionEvent({
      eventId,
      observationId: `observation:${eventId}`,
      eventType: 'person.gesture.observed',
      value: { kind: 'enum', value: 'hand-raised' },
      verification: 'multi-frame-inferred',
      observedAt,
      expiresAt: observedAt + 4_000,
    })
    const first = manager.ingest(gesture('event:gesture-1', 1_000), healthyContext)
    expect(first.ok).toBe(false)
    if (!first.ok)
      expect(first.reason).toBe('temporal-insufficient')

    const second = manager.ingest(gesture('event:gesture-2', 1_500), healthyContext)
    expect(second.ok).toBe(true)

    const invalidTtl = manager.ingest(createPerceptionEvent({
      eventId: 'event:ttl',
      expiresAt: 20_000,
    }), healthyContext)
    expect(invalidTtl.ok).toBe(false)
    if (!invalidTtl.ok)
      expect(invalidTtl.reason).toBe('invalid-ttl')
  })

  it('keeps normal-cadence screen activity evidence long enough for temporal confirmation', () => {
    const { manager, setNow } = createHarness()
    const grant = createConsentGrant({
      sourceKind: 'screen',
      sourceId: 'window:editor',
      allowedModalities: ['screen-frames'],
      allowedFactCategories: ['screen.activity'],
    })
    const activity = (eventId: string, observedAt: number): ObjectivePerceptionEvent => createPerceptionEvent({
      eventId,
      observationId: `observation:${eventId}`,
      sourceKind: 'screen-local',
      sourceId: 'window:editor',
      eventType: 'screen.activity.observed',
      subject: 'environment',
      value: { kind: 'enum', value: 'code' },
      verification: 'multi-frame-inferred',
      observedAt,
      expiresAt: observedAt + 20_000,
      provenance: { analyzerId: 'qwen:screen', processing: 'local', modelId: 'Qwen/Qwen3-VL-4B-Instruct' },
    })

    expect(manager.ingest(activity('event:screen-1', 1_000), { consentGrant: grant, sourceHealthy: true })).toMatchObject({
      ok: false,
      reason: 'temporal-insufficient',
    })
    setNow(6_500)
    expect(manager.ingest(activity('event:screen-2', 6_500), { consentGrant: grant, sourceHealthy: true })).toMatchObject({
      ok: true,
      outcome: 'accepted',
    })
  })

  it('keeps different allowlisted object labels as independent facts', () => {
    const { manager } = createHarness()
    const grant = createConsentGrant({
      allowedFactCategories: ['object.presence'],
    })
    const objectEvent = (eventId: string, label: string, observedAt: number): ObjectivePerceptionEvent => createPerceptionEvent({
      eventId,
      observationId: `observation:${eventId}`,
      eventType: 'object.presence.changed',
      subject: 'allowlisted-object',
      value: { kind: 'enum', value: label },
      confidence: 0.9,
      observedAt,
      expiresAt: observedAt + 4_000,
      verification: 'multi-frame-inferred',
    })

    manager.ingest(objectEvent('event:cup-1', 'cup', 1_000), { consentGrant: grant, sourceHealthy: true })
    const cup = manager.ingest(objectEvent('event:cup-2', 'cup', 1_200), { consentGrant: grant, sourceHealthy: true })
    manager.ingest(objectEvent('event:book-1', 'book', 1_300), { consentGrant: grant, sourceHealthy: true })
    const book = manager.ingest(objectEvent('event:book-2', 'book', 1_500), { consentGrant: grant, sourceHealthy: true })

    expect(manager.snapshot().acceptedFactIds).toHaveLength(2)
    expect([cup, book].map(result => result.ok ? result.fact.value : undefined)).toEqual([
      { kind: 'enum', value: 'cup' },
      { kind: 'enum', value: 'book' },
    ])
  })

  it('rejects non-allowlisted object labels at the policy gate', () => {
    const { manager } = createHarness()
    const result = manager.ingest(createPerceptionEvent({
      eventId: 'event:unknown-object',
      eventType: 'object.presence.changed',
      subject: 'allowlisted-object',
      value: { kind: 'enum', value: 'password' },
      confidence: 0.99,
    }), {
      consentGrant: createConsentGrant({ allowedFactCategories: ['object.presence'] }),
      sourceHealthy: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.reason).toBe('unsupported-event-type')
  })

  it('expires facts with a fake clock and immediately retracts source facts', () => {
    const { manager, setNow } = createHarness()
    const accepted = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(accepted.ok).toBe(true)

    setNow(4_001)
    expect(manager.expire()).toHaveLength(1)
    expect(manager.snapshot().acceptedFactIds).toEqual([])

    const second = manager.ingest(createPerceptionEvent({
      eventId: 'event:2',
      observationId: 'observation:2',
      observedAt: 4_001,
      expiresAt: 7_001,
    }), healthyContext)
    expect(second.ok).toBe(true)
    expect(manager.revokeSource('camera:default')).toHaveLength(1)
    expect(manager.snapshot().acceptedFactIds).toEqual([])
  })

  it('prefers direct local evidence over a conflicting cloud inference', () => {
    const { manager } = createHarness()
    const local = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(local.ok).toBe(true)

    const cloudGrant = createConsentGrant({
      processingMode: 'cloud-approved',
      allowedFactCategories: ['person.presence'],
      cloudProviderId: 'aliyun',
      cloudModelId: 'qwen3.5-omni-flash-realtime',
    })
    const cloud = manager.ingest(createPerceptionEvent({
      eventId: 'event:cloud',
      observationId: 'observation:cloud',
      sourceKind: 'camera-cloud',
      value: { kind: 'boolean', value: false },
      confidence: 0.99,
      observedAt: 1_100,
      expiresAt: 4_100,
      verification: 'cloud-inferred',
      provenance: { analyzerId: 'qwen:camera', processing: 'cloud', providerId: 'aliyun', modelId: 'qwen3.5-omni-flash-realtime' },
    }), { consentGrant: cloudGrant, sourceHealthy: true })
    expect(cloud.ok).toBe(false)
    if (!cloud.ok)
      expect(cloud.reason).toBe('conflict-lost')
  })

  it('requires a matching cloud grant and rejects out-of-range person counts', () => {
    const { manager } = createHarness()
    const cloudEvent = createPerceptionEvent({
      eventId: 'event:cloud-with-local-grant',
      sourceKind: 'camera-cloud',
      verification: 'cloud-inferred',
      provenance: {
        analyzerId: 'qwen:camera',
        processing: 'cloud',
        providerId: 'aliyun',
        modelId: 'qwen3.5-omni-flash-realtime',
      },
    })
    const cloudWithoutGrant = manager.ingest(cloudEvent, healthyContext)
    expect(cloudWithoutGrant.ok).toBe(false)
    if (!cloudWithoutGrant.ok)
      expect(cloudWithoutGrant.reason).toBe('consent-missing')

    const count = manager.ingest(createPerceptionEvent({
      eventId: 'event:count',
      observationId: 'observation:count',
      eventType: 'person.count.observed',
      value: { kind: 'number', value: 17 },
    }), {
      consentGrant: createConsentGrant({ allowedFactCategories: ['person.count'] }),
      sourceHealthy: true,
    })
    expect(count.ok).toBe(false)
    if (!count.ok)
      expect(count.reason).toBe('unsupported-event-type')
  })

  it('updates a same-analyzer fact only with newer evidence', () => {
    const { manager } = createHarness()
    const first = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(first.ok).toBe(true)
    const older = manager.ingest(createPerceptionEvent({
      eventId: 'event:older',
      observationId: 'observation:older',
      observedAt: 999,
      expiresAt: 3_999,
    }), healthyContext)
    expect(older.ok).toBe(false)
    if (!older.ok)
      expect(older.reason).toBe('conflict-lost')

    const newer = manager.ingest(createPerceptionEvent({
      eventId: 'event:newer',
      observationId: 'observation:newer',
      observedAt: 1_001,
      expiresAt: 4_001,
    }), healthyContext)
    expect(newer.ok).toBe(true)
    if (newer.ok)
      expect(manager.snapshot().acceptedFactIds).toEqual([newer.fact.factId])
  })

  it('supports user confirmation and correction without retaining the rejected fact as active', () => {
    const { manager } = createHarness()
    const accepted = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok)
      throw new Error(accepted.reason)

    expect(manager.confirmFact(accepted.fact.factId)?.verification).toBe('user-confirmed')
    const retracted = manager.retractFact(accepted.fact.factId)
    expect(retracted?.state).toBe('revoked')
    expect(retracted?.suppressionReason).toBe('user-retracted')
    expect(manager.snapshot().acceptedFactIds).toEqual([])
  })

  it('deduplicates event IDs and rate-limits noisy sources', () => {
    const { manager } = createHarness()
    expect(manager.ingest(createPerceptionEvent(), healthyContext).ok).toBe(true)
    const duplicate = manager.ingest(createPerceptionEvent(), healthyContext)
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok)
      expect(duplicate.reason).toBe('duplicate-event')

    const limited = new PerceptionStateManager({
      sessionId: 'session:1',
      generation: 1,
      clock: { now: () => 1_000 },
      maxEventsPerSourcePerSecond: 1,
    })
    expect(limited.ingest(createPerceptionEvent(), healthyContext).ok).toBe(true)
    const noisy = limited.ingest(createPerceptionEvent({ eventId: 'event:noisy', observationId: 'observation:noisy' }), healthyContext)
    expect(noisy.ok).toBe(false)
    if (!noisy.ok)
      expect(noisy.reason).toBe('rate-limited')
  })

  it('bounds non-active audit facts during a long noisy session', () => {
    const manager = new PerceptionStateManager({
      sessionId: 'session:1',
      generation: 1,
      clock: { now: () => 1_000 },
      maxEventsPerSourcePerSecond: 1_000,
    })
    for (let index = 0; index < 400; index++) {
      manager.ingest(createPerceptionEvent({
        eventId: `event:bounded:${index}`,
        observationId: `observation:bounded:${index}`,
        confidence: 0.1,
      }), healthyContext)
    }
    expect(manager.listFacts()).toHaveLength(256)
    const duplicate = manager.ingest(createPerceptionEvent({
      eventId: 'event:bounded:399',
      observationId: 'observation:bounded:duplicate',
      confidence: 0.1,
    }), healthyContext)
    expect(duplicate).toMatchObject({ ok: false, reason: 'duplicate-event' })
  })
})
