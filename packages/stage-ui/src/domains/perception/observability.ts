import type {
  ObjectivePerceptionSourceKind,
  PerceptionFactState,
  PerceptionSourceHealth,
  PerceptionStateSnapshot,
  RuntimePerceptionFact,
  RuntimePerceptionVerification,
} from './contracts'

import { allowedPerceptionEnumValuesByCategory } from './policy'

export interface PerceptionObservabilityFact {
  factId: string
  category: string
  predicate: string
  subject: RuntimePerceptionFact['subject']
  sourceKind: ObjectivePerceptionSourceKind
  processing: RuntimePerceptionFact['provenance']['processing']
  analyzerId: string
  confidence: number
  observedAt: number
  expiresAt: number
  state: PerceptionFactState
  verification: RuntimePerceptionVerification
  sensitivity: RuntimePerceptionFact['sensitivity']
  suppressionReason?: RuntimePerceptionFact['suppressionReason']
  safeValue?: string | number | boolean
  valueRedacted: boolean
}

export interface PerceptionObservabilitySnapshot {
  sessionId: string
  generation: number
  updatedAt: number
  facts: PerceptionObservabilityFact[]
  sourceHealth: PerceptionSourceHealth[]
  counts: Record<PerceptionFactState, number>
}

export interface CreatePerceptionObservabilityOptions {
  facts: readonly RuntimePerceptionFact[]
  snapshot: PerceptionStateSnapshot
  maxFacts?: number
}

const DEFAULT_MAX_FACTS = 12

/**
 * Creates a bounded diagnostic view without raw evidence or model summaries.
 * Fact IDs remain available for explicit confirm/retract actions but event and
 * observation correlation IDs never enter the presentation projection.
 */
export function createPerceptionObservabilitySnapshot(
  options: CreatePerceptionObservabilityOptions,
): PerceptionObservabilitySnapshot {
  const maxFacts = clampInteger(options.maxFacts ?? DEFAULT_MAX_FACTS, 1, 32)
  const sameGeneration = options.facts
    .filter(fact => fact.sessionId === options.snapshot.sessionId && fact.generation === options.snapshot.generation)
  const counts: Record<PerceptionFactState, number> = {
    proposed: 0,
    accepted: 0,
    suppressed: 0,
    expired: 0,
    revoked: 0,
  }
  for (const fact of sameGeneration)
    counts[fact.state] += 1

  const facts = sameGeneration
    .toSorted((left, right) => factStatePriority(right.state) - factStatePriority(left.state)
      || right.observedAt - left.observedAt
      || left.factId.localeCompare(right.factId))
    .slice(0, maxFacts)
    .map(toObservableFact)

  return {
    sessionId: options.snapshot.sessionId,
    generation: options.snapshot.generation,
    updatedAt: options.snapshot.updatedAt,
    facts,
    sourceHealth: options.snapshot.sourceHealth.slice(0, 8).map(health => ({ ...health })),
    counts,
  }
}

function toObservableFact(fact: RuntimePerceptionFact): PerceptionObservabilityFact {
  const safeValue = safeObservableValue(fact)
  return {
    factId: fact.factId,
    category: fact.category,
    predicate: fact.predicate,
    subject: fact.subject,
    sourceKind: fact.source.kind,
    processing: fact.provenance.processing,
    analyzerId: safeConfigId(fact.provenance.analyzerId),
    confidence: fact.confidence,
    observedAt: fact.observedAt,
    expiresAt: fact.expiresAt,
    state: fact.state,
    verification: fact.verification,
    sensitivity: fact.sensitivity,
    suppressionReason: fact.suppressionReason,
    safeValue,
    valueRedacted: safeValue === undefined,
  }
}

function safeObservableValue(fact: RuntimePerceptionFact): string | number | boolean | undefined {
  if (fact.value.kind === 'summary') {
    return undefined
  }
  if (fact.value.kind === 'enum') {
    return allowedPerceptionEnumValuesByCategory[fact.category]?.includes(fact.value.value) ? fact.value.value : undefined
  }
  if (fact.value.kind === 'number') {
    return fact.category === 'person.count'
      && Number.isInteger(fact.value.value)
      && fact.value.value >= 0
      && fact.value.value <= 16
      ? fact.value.value
      : undefined
  }
  if (fact.value.kind === 'boolean') {
    return ['person.presence', 'object.presence', 'minecraft.threat'].includes(fact.category)
      ? fact.value.value
      : undefined
  }

  return undefined
}

function safeConfigId(value: string): string {
  return /^(?=[^\W_])[\w:./-]{1,80}$/u.test(value) ? value : 'unknown'
}

function factStatePriority(state: PerceptionFactState): number {
  if (state === 'accepted')
    return 3
  if (state === 'suppressed')
    return 2
  return 1
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value))
    return minimum
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
