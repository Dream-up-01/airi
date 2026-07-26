import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import type {
  QwenCloudGrantErrorCode,
  QwenCloudGrantRegisterRequest,
  QwenCloudGrantRevokeRequest,
  QwenCloudGrantSnapshot,
} from '../../../../shared/eventa/perception-cloud'

import {
  parseQwenCloudGrantRegisterRequest,
  parseQwenCloudGrantRevokeRequest,
  QWEN_CLOUD_GRANT_VERSION,
} from '../../../../shared/eventa/perception-cloud'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

interface ActiveGrant {
  ownerId: string
  sessionId: string
  generation: number
  grant: PerceptionConsentGrant
}

export class QwenCloudGrantRegistryError extends Error {
  constructor(readonly code: QwenCloudGrantErrorCode) {
    super(code)
    this.name = 'QwenCloudGrantRegistryError'
  }
}

export class QwenCloudGrantRegistry {
  readonly #now: () => number
  readonly #active = new Map<string, ActiveGrant>()
  readonly #latestGeneration = new Map<string, number>()
  #updatedAt: number

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now
    this.#updatedAt = this.#now()
  }

  register(input: QwenCloudGrantRegisterRequest | unknown, ownerId = 'renderer:unknown'): QwenCloudGrantSnapshot {
    const parsed = parseQwenCloudGrantRegisterRequest(input)
    if (!parsed.ok)
      throw new QwenCloudGrantRegistryError(parsed.errorCode)
    const request = parsed.value
    this.#assertGeneration(request.sessionId, request.generation)

    const latest = this.#latestGeneration.get(request.sessionId) ?? 0
    if (request.generation > latest)
      this.#clearSession(request.sessionId)
    this.#latestGeneration.set(request.sessionId, request.generation)
    this.#active.set(request.grant.grantId, {
      ownerId,
      sessionId: request.sessionId,
      generation: request.generation,
      grant: cloneGrant(request.grant),
    })
    if (this.#active.size > 8) {
      this.#active.delete(request.grant.grantId)
      throw new QwenCloudGrantRegistryError('session-conflict')
    }
    this.#touch()
    return this.snapshot(request.sessionId, request.generation)
  }

  revoke(input: QwenCloudGrantRevokeRequest | unknown): QwenCloudGrantSnapshot {
    const parsed = parseQwenCloudGrantRevokeRequest(input)
    if (!parsed.ok)
      throw new QwenCloudGrantRegistryError(parsed.errorCode)
    const request = parsed.value
    this.#assertGeneration(request.sessionId, request.generation)
    const entry = this.#active.get(request.grantId)
    if (!entry || entry.sessionId !== request.sessionId || entry.generation !== request.generation)
      throw new QwenCloudGrantRegistryError('consent-missing')
    this.#active.delete(request.grantId)
    this.#touch()
    const result = this.snapshot(request.sessionId, request.generation)
    return result
  }

  snapshot(sessionId: string, generation: number): QwenCloudGrantSnapshot {
    return {
      contractVersion: QWEN_CLOUD_GRANT_VERSION,
      sessionId,
      generation,
      activeGrantIds: [...this.#active.values()]
        .filter(entry => entry.sessionId === sessionId && entry.generation === generation)
        .map(entry => entry.grant.grantId),
      updatedAt: this.#updatedAt,
    }
  }

  authorize(input: {
    sessionId: string
    generation: number
    sourceKind: 'screen-cloud' | 'camera-cloud'
    sourceId: string
    modelId: string
    frameGrantId: string
    audioGrantId: string
  }): boolean {
    const frame = this.#active.get(input.frameGrantId)
    const audio = this.#active.get(input.audioGrantId)
    const expectedSourceKind = input.sourceKind === 'screen-cloud' ? 'screen' : 'camera'
    const expectedFrameModality = input.sourceKind === 'screen-cloud' ? 'screen-frames' : 'camera-frames'
    return !!frame && !!audio
      && frame.sessionId === input.sessionId
      && audio.sessionId === input.sessionId
      && frame.generation === input.generation
      && audio.generation === input.generation
      && frame.grant.sourceKind === expectedSourceKind
      && audio.grant.sourceKind === expectedSourceKind
      && frame.grant.sourceId === input.sourceId
      && audio.grant.sourceId === input.sourceId
      && frame.grant.cloudModelId === input.modelId
      && audio.grant.cloudModelId === input.modelId
      && frame.grant.allowedModalities.length === 1
      && frame.grant.allowedModalities[0] === expectedFrameModality
      && audio.grant.allowedModalities.length === 1
      && audio.grant.allowedModalities[0] === 'microphone-audio'
  }

  clearAll(): void {
    this.#active.clear()
    this.#latestGeneration.clear()
    this.#touch()
  }

  clearOwner(ownerId: string): string[] {
    const revokedGrantIds: string[] = []
    for (const [grantId, entry] of this.#active) {
      if (entry.ownerId !== ownerId)
        continue
      this.#active.delete(grantId)
      revokedGrantIds.push(grantId)
    }
    if (revokedGrantIds.length > 0)
      this.#touch()
    return revokedGrantIds
  }

  #assertGeneration(sessionId: string, generation: number): void {
    if ((this.#latestGeneration.get(sessionId) ?? 0) > generation)
      throw new QwenCloudGrantRegistryError('stale-generation')
  }

  #clearSession(sessionId: string): void {
    for (const [grantId, entry] of this.#active) {
      if (entry.sessionId === sessionId)
        this.#active.delete(grantId)
    }
  }

  #touch(): void {
    this.#updatedAt = Math.max(this.#updatedAt, this.#now())
  }
}

export function setupQwenCloudGrantRegistry(): QwenCloudGrantRegistry {
  const registry = new QwenCloudGrantRegistry()
  onAppBeforeQuit(() => registry.clearAll())
  return registry
}

function cloneGrant(grant: PerceptionConsentGrant): PerceptionConsentGrant {
  return {
    ...grant,
    allowedModalities: [...grant.allowedModalities],
    allowedFactCategories: [...grant.allowedFactCategories],
  }
}
