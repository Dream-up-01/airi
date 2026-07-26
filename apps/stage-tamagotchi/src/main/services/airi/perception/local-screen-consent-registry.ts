import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import type {
  LocalScreenConsentRegisterRequest,
  LocalScreenConsentRevokeRequest,
  LocalScreenConsentSnapshot,
  LocalScreenConsentStatusRequest,
} from '../../../../shared/eventa/perception-local-screen-consent'

import {
  LOCAL_SCREEN_CONSENT_VERSION,
  parseLocalScreenConsentRegisterRequest,
  parseLocalScreenConsentRevokeRequest,
  parseLocalScreenConsentStatusRequest,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

export class LocalScreenConsentRegistryError extends Error {
  readonly code

  constructor(code: import('../../../../shared/eventa/perception-local-screen-consent').LocalScreenConsentErrorCode) {
    super(code)
    this.name = 'LocalScreenConsentRegistryError'
    this.code = code
  }
}

interface ActiveGrant {
  sessionId: string
  generation: number
  grant: PerceptionConsentGrant
}

export interface LocalScreenConsentRegistry {
  register: (request: LocalScreenConsentRegisterRequest | unknown) => LocalScreenConsentSnapshot
  revoke: (request: LocalScreenConsentRevokeRequest | unknown) => LocalScreenConsentSnapshot
  status: (request: LocalScreenConsentStatusRequest | unknown) => LocalScreenConsentSnapshot
  isActive: (grantId: string, sessionId: string, generation: number) => boolean
  clearAll: () => void
}

export function createLocalScreenConsentRegistry(options: { now?: () => number } = {}): LocalScreenConsentRegistry {
  const now = options.now ?? Date.now
  const activeGrants = new Map<string, ActiveGrant>()
  const latestGenerations = new Map<string, number>()
  let activeSessionId = ''
  let activeGeneration = 0
  let updatedAt = now()

  function register(input: LocalScreenConsentRegisterRequest | unknown): LocalScreenConsentSnapshot {
    const parsed = parseLocalScreenConsentRegisterRequest(input)
    if (!parsed.ok)
      throw new LocalScreenConsentRegistryError(parsed.errorCode)
    const request = parsed.value
    if (activeGrants.size > 0 && activeSessionId !== request.sessionId)
      throw new LocalScreenConsentRegistryError('session-conflict')
    if ((latestGenerations.get(request.sessionId) ?? 0) > request.generation)
      throw new LocalScreenConsentRegistryError('stale-generation')
    if (activeGeneration < request.generation)
      activeGrants.clear()

    const existingSource = [...activeGrants.values()].find(entry => entry.grant.sourceId === request.grant.sourceId)
    if (existingSource && existingSource.grant.grantId !== request.grant.grantId)
      activeGrants.delete(existingSource.grant.grantId)

    activeSessionId = request.sessionId
    activeGeneration = request.generation
    latestGenerations.set(request.sessionId, request.generation)
    activeGrants.set(request.grant.grantId, {
      sessionId: request.sessionId,
      generation: request.generation,
      grant: cloneGrant(request.grant),
    })
    updatedAt = Math.max(updatedAt, now())
    return snapshot(request.sessionId, request.generation)
  }

  function revoke(input: LocalScreenConsentRevokeRequest | unknown): LocalScreenConsentSnapshot {
    const parsed = parseLocalScreenConsentRevokeRequest(input)
    if (!parsed.ok)
      throw new LocalScreenConsentRegistryError(parsed.errorCode)
    const request = parsed.value
    if (activeGrants.size > 0 && activeSessionId !== request.sessionId)
      throw new LocalScreenConsentRegistryError('session-conflict')
    if ((latestGenerations.get(request.sessionId) ?? 0) > request.generation)
      throw new LocalScreenConsentRegistryError('stale-generation')
    if (activeGeneration < request.generation) {
      activeGrants.clear()
      activeSessionId = request.sessionId
      activeGeneration = request.generation
      latestGenerations.set(request.sessionId, request.generation)
      updatedAt = Math.max(updatedAt, now())
      return snapshot(request.sessionId, request.generation)
    }
    if (!activeGrants.delete(request.grantId))
      throw new LocalScreenConsentRegistryError('consent-missing')
    latestGenerations.set(request.sessionId, request.generation)
    updatedAt = Math.max(updatedAt, now())
    const result = snapshot(request.sessionId, request.generation)
    if (activeGrants.size === 0) {
      activeSessionId = ''
      activeGeneration = 0
    }
    return result
  }

  function status(input: LocalScreenConsentStatusRequest | unknown): LocalScreenConsentSnapshot {
    const parsed = parseLocalScreenConsentStatusRequest(input)
    if (!parsed.ok)
      throw new LocalScreenConsentRegistryError(parsed.errorCode)
    const request = parsed.value
    if (activeGrants.size > 0 && activeSessionId !== request.sessionId)
      throw new LocalScreenConsentRegistryError('session-conflict')
    if ((latestGenerations.get(request.sessionId) ?? 0) > request.generation)
      throw new LocalScreenConsentRegistryError('stale-generation')
    if (!activeSessionId || activeGeneration < request.generation)
      return emptySnapshot(request.sessionId, request.generation, updatedAt)
    return snapshot(request.sessionId, request.generation)
  }

  function isActive(grantId: string, sessionId: string, generation: number): boolean {
    const entry = activeGrants.get(grantId)
    return entry?.sessionId === sessionId
      && entry.generation === generation
      && entry.grant.revokedAt === undefined
      && entry.grant.showPersistentIndicator
  }

  function clearAll(): void {
    activeGrants.clear()
    latestGenerations.clear()
    activeSessionId = ''
    activeGeneration = 0
    updatedAt = Math.max(updatedAt, now())
  }

  function snapshot(sessionId: string, generation: number): LocalScreenConsentSnapshot {
    const grants = [...activeGrants.values()]
      .filter(entry => entry.sessionId === sessionId && entry.generation === generation)
    return {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId,
      generation,
      activeGrantIds: grants.map(entry => entry.grant.grantId),
      activeSourceIds: [...new Set(grants.map(entry => entry.grant.sourceId))],
      updatedAt,
    }
  }

  return { register, revoke, status, isActive, clearAll }
}

export function setupLocalScreenConsentRegistry(options: { now?: () => number } = {}) {
  const registry = createLocalScreenConsentRegistry(options)
  onAppBeforeQuit(() => registry.clearAll())
  return registry
}

function emptySnapshot(sessionId: string, generation: number, updatedAt: number): LocalScreenConsentSnapshot {
  return {
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId,
    generation,
    activeGrantIds: [],
    activeSourceIds: [],
    updatedAt,
  }
}

function cloneGrant(grant: PerceptionConsentGrant): PerceptionConsentGrant {
  return {
    ...grant,
    allowedModalities: [...grant.allowedModalities],
    allowedFactCategories: [...grant.allowedFactCategories],
  }
}
