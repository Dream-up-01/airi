import type {
  MinecraftActionPolicyContext,
  MinecraftActionProposal,
  MinecraftActionRiskClass,
  MinecraftAgentAction,
  MinecraftIntentControllerOptions,
  MinecraftIntentSnapshot,
  MinecraftStableErrorCode,
} from './contracts'

import { assessMinecraftAction, minecraftRiskClassForAction } from './policy'
import { parseMinecraftActionProposal, parseMinecraftAgentAction } from './schemas'

export interface MinecraftIntentProposalInput {
  intentId: string
  goalId: string
  sessionId: string
  generation: number
  serverProfileId: string
  consentGrantId: string
  action: MinecraftAgentAction
  riskClass: Exclude<MinecraftActionRiskClass, 'prohibited'>
  createdAt: number
  expiresAt: number
}

export type MinecraftIntentOperationResult<T = MinecraftActionProposal>
  = | { ok: true, value: T, snapshot: MinecraftIntentSnapshot }
    | { ok: false, errorCode: MinecraftStableErrorCode, snapshot: MinecraftIntentSnapshot }

const terminalStates = new Set<MinecraftActionProposal['state']>(['completed', 'failed', 'cancelled', 'expired', 'rejected'])

export class MinecraftIntentController {
  readonly #now: () => number
  readonly #maxIntentTtlMs: number
  readonly #sessionId: string
  #generation: number
  readonly #intents = new Map<string, MinecraftActionProposal>()

  constructor(options: MinecraftIntentControllerOptions) {
    this.#now = options.now ?? (() => Date.now())
    this.#maxIntentTtlMs = options.maxIntentTtlMs ?? 120_000
    this.#sessionId = options.sessionId
    this.#generation = options.generation
  }

  get generation(): number {
    return this.#generation
  }

  get snapshot(): MinecraftIntentSnapshot {
    return this.#snapshot()
  }

  propose(input: MinecraftIntentProposalInput, policyContext: MinecraftActionPolicyContext): MinecraftIntentOperationResult {
    this.#expireAll()
    if (this.#intents.has(input.intentId))
      return this.#failure('duplicate-intent')
    if (input.sessionId !== this.#sessionId)
      return this.#failure('session-mismatch')
    if (input.generation !== this.#generation)
      return this.#failure('stale-generation')
    if (!Number.isSafeInteger(input.createdAt) || !Number.isSafeInteger(input.expiresAt) || input.createdAt > input.expiresAt)
      return this.#failure('invalid-contract')
    const now = this.#now()
    if (input.expiresAt <= now || input.expiresAt - input.createdAt > this.#maxIntentTtlMs)
      return this.#failure('action-expired')

    const parsed = parseMinecraftAgentAction(input.action)
    if (!parsed.success)
      return this.#failure('invalid-contract')
    const action = parsed.output as MinecraftAgentAction
    if (input.serverProfileId !== policyContext.serverProfileId)
      return this.#failure('server-profile-mismatch')
    if (input.consentGrantId !== policyContext.consent.grantId)
      return this.#failure('consent-required')
    const assessment = assessMinecraftAction(action, policyContext)
    if (assessment.decision === 'reject')
      return this.#failure(assessment.errorCode ?? 'control-denied')
    const expectedRisk = minecraftRiskClassForAction(action)
    if (input.riskClass !== expectedRisk || assessment.riskClass !== expectedRisk)
      return this.#failure('invalid-contract')

    const intent: MinecraftActionProposal = {
      contractVersion: 'minecraft-agent-control/v1',
      intentId: input.intentId,
      goalId: input.goalId,
      sessionId: input.sessionId,
      generation: input.generation,
      serverProfileId: input.serverProfileId,
      consentGrantId: input.consentGrantId,
      action,
      riskClass: input.riskClass,
      state: assessment.decision === 'auto' ? 'approved' : 'awaiting-approval',
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    }
    const validated = parseMinecraftActionProposal(intent)
    if (!validated.success)
      return this.#failure('invalid-contract')
    this.#intents.set(intent.intentId, intent)
    return { ok: true, value: this.#cloneIntent(intent), snapshot: this.#snapshot() }
  }

  approve(intentId: string): MinecraftIntentOperationResult {
    const current = this.#getCurrentIntent(intentId)
    if (!current.intent)
      return this.#failure(current.errorCode ?? 'invalid-transition')
    const intent = current.intent
    if (intent.state !== 'awaiting-approval')
      return this.#failure(this.#terminalError(intent.state) ?? 'invalid-transition')
    intent.state = 'approved'
    return this.#success(intent)
  }

  startExecution(intentId: string): MinecraftIntentOperationResult {
    const current = this.#getCurrentIntent(intentId)
    if (!current.intent)
      return this.#failure(current.errorCode ?? 'invalid-transition')
    const intent = current.intent
    if (intent.state === 'awaiting-approval')
      return this.#failure('approval-required')
    if (intent.state !== 'approved')
      return this.#failure(this.#terminalError(intent.state) ?? 'invalid-transition')
    intent.state = 'executing'
    return this.#success(intent)
  }

  complete(intentId: string): MinecraftIntentOperationResult {
    return this.#finish(intentId, 'completed')
  }

  fail(intentId: string, errorCode: MinecraftStableErrorCode = 'unknown'): MinecraftIntentOperationResult {
    const current = this.#getCurrentIntent(intentId)
    if (!current.intent)
      return this.#failure(current.errorCode ?? 'invalid-transition')
    const intent = current.intent
    if (intent.state !== 'executing')
      return this.#failure(this.#terminalError(intent.state) ?? 'invalid-transition')
    intent.state = 'failed'
    intent.rejectionCode = errorCode
    return this.#success(intent)
  }

  cancel(intentId: string): MinecraftIntentOperationResult {
    const current = this.#getCurrentIntent(intentId)
    if (!current.intent)
      return this.#failure(current.errorCode ?? 'invalid-transition')
    const intent = current.intent
    if (terminalStates.has(intent.state))
      return this.#failure(this.#terminalError(intent.state) ?? 'invalid-transition')
    intent.state = 'cancelled'
    return this.#success(intent)
  }

  stop(_reason?: string): MinecraftIntentSnapshot {
    this.#expireAll()
    for (const intent of this.#intents.values()) {
      if (!terminalStates.has(intent.state))
        intent.state = 'cancelled'
    }
    this.#generation++
    return this.#snapshot()
  }

  advanceGeneration(nextGeneration?: number): MinecraftIntentSnapshot {
    const target = nextGeneration === undefined ? this.#generation + 1 : nextGeneration
    if (target <= this.#generation)
      return this.#snapshot()
    const stopped = this.stop('generation-advanced')
    this.#generation = target
    return { ...stopped, generation: this.#generation }
  }

  #finish(intentId: string, state: Extract<MinecraftActionProposal['state'], 'completed' | 'failed' | 'cancelled'>): MinecraftIntentOperationResult {
    const current = this.#getCurrentIntent(intentId)
    if (!current.intent)
      return this.#failure(current.errorCode ?? 'invalid-transition')
    const intent = current.intent
    if (intent.state !== 'executing')
      return this.#failure(this.#terminalError(intent.state) ?? 'invalid-transition')
    intent.state = state
    return this.#success(intent)
  }

  #getCurrentIntent(intentId: string): { intent?: MinecraftActionProposal, errorCode?: MinecraftStableErrorCode } {
    this.#expireAll()
    const intent = this.#intents.get(intentId)
    if (!intent)
      return { errorCode: 'invalid-transition' }
    if (intent.generation !== this.#generation)
      return { errorCode: 'stale-generation' }
    return { intent }
  }

  #expireAll(): void {
    const now = this.#now()
    for (const intent of this.#intents.values()) {
      if (!terminalStates.has(intent.state) && intent.expiresAt <= now)
        intent.state = 'expired'
    }
  }

  #terminalError(state: MinecraftActionProposal['state']): MinecraftStableErrorCode | undefined {
    if (state === 'expired')
      return 'action-expired'
    if (state === 'cancelled')
      return 'action-cancelled'
    return undefined
  }

  #success(intent: MinecraftActionProposal): MinecraftIntentOperationResult {
    return { ok: true, value: this.#cloneIntent(intent), snapshot: this.#snapshot() }
  }

  #failure(errorCode: MinecraftStableErrorCode): MinecraftIntentOperationResult {
    return { ok: false, errorCode, snapshot: this.#snapshot() }
  }

  #snapshot(): MinecraftIntentSnapshot {
    return {
      sessionId: this.#sessionId,
      generation: this.#generation,
      intents: [...this.#intents.values()].map(intent => this.#cloneIntent(intent)),
    }
  }

  #cloneIntent(intent: MinecraftActionProposal): MinecraftActionProposal {
    const action = intent.action.kind === 'navigate'
      ? { ...intent.action, destination: { ...intent.action.destination } }
      : { ...intent.action }
    return { ...intent, action }
  }
}
