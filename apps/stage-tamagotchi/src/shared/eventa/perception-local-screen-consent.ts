import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import { defineInvokeEventa } from '@moeru/eventa'
import { parsePerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

export const LOCAL_SCREEN_CONSENT_VERSION = 'perception-local-screen-consent/v0.3' as const

export type LocalScreenConsentErrorCode
  = | 'invalid-schema'
    | 'consent-policy-violation'
    | 'consent-missing'
    | 'stale-generation'
    | 'session-conflict'

export interface LocalScreenConsentRegisterRequest {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
  grant: PerceptionConsentGrant
}

export interface LocalScreenConsentRevokeRequest {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
  grantId: string
  reason: 'user-stop' | 'permission-revoked' | 'generation-stale' | 'source-ended' | 'unmount' | 'app-exit'
}

export interface LocalScreenConsentStatusRequest {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
}

export interface LocalScreenConsentSnapshot {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
  activeGrantIds: string[]
  activeSourceIds: string[]
  updatedAt: number
}

export interface LocalScreenCaptureExclusionRequest {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
  grantId: string
  enabled: boolean
}

export interface LocalScreenCaptureExclusionStatus {
  contractVersion: typeof LOCAL_SCREEN_CONSENT_VERSION
  sessionId: string
  generation: number
  enabled: boolean
}

export type LocalScreenConsentParseResult<T>
  = | { ok: true, value: T }
    | { ok: false, errorCode: 'invalid-schema' | 'consent-policy-violation' }

export const electronLocalScreenConsentRegister = defineInvokeEventa<
  LocalScreenConsentSnapshot,
  LocalScreenConsentRegisterRequest
>('eventa:invoke:electron:perception:local-screen:consent:register:v0.3')

export const electronLocalScreenConsentRevoke = defineInvokeEventa<
  LocalScreenConsentSnapshot,
  LocalScreenConsentRevokeRequest
>('eventa:invoke:electron:perception:local-screen:consent:revoke:v0.3')

export const electronLocalScreenConsentStatus = defineInvokeEventa<
  LocalScreenConsentSnapshot,
  LocalScreenConsentStatusRequest
>('eventa:invoke:electron:perception:local-screen:consent:status:v0.3')

export const electronLocalScreenCaptureExclusion = defineInvokeEventa<
  LocalScreenCaptureExclusionStatus,
  LocalScreenCaptureExclusionRequest
>('eventa:invoke:electron:perception:local-screen:capture-exclusion:v0.3')

const allowedLocalScreenFactCategories = new Set([
  'screen.activity',
  'screen.application',
  'screen.task',
  'screen.window',
  'screen.health',
])

export function parseLocalScreenConsentRegisterRequest(input: unknown): LocalScreenConsentParseResult<LocalScreenConsentRegisterRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'grant'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  const grantResult = parsePerceptionConsentGrant(input.grant)
  if (!grantResult.success)
    return { ok: false, errorCode: 'invalid-schema' }
  const grant = grantResult.output as PerceptionConsentGrant
  if (grant.sourceKind !== 'screen'
    || grant.processingMode !== 'local-only'
    || grant.allowedModalities.length !== 1
    || grant.allowedModalities[0] !== 'screen-frames'
    || grant.allowedFactCategories.length < 1
    || grant.allowedFactCategories.some(category => !allowedLocalScreenFactCategories.has(category))
    || grant.revokedAt !== undefined
    || !grant.showPersistentIndicator
    || grant.cloudProviderId !== undefined
    || grant.cloudModelId !== undefined
    || grant.regionId !== undefined
    || grant.costBoundaryId !== undefined) {
    return { ok: false, errorCode: 'consent-policy-violation' }
  }
  return {
    ok: true,
    value: {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: input.sessionId,
      generation: input.generation,
      grant,
    },
  }
}

export function parseLocalScreenConsentRevokeRequest(input: unknown): LocalScreenConsentParseResult<LocalScreenConsentRevokeRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'grantId', 'reason'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || !isIdentifier(input.grantId)
    || !['user-stop', 'permission-revoked', 'generation-stale', 'source-ended', 'unmount', 'app-exit'].includes(String(input.reason))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenConsentRevokeRequest }
}

export function parseLocalScreenConsentStatusRequest(input: unknown): LocalScreenConsentParseResult<LocalScreenConsentStatusRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenConsentStatusRequest }
}

export function parseLocalScreenConsentSnapshot(input: unknown): LocalScreenConsentParseResult<LocalScreenConsentSnapshot> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'activeGrantIds', 'activeSourceIds', 'updatedAt'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || !isIdentifierArray(input.activeGrantIds)
    || !isIdentifierArray(input.activeSourceIds)
    || !isTimestamp(input.updatedAt)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenConsentSnapshot }
}

export function parseLocalScreenCaptureExclusionRequest(input: unknown): LocalScreenConsentParseResult<LocalScreenCaptureExclusionRequest> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'grantId', 'enabled'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || !isIdentifier(input.grantId)
    || typeof input.enabled !== 'boolean') {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenCaptureExclusionRequest }
}

export function parseLocalScreenCaptureExclusionStatus(input: unknown): LocalScreenConsentParseResult<LocalScreenCaptureExclusionStatus> {
  if (!isRecord(input)
    || !hasExactKeys(input, ['contractVersion', 'sessionId', 'generation', 'enabled'])
    || input.contractVersion !== LOCAL_SCREEN_CONSENT_VERSION
    || !isIdentifier(input.sessionId)
    || !isGeneration(input.generation)
    || typeof input.enabled !== 'boolean') {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as LocalScreenCaptureExclusionStatus }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 8 && value.every(isIdentifier)
}

function isGeneration(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function isTimestamp(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}
