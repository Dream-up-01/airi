import type {
  ObjectivePerceptionEvent,
  ObjectivePerceptionValue,
  PerceptionConsentGrant,
  PerceptionSourceHealth,
  PerceptionSourceKind,
  PerceptionStateSnapshot,
  PerceptionSuppressionReason,
  RuntimePerceptionFact,
} from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import {
  objectiveSourceToSourceKind,
  perceptionEventPolicies,
  sourceReliability,
  validateEventPolicy,
} from './policy'
import { parseObjectivePerceptionEvent } from './schemas'

export interface PerceptionClock {
  now: () => number
}

export interface PerceptionIdFactory {
  next: (prefix: 'fact' | 'snapshot') => string
}

export interface PerceptionStateManagerOptions {
  sessionId: string
  generation: number
  clock?: PerceptionClock
  ids?: PerceptionIdFactory
  maxActiveFacts?: number
  maxEventsPerSourcePerSecond?: number
}

export interface PerceptionIngestContext {
  consentGrant?: PerceptionConsentGrant
  sourceHealthy: boolean
}

export type PerceptionIngestResult
  = | { ok: true, outcome: 'accepted' | 'revoked', fact: RuntimePerceptionFact }
    | { ok: false, outcome: 'suppressed', reason: PerceptionSuppressionReason, fact?: RuntimePerceptionFact }

interface TemporalEvidence {
  timestamps: number[]
}

const systemClock: PerceptionClock = { now: () => Date.now() }
const MAX_RETAINED_FACT_RECORDS = 256
const MAX_SEEN_EVENT_IDS = 1_024
const MAX_TEMPORAL_EVIDENCE_KEYS = 256

function createDefaultIds(): PerceptionIdFactory {
  let sequence = 0
  return { next: prefix => `${prefix}:${++sequence}` }
}

function isBoundedCandidateIds(values: readonly string[], maximum: number): boolean {
  return values.length <= maximum
    && new Set(values).size === values.length
    && values.every(value => /^[a-z0-9][\w.:-]{0,159}$/iu.test(value))
}

export class PerceptionStateManager {
  readonly #clock: PerceptionClock
  readonly #ids: PerceptionIdFactory
  readonly #maxActiveFacts: number
  readonly #maxEventsPerSourcePerSecond: number
  readonly #facts = new Map<string, RuntimePerceptionFact>()
  readonly #activeByPredicate = new Map<string, string>()
  readonly #seenEventIds = new Map<string, true>()
  readonly #temporalEvidence = new Map<string, TemporalEvidence>()
  readonly #sourceEventTimes = new Map<string, number[]>()
  readonly #sourceHealth = new Map<string, PerceptionSourceHealth>()
  #sessionId: string
  #generation: number
  #reactionCandidateIds: string[] = []
  #stageActuationCandidateIds: string[] = []

  constructor(options: PerceptionStateManagerOptions) {
    this.#sessionId = options.sessionId
    this.#generation = options.generation
    this.#clock = options.clock ?? systemClock
    this.#ids = options.ids ?? createDefaultIds()
    this.#maxActiveFacts = options.maxActiveFacts ?? 64
    this.#maxEventsPerSourcePerSecond = options.maxEventsPerSourcePerSecond ?? 20
  }

  ingest(input: unknown, context: PerceptionIngestContext): PerceptionIngestResult {
    const parsed = parseObjectivePerceptionEvent(input)
    if (!parsed.ok)
      return { ok: false, outcome: 'suppressed', reason: 'invalid-schema' }

    const event = parsed.value as ObjectivePerceptionEvent
    if (this.#seenEventIds.has(event.eventId))
      return { ok: false, outcome: 'suppressed', reason: 'duplicate-event' }
    this.#seenEventIds.set(event.eventId, true)
    while (this.#seenEventIds.size > MAX_SEEN_EVENT_IDS)
      this.#seenEventIds.delete(this.#seenEventIds.keys().next().value!)

    const candidate = this.#createProposedFact(event)
    const suppression = this.#preflight(event, context)
    if (suppression)
      return this.#suppress(candidate, suppression)

    if (event.phase === 'ended')
      return this.#endFact(candidate)

    const temporal = this.#recordTemporalEvidence(event)
    if (!temporal)
      return this.#suppress(candidate, 'temporal-insufficient')

    const key = this.#predicateKey(event)
    const currentId = this.#activeByPredicate.get(key)
    const current = currentId ? this.#facts.get(currentId) : undefined
    if (current && !this.#challengerWins(current, candidate))
      return this.#suppress(candidate, 'conflict-lost')

    if (current) {
      current.state = 'revoked'
      current.verification = 'retracted'
      current.suppressionReason = 'conflict-lost'
      this.#facts.set(current.factId, current)
    }

    candidate.state = 'accepted'
    this.#facts.set(candidate.factId, candidate)
    this.#activeByPredicate.set(key, candidate.factId)
    this.#enforceActiveBound()
    this.#enforceHistoryBound()
    return { ok: true, outcome: 'accepted', fact: { ...candidate } }
  }

  setGeneration(sessionId: string, generation: number): void {
    if (sessionId === this.#sessionId && generation === this.#generation)
      return
    this.revokeAll('source-revoked')
    this.#sessionId = sessionId
    this.#generation = generation
    this.#temporalEvidence.clear()
    this.#sourceEventTimes.clear()
    this.#seenEventIds.clear()
  }

  setSourceHealth(health: PerceptionSourceHealth): void {
    this.#sourceHealth.set(health.sourceId, { ...health })
    if (health.status === 'failed' || health.status === 'stopped')
      this.revokeSource(health.sourceId, 'source-revoked')
  }

  expire(now = this.#clock.now()): RuntimePerceptionFact[] {
    const expired: RuntimePerceptionFact[] = []
    for (const fact of this.#facts.values()) {
      if (fact.state !== 'accepted' || fact.expiresAt > now)
        continue
      fact.state = 'expired'
      fact.suppressionReason = 'expired'
      this.#activeByPredicate.delete(this.#factPredicateKey(fact))
      expired.push({ ...fact })
    }
    if (expired.length > 0)
      this.clearDownstreamCandidates()
    return expired
  }

  revokeSource(sourceId: string, reason: PerceptionSuppressionReason = 'source-revoked'): RuntimePerceptionFact[] {
    return this.#revokeWhere(fact => fact.source.sourceId === sourceId, reason)
  }

  revokeSourceKind(sourceKind: PerceptionSourceKind, reason: PerceptionSuppressionReason = 'source-revoked'): RuntimePerceptionFact[] {
    return this.#revokeWhere(fact => objectiveSourceToSourceKind[fact.source.kind] === sourceKind, reason)
  }

  revokeAll(reason: PerceptionSuppressionReason = 'session-stopped'): RuntimePerceptionFact[] {
    const revoked = this.#revokeWhere(() => true, reason)
    this.clearDownstreamCandidates()
    return revoked
  }

  setDownstreamCandidateIds(reactionCandidateIds: readonly string[], stageActuationCandidateIds: readonly string[]): void {
    if (!isBoundedCandidateIds(reactionCandidateIds, 32) || !isBoundedCandidateIds(stageActuationCandidateIds, 32))
      throw new Error('perception_candidate_ids_invalid')
    this.#reactionCandidateIds = [...reactionCandidateIds]
    this.#stageActuationCandidateIds = [...stageActuationCandidateIds]
  }

  clearDownstreamCandidates(): void {
    this.#reactionCandidateIds = []
    this.#stageActuationCandidateIds = []
  }

  confirmFact(factId: string): RuntimePerceptionFact | undefined {
    const fact = this.#facts.get(factId)
    if (!fact || fact.state !== 'accepted')
      return undefined
    fact.verification = 'user-confirmed'
    return { ...fact }
  }

  retractFact(factId: string): RuntimePerceptionFact | undefined {
    const fact = this.#facts.get(factId)
    if (!fact || fact.state !== 'accepted')
      return undefined
    fact.state = 'revoked'
    fact.verification = 'retracted'
    fact.suppressionReason = 'user-retracted'
    this.#activeByPredicate.delete(this.#factPredicateKey(fact))
    this.clearDownstreamCandidates()
    return { ...fact }
  }

  getFact(factId: string): RuntimePerceptionFact | undefined {
    const fact = this.#facts.get(factId)
    return fact ? { ...fact } : undefined
  }

  listFacts(): RuntimePerceptionFact[] {
    return [...this.#facts.values()].map(fact => ({ ...fact }))
  }

  snapshot(retention: PerceptionStateSnapshot['shortTermRetention'] = 'until-expiry'): PerceptionStateSnapshot {
    this.expire()
    const accepted = [...this.#facts.values()]
      .filter(fact => fact.state === 'accepted')
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, this.#maxActiveFacts)

    return {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      snapshotId: this.#ids.next('snapshot'),
      sessionId: this.#sessionId,
      generation: this.#generation,
      updatedAt: this.#clock.now(),
      acceptedFactIds: accepted.map(fact => fact.factId),
      sourceHealth: [...this.#sourceHealth.values()].map(item => ({ ...item })),
      activeStates: accepted.map(fact => ({
        factId: fact.factId,
        category: fact.category,
        predicate: fact.predicate,
        subject: fact.subject,
      })),
      reactionCandidateIds: [...this.#reactionCandidateIds],
      stageActuationCandidateIds: [...this.#stageActuationCandidateIds],
      shortTermRetention: retention,
    }
  }

  #preflight(event: ObjectivePerceptionEvent, context: PerceptionIngestContext): PerceptionSuppressionReason | undefined {
    if (event.sessionId !== this.#sessionId || event.generation !== this.#generation)
      return 'stale-generation'
    if (!context.sourceHealthy)
      return 'source-unhealthy'
    if (!context.consentGrant || context.consentGrant.revokedAt !== undefined)
      return 'consent-missing'

    const sourceKind = objectiveSourceToSourceKind[event.sourceKind]
    if (context.consentGrant.sourceKind !== sourceKind || context.consentGrant.sourceId !== event.sourceId)
      return 'consent-missing'

    const policy = perceptionEventPolicies[event.eventType]
    if (!context.consentGrant.allowedFactCategories.includes(policy.category))
      return 'consent-missing'
    if (event.sensitivity === 'prohibited')
      return 'prohibited-sensitivity'
    if (event.confidence < policy.minimumConfidence)
      return 'low-confidence'
    if (event.expiresAt <= event.observedAt || event.expiresAt - event.observedAt > policy.maxTtlMs)
      return 'invalid-ttl'
    if (event.expiresAt <= this.#clock.now())
      return 'expired'
    if (validateEventPolicy(event))
      return 'unsupported-event-type'
    if (!this.#grantAllowsEvent(context.consentGrant, event))
      return 'consent-missing'
    if (this.#isRateLimited(event))
      return 'rate-limited'
  }

  #createProposedFact(event: ObjectivePerceptionEvent): RuntimePerceptionFact {
    const policy = perceptionEventPolicies[event.eventType]
    return {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      factId: this.#ids.next('fact'),
      eventId: event.eventId,
      observationId: event.observationId,
      sessionId: event.sessionId,
      generation: event.generation,
      source: { kind: event.sourceKind, sourceId: event.sourceId, adapterId: event.provenance.adapterId },
      category: policy.category,
      subject: event.subject,
      predicate: policy.predicate,
      value: event.value,
      confidence: event.confidence,
      observedAt: event.observedAt,
      expiresAt: event.expiresAt,
      sensitivity: event.sensitivity,
      provenance: event.provenance,
      state: 'proposed',
      verification: event.verification === 'direct-signal' ? 'direct-signal' : 'inferred',
    }
  }

  #suppress(fact: RuntimePerceptionFact, reason: PerceptionSuppressionReason): PerceptionIngestResult {
    fact.state = 'suppressed'
    fact.suppressionReason = reason
    this.#facts.set(fact.factId, fact)
    this.#enforceHistoryBound()
    return { ok: false, outcome: 'suppressed', reason, fact: { ...fact } }
  }

  #endFact(candidate: RuntimePerceptionFact): PerceptionIngestResult {
    const key = this.#factPredicateKey(candidate)
    const currentId = this.#activeByPredicate.get(key)
    const current = currentId ? this.#facts.get(currentId) : undefined
    if (current) {
      current.state = 'revoked'
      current.verification = 'retracted'
      current.suppressionReason = 'source-revoked'
      this.#activeByPredicate.delete(key)
    }
    candidate.state = 'revoked'
    candidate.verification = 'retracted'
    candidate.suppressionReason = 'source-revoked'
    this.#facts.set(candidate.factId, candidate)
    this.#enforceHistoryBound()
    return { ok: true, outcome: 'revoked', fact: { ...candidate } }
  }

  #recordTemporalEvidence(event: ObjectivePerceptionEvent): boolean {
    const policy = perceptionEventPolicies[event.eventType]
    if (policy.minimumSamples <= 1)
      return true

    const key = `${this.#predicateKey(event)}:${JSON.stringify(event.value)}`
    const cutoff = event.observedAt - policy.smoothingWindowMs
    const entry = this.#temporalEvidence.get(key) ?? { timestamps: [] }
    entry.timestamps = entry.timestamps.filter(timestamp => timestamp >= cutoff)
    entry.timestamps.push(event.observedAt)
    this.#temporalEvidence.set(key, entry)
    while (this.#temporalEvidence.size > MAX_TEMPORAL_EVIDENCE_KEYS)
      this.#temporalEvidence.delete(this.#temporalEvidence.keys().next().value!)
    return entry.timestamps.length >= policy.minimumSamples
  }

  #challengerWins(current: RuntimePerceptionFact, challenger: RuntimePerceptionFact): boolean {
    if (JSON.stringify(current.value) === JSON.stringify(challenger.value)
      && current.source.kind === challenger.source.kind
      && current.provenance.analyzerId === challenger.provenance.analyzerId) {
      return challenger.observedAt >= current.observedAt
    }

    const currentScore = this.#evidenceScore(current)
    const challengerScore = this.#evidenceScore(challenger)
    if (challengerScore !== currentScore)
      return challengerScore > currentScore
    return challenger.observedAt > current.observedAt
  }

  #evidenceScore(fact: RuntimePerceptionFact): number {
    const verification = fact.verification === 'direct-signal' ? 3 : 1
    return verification * 10 + fact.confidence * sourceReliability[fact.source.kind]
  }

  #isRateLimited(event: ObjectivePerceptionEvent): boolean {
    const cutoff = event.observedAt - 1_000
    const timestamps = (this.#sourceEventTimes.get(event.sourceId) ?? []).filter(timestamp => timestamp > cutoff)
    timestamps.push(event.observedAt)
    this.#sourceEventTimes.set(event.sourceId, timestamps)
    return timestamps.length > this.#maxEventsPerSourcePerSecond
  }

  #grantAllowsEvent(grant: PerceptionConsentGrant, event: ObjectivePerceptionEvent): boolean {
    const requiredModality = event.sourceKind.startsWith('screen-')
      ? 'screen-frames'
      : event.sourceKind.startsWith('camera-')
        ? 'camera-frames'
        : 'game-events'
    if (!grant.allowedModalities.includes(requiredModality))
      return false

    if (!event.sourceKind.endsWith('-cloud'))
      return true
    if (grant.processingMode !== 'cloud-approved' && grant.processingMode !== 'mixed')
      return false
    if (!grant.cloudProviderId || !grant.cloudModelId)
      return false
    return grant.cloudProviderId === event.provenance.providerId && grant.cloudModelId === event.provenance.modelId
  }

  #enforceActiveBound(): void {
    const accepted = [...this.#facts.values()]
      .filter(fact => fact.state === 'accepted')
      .sort((a, b) => a.observedAt - b.observedAt)
    while (accepted.length > this.#maxActiveFacts) {
      const fact = accepted.shift()
      if (!fact)
        break
      fact.state = 'revoked'
      fact.suppressionReason = 'rate-limited'
      fact.verification = 'retracted'
      this.#activeByPredicate.delete(this.#factPredicateKey(fact))
    }
  }

  #enforceHistoryBound(): void {
    if (this.#facts.size <= MAX_RETAINED_FACT_RECORDS)
      return
    const removable = [...this.#facts.values()]
      .filter(fact => fact.state !== 'accepted')
      .sort((left, right) => left.observedAt - right.observedAt)
    while (this.#facts.size > MAX_RETAINED_FACT_RECORDS) {
      const fact = removable.shift()
      if (!fact)
        break
      this.#facts.delete(fact.factId)
    }
  }

  #revokeWhere(predicate: (fact: RuntimePerceptionFact) => boolean, reason: PerceptionSuppressionReason): RuntimePerceptionFact[] {
    const revoked: RuntimePerceptionFact[] = []
    for (const fact of this.#facts.values()) {
      if (fact.state !== 'accepted' || !predicate(fact))
        continue
      fact.state = 'revoked'
      fact.verification = 'retracted'
      fact.suppressionReason = reason
      this.#activeByPredicate.delete(this.#factPredicateKey(fact))
      revoked.push({ ...fact })
    }
    return revoked
  }

  #predicateKey(event: ObjectivePerceptionEvent): string {
    const policy = perceptionEventPolicies[event.eventType]
    return `${event.sourceId}:${event.subject}:${policy.category}:${policy.predicate}${this.#objectValueKey(event.value, policy.category)}`
  }

  #factPredicateKey(fact: RuntimePerceptionFact): string {
    return `${fact.source.sourceId}:${fact.subject}:${fact.category}:${fact.predicate}${this.#objectValueKey(fact.value, fact.category)}`
  }

  #objectValueKey(value: ObjectivePerceptionValue, category: string): string {
    if (category !== 'object.presence' || value.kind !== 'enum')
      return ''
    return `:${value.value}`
  }
}
