import type {
  PerceptionConsentGrant,
  PerceptionProcessingMode,
  PerceptionSession,
  PerceptionSessionErrorCode,
  PerceptionSourceKind,
} from './contracts'
import type { PerceptionOwnerHandle, PerceptionOwnerProvider } from './owner'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import { parsePerceptionConsentGrant } from './schemas'

export interface PerceptionLifecycleHooks {
  onGenerationChanged?: (sessionId: string, generation: number) => void
  onSourceRevoked?: (sourceKind: PerceptionSourceKind, sourceId: string) => void
}

export interface PerceptionActiveSource {
  sourceKind: PerceptionSourceKind
  sourceId: string
  stop: () => void | Promise<void>
}

export interface CreatePerceptionSessionControllerOptions {
  sessionId: string
  processingMode: PerceptionProcessingMode
  ownerId: string
  ownerProvider: PerceptionOwnerProvider
  now?: () => number
  cleanupTimeoutMs?: number
  hooks?: PerceptionLifecycleHooks
}

export type PerceptionLifecycleResult<T = PerceptionSession>
  = | { ok: true, value: T }
    | { ok: false, code: PerceptionSessionErrorCode, session: PerceptionSession }

export class PerceptionSessionController {
  readonly #now: () => number
  readonly #cleanupTimeoutMs: number
  readonly #ownerId: string
  readonly #ownerProvider: PerceptionOwnerProvider
  readonly #hooks: PerceptionLifecycleHooks
  readonly #grants = new Map<string, PerceptionConsentGrant>()
  readonly #activeSources = new Map<string, PerceptionActiveSource>()
  #pendingPermission?: { sourceKind: PerceptionSourceKind, sourceId: string, previousState: PerceptionSession['state'] }
  #ownerHandle?: PerceptionOwnerHandle
  #session: PerceptionSession
  #cleanupPromise?: Promise<void>
  #stopPromise?: Promise<PerceptionLifecycleResult>

  constructor(options: CreatePerceptionSessionControllerOptions) {
    this.#now = options.now ?? (() => Date.now())
    this.#cleanupTimeoutMs = options.cleanupTimeoutMs ?? 400
    this.#ownerId = options.ownerId
    this.#ownerProvider = options.ownerProvider
    this.#hooks = options.hooks ?? {}
    const now = this.#now()
    this.#session = {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      sessionId: options.sessionId,
      state: 'idle',
      enabledSources: [],
      activeSourceIds: [],
      processingMode: options.processingMode,
      generation: 0,
      startedAt: now,
      updatedAt: now,
    }
  }

  get session(): PerceptionSession {
    return this.#snapshot()
  }

  get grants(): PerceptionConsentGrant[] {
    return [...this.#grants.values()].map(grant => ({ ...grant, allowedModalities: [...grant.allowedModalities], allowedFactCategories: [...grant.allowedFactCategories] }))
  }

  requestPermission(sourceKind: PerceptionSourceKind, sourceId: string): PerceptionLifecycleResult {
    if (this.#pendingPermission)
      return this.#failure('invalid-transition')
    if (!['idle', 'running', 'paused', 'failed', 'stopped'].includes(this.#session.state))
      return this.#failure('invalid-transition')

    this.#pendingPermission = { sourceKind, sourceId, previousState: this.#session.state }
    this.#update({ state: 'requesting-permission', lastErrorCode: undefined })
    return { ok: true, value: this.#snapshot() }
  }

  grantPermission(input: unknown): PerceptionLifecycleResult<PerceptionConsentGrant> {
    if (!this.#pendingPermission || this.#session.state !== 'requesting-permission')
      return this.#failure('invalid-transition')

    const parsed = parsePerceptionConsentGrant(input)
    if (!parsed.success)
      return this.#failure('permission-denied')
    const grant = parsed.output as PerceptionConsentGrant
    if (grant.sourceKind !== this.#pendingPermission.sourceKind || grant.sourceId !== this.#pendingPermission.sourceId || grant.revokedAt !== undefined)
      return this.#failure('permission-denied')
    if (grant.processingMode !== 'local-only' && (!grant.cloudProviderId || !grant.cloudModelId || !grant.regionId || !grant.costBoundaryId))
      return this.#failure('permission-denied')

    const previousState = this.#pendingPermission.previousState
    this.#pendingPermission = undefined
    this.#grants.set(grant.sourceId, grant)
    this.#update({
      state: this.#activeSources.size > 0 ? 'running' : previousState === 'paused' ? 'paused' : 'idle',
      enabledSources: this.#uniqueEnabledSources(),
      lastErrorCode: undefined,
    })
    return { ok: true, value: { ...grant } }
  }

  denyPermission(): PerceptionLifecycleResult {
    if (!this.#pendingPermission || this.#session.state !== 'requesting-permission')
      return this.#failure('invalid-transition')
    this.#pendingPermission = undefined
    this.#update({ state: 'failed', lastErrorCode: 'permission-denied' })
    return { ok: true, value: this.#snapshot() }
  }

  async activateSource(source: PerceptionActiveSource): Promise<PerceptionLifecycleResult> {
    if (this.#pendingPermission || !['idle', 'paused', 'running', 'stopped'].includes(this.#session.state))
      return this.#failure('invalid-transition')
    const grant = this.#grants.get(source.sourceId)
    if (!grant || grant.revokedAt !== undefined || grant.sourceKind !== source.sourceKind)
      return this.#failure('permission-required')
    if (this.#activeSources.has(source.sourceId))
      return { ok: true, value: this.#snapshot() }

    if (!this.#ownerHandle) {
      this.#ownerHandle = await this.#ownerProvider.acquire(this.#ownerId)
      if (!this.#ownerHandle)
        return this.#failure('owner-unavailable')
    }

    this.#activeSources.set(source.sourceId, source)
    this.#bumpGeneration()
    this.#update({
      state: 'running',
      activeSourceIds: [...this.#activeSources.keys()],
      enabledSources: this.#uniqueEnabledSources(),
      lastErrorCode: undefined,
    })
    return { ok: true, value: this.#snapshot() }
  }

  async pause(): Promise<PerceptionLifecycleResult> {
    if (this.#session.state === 'paused')
      return { ok: true, value: this.#snapshot() }
    if (this.#session.state !== 'running')
      return this.#failure('invalid-transition')

    this.#update({ state: 'stopping' })
    await this.#cleanupActiveSources()
    this.#bumpGeneration()
    this.#update({ state: 'paused', activeSourceIds: [] })
    return { ok: true, value: this.#snapshot() }
  }

  async stop(): Promise<PerceptionLifecycleResult> {
    if (this.#stopPromise)
      return this.#stopPromise
    if (this.#session.state === 'stopped') {
      await this.#cleanupActiveSources()
      return { ok: true, value: this.#snapshot() }
    }

    this.#stopPromise = (async () => {
      this.#pendingPermission = undefined
      this.#update({ state: 'stopping' })
      await this.#cleanupActiveSources()
      this.#bumpGeneration()
      this.#update({ state: 'stopped', activeSourceIds: [] })
      return { ok: true, value: this.#snapshot() } as const
    })().finally(() => {
      this.#stopPromise = undefined
    })
    return this.#stopPromise
  }

  async revokeSource(sourceId: string): Promise<PerceptionLifecycleResult> {
    const grant = this.#grants.get(sourceId)
    if (!grant)
      return this.#failure('source-not-enabled')

    const active = this.#activeSources.get(sourceId)
    if (active)
      await this.#stopOne(active)
    this.#activeSources.delete(sourceId)
    this.#grants.set(sourceId, { ...grant, revokedAt: this.#now() })
    this.#hooks.onSourceRevoked?.(grant.sourceKind, sourceId)
    this.#bumpGeneration()
    await this.#releaseOwnerIfIdle()
    this.#update({
      state: this.#activeSources.size > 0 ? 'running' : 'stopped',
      activeSourceIds: [...this.#activeSources.keys()],
      enabledSources: this.#uniqueEnabledSources(),
      lastErrorCode: 'consent-revoked',
    })
    return { ok: true, value: this.#snapshot() }
  }

  async sourceEnded(sourceId: string): Promise<PerceptionLifecycleResult> {
    const source = this.#activeSources.get(sourceId)
    if (!source)
      return this.#failure('source-not-enabled')
    await this.#stopOne(source)
    this.#activeSources.delete(sourceId)
    this.#hooks.onSourceRevoked?.(source.sourceKind, sourceId)
    this.#bumpGeneration()
    await this.#releaseOwnerIfIdle()
    this.#update({
      state: this.#activeSources.size > 0 ? 'running' : 'failed',
      activeSourceIds: [...this.#activeSources.keys()],
      lastErrorCode: 'source-ended',
    })
    return { ok: true, value: this.#snapshot() }
  }

  async switchProcessingMode(processingMode: PerceptionProcessingMode): Promise<PerceptionLifecycleResult> {
    if (processingMode === this.#session.processingMode)
      return { ok: true, value: this.#snapshot() }
    await this.#cleanupActiveSources()
    this.#bumpGeneration()
    this.#update({ processingMode, state: 'stopped', activeSourceIds: [] })
    return { ok: true, value: this.#snapshot() }
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  async #cleanupActiveSources(): Promise<void> {
    if (this.#cleanupPromise)
      return this.#cleanupPromise
    this.#cleanupPromise = (async () => {
      const sources = [...this.#activeSources.values()]
      this.#activeSources.clear()
      await Promise.allSettled(sources.map(source => this.#stopOne(source)))
      await this.#releaseOwnerIfIdle()
    })().finally(() => {
      this.#cleanupPromise = undefined
    })
    return this.#cleanupPromise
  }

  async #stopOne(source: PerceptionActiveSource): Promise<void> {
    await Promise.race([
      Promise.resolve().then(() => source.stop()),
      new Promise<void>(resolve => setTimeout(resolve, this.#cleanupTimeoutMs)),
    ])
  }

  async #releaseOwnerIfIdle(): Promise<void> {
    if (this.#activeSources.size > 0 || !this.#ownerHandle)
      return
    const owner = this.#ownerHandle
    this.#ownerHandle = undefined
    await owner.release()
  }

  #bumpGeneration(): void {
    this.#session = { ...this.#session, generation: this.#session.generation + 1 }
    this.#hooks.onGenerationChanged?.(this.#session.sessionId, this.#session.generation)
  }

  #uniqueEnabledSources(): PerceptionSourceKind[] {
    return [...new Set([...this.#grants.values()].filter(grant => grant.revokedAt === undefined).map(grant => grant.sourceKind))]
  }

  #update(patch: Partial<PerceptionSession>): void {
    this.#session = { ...this.#session, ...patch, updatedAt: Math.max(this.#session.updatedAt, this.#now()) }
  }

  #snapshot(): PerceptionSession {
    return {
      ...this.#session,
      enabledSources: [...this.#session.enabledSources],
      activeSourceIds: [...this.#session.activeSourceIds],
    }
  }

  #failure<T = PerceptionSession>(code: PerceptionSessionErrorCode): PerceptionLifecycleResult<T> {
    return { ok: false, code, session: this.#snapshot() }
  }
}
