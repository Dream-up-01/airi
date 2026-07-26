import type { ScreenModelRouteDecision, ScreenModelRouteReason } from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import { parseScreenModelRouteDecision } from './schemas'

const allowedReasons = new Set<ScreenModelRouteReason>([
  'flash-low-confidence',
  'consecutive-conflict',
  'complex-multi-window-relation',
  'temporal-process-reasoning',
  'user-requested-process-analysis',
  'tool-relevance-uncertain',
])

export interface ScreenCloudRouteRequest {
  sessionId: string
  generation: number
  reason: ScreenModelRouteReason
  evidenceFactIds: string[]
  flashConfidence?: number
}

export type ScreenCloudRouteResult
  = | { ok: true, decision: ScreenModelRouteDecision }
    | { ok: false, code: 'route-stale' | 'route-reason-invalid' | 'route-confidence-sufficient' | 'route-consent-missing' | 'route-cost-blocked' | 'route-busy' | 'route-cooldown' | 'route-evidence-invalid' }

export class ScreenCloudRouteController {
  readonly #sessionId: string
  readonly #generation: number
  readonly #consentGrantId: string
  readonly #costCounterId: string
  readonly #now: () => number
  readonly #id: () => string
  readonly #isConsentActive: () => boolean
  readonly #isCostAllowed: () => boolean
  readonly #cooldownMs: number
  #inFlight?: ScreenModelRouteDecision
  #nextAllowedAt = 0

  constructor(options: {
    sessionId: string
    generation: number
    consentGrantId: string
    costCounterId: string
    now?: () => number
    id?: () => string
    isConsentActive: () => boolean
    isCostAllowed: () => boolean
    cooldownMs?: number
  }) {
    if (!options.sessionId || !options.consentGrantId || !options.costCounterId || !Number.isInteger(options.generation) || options.generation < 1)
      throw new Error('screen_cloud_route_invalid')
    this.#sessionId = options.sessionId
    this.#generation = options.generation
    this.#consentGrantId = options.consentGrantId
    this.#costCounterId = options.costCounterId
    this.#now = options.now ?? (() => Date.now())
    this.#id = options.id ?? (() => crypto.randomUUID())
    this.#isConsentActive = options.isConsentActive
    this.#isCostAllowed = options.isCostAllowed
    this.#cooldownMs = options.cooldownMs ?? 30_000
  }

  get currentModelId(): 'qwen3.5-omni-flash-realtime' | 'qwen3.5-omni-plus-realtime' {
    return this.#inFlight ? 'qwen3.5-omni-plus-realtime' : 'qwen3.5-omni-flash-realtime'
  }

  request(input: ScreenCloudRouteRequest): ScreenCloudRouteResult {
    const now = this.#now()
    if (input.sessionId !== this.#sessionId || input.generation !== this.#generation)
      return { ok: false, code: 'route-stale' }
    if (!allowedReasons.has(input.reason))
      return { ok: false, code: 'route-reason-invalid' }
    if (!isEvidenceValid(input.evidenceFactIds))
      return { ok: false, code: 'route-evidence-invalid' }
    if (input.reason === 'flash-low-confidence' && (!Number.isFinite(input.flashConfidence) || input.flashConfidence! >= 0.65))
      return { ok: false, code: 'route-confidence-sufficient' }
    if (!this.#isConsentActive())
      return { ok: false, code: 'route-consent-missing' }
    if (!this.#isCostAllowed())
      return { ok: false, code: 'route-cost-blocked' }
    if (this.#inFlight)
      return { ok: false, code: 'route-busy' }
    if (now < this.#nextAllowedAt)
      return { ok: false, code: 'route-cooldown' }

    const decision: ScreenModelRouteDecision = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      decisionId: this.#id(),
      sessionId: this.#sessionId,
      generation: this.#generation,
      fromModelId: 'qwen3.5-omni-flash-realtime',
      toModelId: 'qwen3.5-omni-plus-realtime',
      reason: input.reason,
      evidenceFactIds: [...new Set(input.evidenceFactIds)],
      createdAt: now,
      expiresAt: now + 30_000,
      consentGrantId: this.#consentGrantId,
      costCounterId: this.#costCounterId,
    }
    if (!parseScreenModelRouteDecision(decision).success)
      return { ok: false, code: 'route-evidence-invalid' }
    this.#inFlight = decision
    return { ok: true, decision }
  }

  finish(decisionId: string): boolean {
    if (!this.#inFlight || this.#inFlight.decisionId !== decisionId)
      return false
    this.#inFlight = undefined
    this.#nextAllowedAt = this.#now() + this.#cooldownMs
    return true
  }
}

function isEvidenceValid(factIds: string[]): boolean {
  return factIds.length >= 1
    && factIds.length <= 24
    && factIds.every(value => /^[a-z0-9][\w.:-]{0,159}$/iu.test(value))
}
