import type {
  MinecraftActionExecutionContext,
  MinecraftActionProposal,
  MinecraftAgentAction,
  MinecraftAgentExecutorAdapter,
  MinecraftConsentGrant,
  MinecraftIntentState,
  MinecraftServerProfile,
  MinecraftStableErrorCode,
} from '@proj-airi/stage-ui/domains/minecraft-companion'

import { createHash, randomUUID } from 'node:crypto'

import {
  createMinecraftGoal,
  MinecraftIntentController,
  minecraftRiskClassForAction,
  parseMinecraftConsentGrant,
  parseMinecraftServerProfile,
} from '@proj-airi/stage-ui/domains/minecraft-companion'

const DEFAULT_ACTION_TTL_MS = 30_000
const MAX_COMMAND_ID_LENGTH = 160

export interface MinecraftRuntimeServerConfig {
  host: string
  port: number
  username: string
  version?: string
  auth?: 'mojang' | 'microsoft' | 'offline'
}

function stableProfileId(prefix: 'server' | 'account', value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)
  return `${prefix}-${digest}`
}

/** Builds an internal profile from Mineflayer settings without treating a launcher as the server. */
export function createMinecraftServerProfileFromRuntimeConfig(config: MinecraftRuntimeServerConfig): MinecraftServerProfile {
  const normalizedHost = config.host.toLowerCase()
  return {
    contractVersion: 'minecraft-companion/v1',
    serverProfileId: stableProfileId('server', `${normalizedHost}:${config.port}`),
    host: normalizedHost,
    port: config.port,
    minecraftVersion: config.version ?? 'auto',
    runtime: 'unknown',
    authMode: config.auth === 'offline'
      ? 'offline'
      : (config.auth === 'microsoft' || config.auth === 'mojang' ? 'online' : 'unknown'),
    serverKind: 'unknown',
    accountProfileId: stableProfileId('account', config.username),
    allowVirtualPlayerJoin: true,
  }
}

export interface MinecraftAgentRuntimeOptions {
  sessionId: string
  generation?: number
  serverProfile: MinecraftServerProfile
  executor: MinecraftAgentExecutorAdapter
  consent?: MinecraftConsentGrant
  now?: () => number
  idFactory?: (prefix: 'goal' | 'intent') => string
  actionTtlMs?: number
}

export interface MinecraftAgentRuntimeActionContext {
  commandId: string
}

export type MinecraftAgentRuntimeResult
  = | { ok: true, intentId: string, state: MinecraftIntentState }
    | { ok: false, errorCode: MinecraftStableErrorCode, intentId?: string }

interface InFlightExecution {
  abortController: AbortController
  context: MinecraftActionExecutionContext
}

function defaultIdFactory(prefix: 'goal' | 'intent'): string {
  return `${prefix}-${randomUUID()}`
}

function isBoundedCommandId(commandId: string): boolean {
  return commandId.length > 0
    && commandId.length <= MAX_COMMAND_ID_LENGTH
    && /^[a-z0-9][\w.:-]*$/iu.test(commandId)
}

export class MinecraftAgentRuntime {
  readonly #now: () => number
  readonly #idFactory: (prefix: 'goal' | 'intent') => string
  readonly #actionTtlMs: number
  readonly #executor: MinecraftAgentExecutorAdapter
  readonly #serverProfile?: MinecraftServerProfile
  readonly #controller: MinecraftIntentController
  readonly #consent?: MinecraftConsentGrant
  readonly #inFlight = new Map<string, InFlightExecution>()

  constructor(options: MinecraftAgentRuntimeOptions) {
    this.#now = options.now ?? Date.now
    this.#idFactory = options.idFactory ?? defaultIdFactory
    this.#actionTtlMs = options.actionTtlMs ?? DEFAULT_ACTION_TTL_MS
    this.#executor = options.executor

    const parsedProfile = parseMinecraftServerProfile(options.serverProfile)
    this.#serverProfile = parsedProfile.success
      ? parsedProfile.output as MinecraftServerProfile
      : undefined

    const parsedConsent = options.consent === undefined
      ? undefined
      : parseMinecraftConsentGrant(options.consent)
    this.#consent = parsedConsent?.success
      ? parsedConsent.output as MinecraftConsentGrant
      : undefined

    this.#controller = new MinecraftIntentController({
      sessionId: options.sessionId,
      generation: options.generation ?? 1,
      now: this.#now,
      maxIntentTtlMs: this.#actionTtlMs,
    })
  }

  get generation(): number {
    return this.#controller.generation
  }

  async handleAction(action: MinecraftAgentAction, context: MinecraftAgentRuntimeActionContext): Promise<MinecraftAgentRuntimeResult> {
    if (!this.#serverProfile)
      return { ok: false, errorCode: 'server-profile-invalid' }
    if (!isBoundedCommandId(context.commandId))
      return { ok: false, errorCode: 'invalid-contract' }

    const consent = this.#consent
    if (!consent)
      return { ok: false, errorCode: 'consent-required' }
    if (consent.serverProfileId !== this.#serverProfile.serverProfileId)
      return { ok: false, errorCode: 'server-profile-mismatch' }
    if (consent.revokedAt !== undefined)
      return { ok: false, errorCode: 'consent-revoked' }
    if (!this.#serverProfile.allowVirtualPlayerJoin || !consent.allowVirtualPlayerJoin)
      return { ok: false, errorCode: 'consent-required' }

    const now = this.#now()
    const goalId = this.#idFactory('goal')
    const intentId = this.#idFactory('intent')
    const generation = this.#controller.generation
    const expiresAt = now + this.#actionTtlMs
    const goalResult = createMinecraftGoal({
      contractVersion: 'minecraft-agent-control/v1',
      goalId,
      sessionId: this.#controller.snapshot.sessionId,
      generation,
      serverProfileId: this.#serverProfile.serverProfileId,
      consentGrantId: consent.grantId,
      createdAt: now,
      expiresAt,
      ...action,
    })
    if (!goalResult.ok)
      return { ok: false, errorCode: goalResult.errorCode }

    const proposed = this.#controller.propose({
      intentId,
      goalId,
      sessionId: goalResult.value.sessionId,
      generation,
      serverProfileId: this.#serverProfile.serverProfileId,
      consentGrantId: consent.grantId,
      action,
      riskClass: minecraftRiskClassForAction(action),
      createdAt: now,
      expiresAt,
    }, {
      serverProfileId: this.#serverProfile.serverProfileId,
      consent,
      now,
    })
    if (!proposed.ok)
      return { ok: false, errorCode: proposed.errorCode, intentId }
    if (proposed.value.state === 'awaiting-approval')
      return { ok: true, intentId, state: proposed.value.state }

    return this.#execute(proposed.value)
  }

  async approve(intentId: string): Promise<MinecraftAgentRuntimeResult> {
    const approved = this.#controller.approve(intentId)
    if (!approved.ok)
      return { ok: false, errorCode: approved.errorCode, intentId }
    return this.#execute(approved.value)
  }

  async cancel(intentId: string): Promise<MinecraftAgentRuntimeResult> {
    const inFlight = this.#inFlight.get(intentId)
    if (inFlight) {
      inFlight.abortController.abort('action-cancelled')
      await this.#executor.cancel(intentId, inFlight.context)
    }
    const cancelled = this.#controller.cancel(intentId)
    if (!cancelled.ok)
      return { ok: false, errorCode: cancelled.errorCode, intentId }
    return { ok: true, intentId, state: cancelled.value.state }
  }

  async stop(): Promise<number> {
    await this.#cancelInFlight('runtime-stopped')
    return this.#controller.stop('runtime-stopped').generation
  }

  async advanceGeneration(nextGeneration?: number): Promise<number> {
    await this.#cancelInFlight('generation-advanced')
    return this.#controller.advanceGeneration(nextGeneration).generation
  }

  async #execute(proposal: MinecraftActionProposal): Promise<MinecraftAgentRuntimeResult> {
    const started = this.#controller.startExecution(proposal.intentId)
    if (!started.ok)
      return { ok: false, errorCode: started.errorCode, intentId: proposal.intentId }
    if (!this.#executor.supports(proposal.action)) {
      this.#controller.fail(proposal.intentId, 'control-denied')
      return { ok: false, errorCode: 'control-denied', intentId: proposal.intentId }
    }

    const abortController = new AbortController()
    const executionContext: MinecraftActionExecutionContext = {
      goalId: proposal.goalId,
      sessionId: proposal.sessionId,
      generation: proposal.generation,
      serverProfileId: proposal.serverProfileId,
      intentId: proposal.intentId,
      signal: abortController.signal,
    }
    this.#inFlight.set(proposal.intentId, { abortController, context: executionContext })

    try {
      const result = await this.#executor.execute(proposal.action, executionContext)
      if (proposal.generation !== this.#controller.generation)
        return { ok: false, errorCode: 'stale-generation', intentId: proposal.intentId }
      if (result.state === 'completed') {
        const completed = this.#controller.complete(proposal.intentId)
        return completed.ok
          ? { ok: true, intentId: proposal.intentId, state: completed.value.state }
          : { ok: false, errorCode: completed.errorCode, intentId: proposal.intentId }
      }
      if (result.state === 'cancelled') {
        const cancelled = this.#controller.cancel(proposal.intentId)
        return cancelled.ok
          ? { ok: true, intentId: proposal.intentId, state: cancelled.value.state }
          : { ok: false, errorCode: cancelled.errorCode, intentId: proposal.intentId }
      }

      const errorCode = result.errorCode ?? 'unknown'
      this.#controller.fail(proposal.intentId, errorCode)
      return { ok: false, errorCode, intentId: proposal.intentId }
    }
    catch {
      if (proposal.generation !== this.#controller.generation)
        return { ok: false, errorCode: 'stale-generation', intentId: proposal.intentId }
      this.#controller.fail(proposal.intentId, 'unknown')
      return { ok: false, errorCode: 'unknown', intentId: proposal.intentId }
    }
    finally {
      this.#inFlight.delete(proposal.intentId)
    }
  }

  async #cancelInFlight(reason: string): Promise<void> {
    const inFlight = [...this.#inFlight]
    this.#inFlight.clear()
    for (const [, execution] of inFlight) {
      execution.abortController.abort(reason)
    }
    await Promise.all(inFlight.map(async ([intentId, execution]) => {
      try {
        await this.#executor.cancel(intentId, execution.context)
      }
      catch {
        // Cancellation remains best-effort, but generation cannot advance before every attempt settles.
      }
    }))
  }
}
