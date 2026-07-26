import type {
  PerceptionReactionCandidate,
  RuntimePerceptionFact,
  StageActuationIntentLite,
} from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'

export interface PerceptionReactionPolicySettings {
  enabled: boolean
  quietMode: boolean
  cooldownMs: number
  maxPerHour: number
  allowedCategories: string[]
}

export interface PerceptionReactionPolicyResult {
  candidates: PerceptionReactionCandidate[]
  suppressedReason?: 'quiet-mode' | 'no-eligible-fact' | 'cooldown' | 'hourly-limit'
}

export class PerceptionReactionPolicy {
  readonly #now: () => number
  readonly #id: (prefix: string) => string
  readonly #cooldowns = new Map<string, number>()
  readonly #createdAt: number[] = []

  constructor(options: { now?: () => number, id?: (prefix: string) => string } = {}) {
    this.#now = options.now ?? Date.now
    this.#id = options.id ?? (prefix => `${prefix}:${crypto.randomUUID()}`)
  }

  evaluate(facts: readonly RuntimePerceptionFact[], settings: PerceptionReactionPolicySettings): PerceptionReactionPolicyResult {
    validateSettings(settings)
    const now = this.#now()
    const eligible = facts
      .filter(fact => isEligible(fact, now) && settings.allowedCategories.includes(fact.category))
      .sort((left, right) => salience(right) - salience(left) || right.observedAt - left.observedAt)
    if (eligible.length === 0)
      return { candidates: [], suppressedReason: 'no-eligible-fact' }

    const fact = eligible[0]!
    const cooldownKey = `perception:${fact.category}:${fact.predicate}`
    const base: PerceptionReactionCandidate = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      candidateId: this.#id('reaction'),
      triggerFactIds: [fact.factId],
      salience: salience(fact),
      mode: 'context-only',
      cooldownKey,
      createdAt: now,
      expiresAt: Math.min(fact.expiresAt, now + 10_000),
      reasonCode: reasonFor(fact),
    }
    if (!settings.enabled)
      return { candidates: [base] }
    if (settings.quietMode)
      return { candidates: [], suppressedReason: 'quiet-mode' }
    if ((this.#cooldowns.get(cooldownKey) ?? 0) > now)
      return { candidates: [], suppressedReason: 'cooldown' }

    const hourStart = now - 60 * 60 * 1_000
    while (this.#createdAt[0] !== undefined && this.#createdAt[0]! < hourStart)
      this.#createdAt.shift()
    if (this.#createdAt.length >= settings.maxPerHour)
      return { candidates: [], suppressedReason: 'hourly-limit' }

    this.#cooldowns.set(cooldownKey, now + settings.cooldownMs)
    this.#createdAt.push(now)
    return { candidates: [{ ...base, mode: 'suggest-reaction' }] }
  }

  cancelAll(): void {
    this.#cooldowns.clear()
    this.#createdAt.length = 0
  }
}

export class StageActuationPolicy {
  readonly #now: () => number
  readonly #id: (prefix: string) => string

  constructor(options: { now?: () => number, id?: (prefix: string) => string } = {}) {
    this.#now = options.now ?? Date.now
    this.#id = options.id ?? (prefix => `${prefix}:${crypto.randomUUID()}`)
  }

  create(candidate: PerceptionReactionCandidate, facts: readonly RuntimePerceptionFact[]): StageActuationIntentLite | undefined {
    if (candidate.mode !== 'suggest-reaction')
      return undefined
    const now = this.#now()
    const fact = facts.find(item => candidate.triggerFactIds.includes(item.factId) && isEligible(item, now))
    if (!fact)
      return undefined
    const state = actuationState(fact)
    if (!state)
      return undefined
    return {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      intentId: this.#id('actuation'),
      triggerFactIds: [fact.factId],
      state,
      intensity: Math.min(1, Math.max(0, fact.confidence)),
      createdAt: now,
      expiresAt: Math.min(fact.expiresAt, now + 3_000),
    }
  }
}

function isEligible(fact: RuntimePerceptionFact, now: number): boolean {
  return fact.state === 'accepted'
    && fact.expiresAt > now
    && fact.confidence >= 0.8
    && fact.sensitivity !== 'sensitive'
    && fact.sensitivity !== 'prohibited'
}

function salience(fact: RuntimePerceptionFact): number {
  const categoryWeight = fact.category === 'minecraft.threat' ? 1 : fact.category === 'person.gesture' ? 0.9 : fact.category === 'minecraft.task' ? 0.85 : 0.75
  return Math.min(1, fact.confidence * categoryWeight)
}

function reasonFor(fact: RuntimePerceptionFact): string {
  if (fact.category === 'minecraft.threat')
    return 'fresh-nearby-threat'
  if (fact.category === 'person.gesture')
    return 'fresh-user-gesture'
  if (fact.category === 'minecraft.task')
    return 'fresh-task-change'
  return 'fresh-salient-change'
}

function actuationState(fact: RuntimePerceptionFact): StageActuationIntentLite['state'] | undefined {
  if (fact.category === 'minecraft.threat')
    return 'concerned'
  if (fact.category === 'person.gesture')
    return 'attentive'
  if (fact.category === 'minecraft.task' && fact.value.kind === 'enum' && fact.value.value === 'completed')
    return 'celebratory'
  return undefined
}

function validateSettings(settings: PerceptionReactionPolicySettings): void {
  if (!Number.isInteger(settings.cooldownMs) || settings.cooldownMs < 1_000 || settings.cooldownMs > 3_600_000
    || !Number.isInteger(settings.maxPerHour) || settings.maxPerHour < 1 || settings.maxPerHour > 60
    || settings.allowedCategories.length > 32
    || settings.allowedCategories.some(category => !/^[a-z0-9][\w.:-]{0,159}$/iu.test(category))) {
    throw new Error('perception-reaction-settings-invalid')
  }
}
