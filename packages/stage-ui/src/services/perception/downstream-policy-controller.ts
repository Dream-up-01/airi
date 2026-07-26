import type {
  PerceptionReactionCandidate,
  PerceptionReactionPolicySettings,
  StageActuationIntentLite,
} from '../../domains/perception'
import type { PerceptionStateManager } from '../../domains/perception/state-manager'

import { PerceptionReactionPolicy, StageActuationPolicy } from '../../domains/perception'

const DEFAULT_ALLOWED_CATEGORIES = [
  'person.gesture',
  'person.presence',
  'minecraft.threat',
  'minecraft.task',
  'screen.activity',
]

export interface PerceptionDownstreamPolicySnapshot {
  reactionsEnabled: boolean
  quietMode: boolean
  candidates: PerceptionReactionCandidate[]
  actuationIntents: StageActuationIntentLite[]
}

/** Runtime-only downstream policy. It never creates text, speech, tools or arbitrary motion IDs. */
export class PerceptionDownstreamPolicyController {
  readonly #reaction: PerceptionReactionPolicy
  readonly #actuation: StageActuationPolicy
  #settings: PerceptionReactionPolicySettings
  #snapshot: PerceptionDownstreamPolicySnapshot

  constructor(options: {
    settings?: Partial<PerceptionReactionPolicySettings>
    reaction?: PerceptionReactionPolicy
    actuation?: StageActuationPolicy
  } = {}) {
    this.#reaction = options.reaction ?? new PerceptionReactionPolicy()
    this.#actuation = options.actuation ?? new StageActuationPolicy()
    this.#settings = {
      enabled: false,
      quietMode: false,
      cooldownMs: 60_000,
      maxPerHour: 6,
      allowedCategories: [...DEFAULT_ALLOWED_CATEGORIES],
      ...options.settings,
    }
    this.#snapshot = { reactionsEnabled: this.#settings.enabled, quietMode: this.#settings.quietMode, candidates: [], actuationIntents: [] }
  }

  get snapshot(): PerceptionDownstreamPolicySnapshot {
    return {
      ...this.#snapshot,
      candidates: this.#snapshot.candidates.map(candidate => ({ ...candidate, triggerFactIds: [...candidate.triggerFactIds] })),
      actuationIntents: this.#snapshot.actuationIntents.map(intent => ({ ...intent, triggerFactIds: [...intent.triggerFactIds] })),
    }
  }

  evaluate(manager: PerceptionStateManager): PerceptionDownstreamPolicySnapshot {
    const facts = manager.listFacts()
    const result = this.#reaction.evaluate(facts, this.#settings)
    const actuationIntents = result.candidates
      .map(candidate => this.#actuation.create(candidate, facts))
      .filter((intent): intent is StageActuationIntentLite => !!intent)
    manager.setDownstreamCandidateIds(result.candidates.map(candidate => candidate.candidateId), actuationIntents.map(intent => intent.intentId))
    this.#snapshot = {
      reactionsEnabled: this.#settings.enabled,
      quietMode: this.#settings.quietMode,
      candidates: result.candidates,
      actuationIntents,
    }
    return this.snapshot
  }

  updateSettings(settings: Partial<PerceptionReactionPolicySettings>): void {
    this.#settings = { ...this.#settings, ...settings, allowedCategories: settings.allowedCategories ? [...settings.allowedCategories] : this.#settings.allowedCategories }
  }

  cancelAll(manager?: PerceptionStateManager): void {
    this.#reaction.cancelAll()
    manager?.clearDownstreamCandidates()
    this.#snapshot = { reactionsEnabled: this.#settings.enabled, quietMode: this.#settings.quietMode, candidates: [], actuationIntents: [] }
  }
}
