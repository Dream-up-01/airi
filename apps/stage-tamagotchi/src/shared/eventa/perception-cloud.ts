import type {
  PerceptionConsentGrant,
  QwenCloudCostSnapshot,
  QwenCloudReadinessBlockingCode,
} from '@proj-airi/stage-ui/domains/perception'

import { defineInvokeEventa } from '@moeru/eventa'
import {
  approvedQwenCloudPerceptionPolicy,
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_ENDPOINT_REGION_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
  QWEN_PLUS_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'

export const QWEN_CLOUD_CONTROL_VERSION = 'perception-cloud-control/v0.3' as const
export const QWEN_CLOUD_GRANT_VERSION = 'perception-cloud-grant/v0.3' as const

export interface QwenCloudControlRequest {
  contractVersion: typeof QWEN_CLOUD_CONTROL_VERSION
  requestId: string
}

export interface QwenCloudControlStatus extends QwenCloudControlRequest {
  state: 'blocked' | 'ready' | 'stopped' | 'failed'
  providerId: typeof QWEN_CLOUD_PROVIDER_ID
  regionId: typeof QWEN_CLOUD_REGION_ID
  endpointRegionId: typeof QWEN_CLOUD_ENDPOINT_REGION_ID
  screenResidentModelId: typeof QWEN_FLASH_REALTIME_MODEL_ID
  screenEscalationModelId: typeof QWEN_PLUS_REALTIME_MODEL_ID
  cameraModelId: typeof QWEN_FLASH_REALTIME_MODEL_ID
  cameraAutomaticEscalation: false
  responseControl: 'manual'
  outputMode: 'text-encoded-objective-json'
  localRetention: 'none'
  providerRetention: 'shortest-available-no-training'
  proactiveReactions: false
  workspaceConfigured: boolean
  apiKeyConfigured: boolean
  providerRetentionVerified: boolean
  modelAvailabilityVerified: boolean
  providerClientAvailable: boolean
  costLedgerAvailable: boolean
  blockingCodes: QwenCloudReadinessBlockingCode[]
  cost: QwenCloudCostSnapshot
  uploadActive: false
}

export type QwenCloudControlRequestParseResult
  = | { ok: true, value: QwenCloudControlRequest }
    | { ok: false, errorCode: 'invalid-schema' }

export type QwenCloudControlStatusParseResult
  = | { ok: true, value: QwenCloudControlStatus }
    | { ok: false, errorCode: 'invalid-schema' }

export const electronQwenCloudControlStatus = defineInvokeEventa<
  QwenCloudControlStatus,
  QwenCloudControlRequest
>('eventa:invoke:electron:perception:qwen-cloud:status:v0.3')

export const electronQwenCloudControlValidate = defineInvokeEventa<
  QwenCloudControlStatus,
  QwenCloudControlRequest
>('eventa:invoke:electron:perception:qwen-cloud:validate:v0.3')

export const electronQwenCloudControlStop = defineInvokeEventa<
  QwenCloudControlStatus,
  QwenCloudControlRequest
>('eventa:invoke:electron:perception:qwen-cloud:stop:v0.3')

export interface QwenCloudGrantRegisterRequest {
  contractVersion: typeof QWEN_CLOUD_GRANT_VERSION
  sessionId: string
  generation: number
  grant: PerceptionConsentGrant
}

export interface QwenCloudGrantRevokeRequest {
  contractVersion: typeof QWEN_CLOUD_GRANT_VERSION
  sessionId: string
  generation: number
  grantId: string
  reason: 'user-stop' | 'permission-revoked' | 'generation-stale' | 'source-ended' | 'unmount' | 'app-exit'
}

export interface QwenCloudGrantSnapshot {
  contractVersion: typeof QWEN_CLOUD_GRANT_VERSION
  sessionId: string
  generation: number
  activeGrantIds: string[]
  updatedAt: number
}

export type QwenCloudGrantErrorCode
  = | 'invalid-schema'
    | 'stale-generation'
    | 'session-conflict'
    | 'consent-missing'

export const electronQwenCloudGrantRegister = defineInvokeEventa<
  QwenCloudGrantSnapshot,
  QwenCloudGrantRegisterRequest
>('eventa:invoke:electron:perception:qwen-cloud:grant:register:v0.3')

export const electronQwenCloudGrantRevoke = defineInvokeEventa<
  QwenCloudGrantSnapshot,
  QwenCloudGrantRevokeRequest
>('eventa:invoke:electron:perception:qwen-cloud:grant:revoke:v0.3')

export function parseQwenCloudGrantRegisterRequest(input: unknown): { ok: true, value: QwenCloudGrantRegisterRequest } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !hasExactKeys(input, ['contractVersion', 'generation', 'grant', 'sessionId'])
    || input.contractVersion !== QWEN_CLOUD_GRANT_VERSION
    || !isIdentifier(input.sessionId)
    || !isPositiveGeneration(input.generation)
    || !isQwenCloudGrant(input.grant)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as QwenCloudGrantRegisterRequest }
}

export function parseQwenCloudGrantRevokeRequest(input: unknown): { ok: true, value: QwenCloudGrantRevokeRequest } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !hasExactKeys(input, ['contractVersion', 'generation', 'grantId', 'reason', 'sessionId'])
    || input.contractVersion !== QWEN_CLOUD_GRANT_VERSION
    || !isIdentifier(input.sessionId)
    || !isPositiveGeneration(input.generation)
    || !isIdentifier(input.grantId)
    || !['user-stop', 'permission-revoked', 'generation-stale', 'source-ended', 'unmount', 'app-exit'].includes(String(input.reason))) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as QwenCloudGrantRevokeRequest }
}

export function parseQwenCloudGrantSnapshot(input: unknown): { ok: true, value: QwenCloudGrantSnapshot } | { ok: false, errorCode: 'invalid-schema' } {
  if (!isRecord(input) || !hasExactKeys(input, ['activeGrantIds', 'contractVersion', 'generation', 'sessionId', 'updatedAt'])
    || input.contractVersion !== QWEN_CLOUD_GRANT_VERSION
    || !isIdentifier(input.sessionId)
    || !isPositiveGeneration(input.generation)
    || !Array.isArray(input.activeGrantIds)
    || input.activeGrantIds.length > 4
    || new Set(input.activeGrantIds).size !== input.activeGrantIds.length
    || !input.activeGrantIds.every(isIdentifier)
    || !isTimestamp(input.updatedAt)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as QwenCloudGrantSnapshot }
}

export function parseQwenCloudControlRequest(input: unknown): QwenCloudControlRequestParseResult {
  if (!isRecord(input) || !hasExactKeys(input, ['contractVersion', 'requestId'])
    || input.contractVersion !== QWEN_CLOUD_CONTROL_VERSION
    || !isIdentifier(input.requestId)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: { contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId: input.requestId } }
}

export function parseQwenCloudControlStatus(input: unknown): QwenCloudControlStatusParseResult {
  if (!isRecord(input) || !hasExactKeys(input, [
    'apiKeyConfigured',
    'blockingCodes',
    'cameraAutomaticEscalation',
    'cameraModelId',
    'contractVersion',
    'cost',
    'costLedgerAvailable',
    'endpointRegionId',
    'localRetention',
    'modelAvailabilityVerified',
    'outputMode',
    'proactiveReactions',
    'providerClientAvailable',
    'providerId',
    'providerRetention',
    'providerRetentionVerified',
    'regionId',
    'requestId',
    'responseControl',
    'screenEscalationModelId',
    'screenResidentModelId',
    'state',
    'uploadActive',
    'workspaceConfigured',
  ])) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  if (input.contractVersion !== QWEN_CLOUD_CONTROL_VERSION
    || !isIdentifier(input.requestId)
    || !['blocked', 'ready', 'stopped', 'failed'].includes(String(input.state))
    || input.providerId !== QWEN_CLOUD_PROVIDER_ID
    || input.regionId !== QWEN_CLOUD_REGION_ID
    || input.endpointRegionId !== QWEN_CLOUD_ENDPOINT_REGION_ID
    || input.screenResidentModelId !== QWEN_FLASH_REALTIME_MODEL_ID
    || input.screenEscalationModelId !== QWEN_PLUS_REALTIME_MODEL_ID
    || input.cameraModelId !== QWEN_FLASH_REALTIME_MODEL_ID
    || input.cameraAutomaticEscalation !== false
    || input.responseControl !== 'manual'
    || input.outputMode !== 'text-encoded-objective-json'
    || input.localRetention !== 'none'
    || input.providerRetention !== 'shortest-available-no-training'
    || input.proactiveReactions !== false
    || !isBoolean(input.workspaceConfigured)
    || !isBoolean(input.apiKeyConfigured)
    || !isBoolean(input.providerRetentionVerified)
    || !isBoolean(input.modelAvailabilityVerified)
    || !isBoolean(input.providerClientAvailable)
    || !isBoolean(input.costLedgerAvailable)
    || input.uploadActive !== false
    || !isBlockingCodes(input.blockingCodes)
    || !isCostSnapshot(input.cost)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  if ((input.state === 'ready' && input.blockingCodes.length > 0)
    || (input.state === 'blocked' && input.blockingCodes.length === 0)) {
    return { ok: false, errorCode: 'invalid-schema' }
  }
  return { ok: true, value: input as unknown as QwenCloudControlStatus }
}

export function createQwenCloudControlStatus(input: {
  requestId: string
  state: QwenCloudControlStatus['state']
  workspaceConfigured: boolean
  apiKeyConfigured: boolean
  providerRetentionVerified: boolean
  modelAvailabilityVerified: boolean
  providerClientAvailable: boolean
  costLedgerAvailable: boolean
  blockingCodes: QwenCloudReadinessBlockingCode[]
  cost: QwenCloudCostSnapshot
}): QwenCloudControlStatus {
  return {
    contractVersion: QWEN_CLOUD_CONTROL_VERSION,
    requestId: input.requestId,
    state: input.state,
    providerId: QWEN_CLOUD_PROVIDER_ID,
    regionId: QWEN_CLOUD_REGION_ID,
    endpointRegionId: QWEN_CLOUD_ENDPOINT_REGION_ID,
    screenResidentModelId: approvedQwenCloudPerceptionPolicy.screen.residentModelId,
    screenEscalationModelId: approvedQwenCloudPerceptionPolicy.screen.escalationModelId,
    cameraModelId: approvedQwenCloudPerceptionPolicy.camera.modelId,
    cameraAutomaticEscalation: false,
    responseControl: 'manual',
    outputMode: 'text-encoded-objective-json',
    localRetention: 'none',
    providerRetention: 'shortest-available-no-training',
    proactiveReactions: false,
    workspaceConfigured: input.workspaceConfigured,
    apiKeyConfigured: input.apiKeyConfigured,
    providerRetentionVerified: input.providerRetentionVerified,
    modelAvailabilityVerified: input.modelAvailabilityVerified,
    providerClientAvailable: input.providerClientAvailable,
    costLedgerAvailable: input.costLedgerAvailable,
    blockingCodes: [...input.blockingCodes],
    cost: { ...input.cost },
    uploadActive: false,
  }
}

function isCostSnapshot(input: unknown): input is QwenCloudCostSnapshot {
  return isRecord(input)
    && hasExactKeys(input, ['costBoundaryId', 'currency', 'dayRemaining', 'daySpent', 'monthRemaining', 'monthSpent', 'sessionRemaining', 'sessionSpent'])
    && input.costBoundaryId === QWEN_CLOUD_COST_BOUNDARY_ID
    && input.currency === 'CNY'
    && ['dayRemaining', 'daySpent', 'monthRemaining', 'monthSpent', 'sessionRemaining', 'sessionSpent'].every(key => isFiniteNonNegative(input[key]))
}

function isBlockingCodes(input: unknown): input is QwenCloudReadinessBlockingCode[] {
  const allowed = new Set<QwenCloudReadinessBlockingCode>([
    'workspace-missing',
    'api-key-missing',
    'provider-retention-unverified',
    'model-availability-unverified',
    'provider-client-unavailable',
    'cost-ledger-unavailable',
  ])
  return Array.isArray(input) && input.length <= allowed.size && new Set(input).size === input.length && input.every(code => allowed.has(code))
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveGeneration(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isQwenCloudGrant(input: unknown): input is PerceptionConsentGrant {
  if (!isRecord(input) || !hasExactKeys(input, [
    'allowedFactCategories',
    'allowedModalities',
    'cloudModelId',
    'cloudProviderId',
    'contractVersion',
    'costBoundaryId',
    'grantId',
    'grantedAt',
    'processingMode',
    'regionId',
    'showPersistentIndicator',
    'sourceId',
    'sourceKind',
  ])) {
    return false
  }
  const modalities = input.allowedModalities
  const categories = input.allowedFactCategories
  const modelId = input.cloudModelId
  return input.contractVersion === 'perception/v0.3'
    && isIdentifier(input.grantId)
    && ['screen', 'camera'].includes(String(input.sourceKind))
    && isIdentifier(input.sourceId)
    && ['cloud-approved', 'mixed'].includes(String(input.processingMode))
    && Array.isArray(modalities)
    && modalities.length === 1
    && ['screen-frames', 'camera-frames', 'microphone-audio'].includes(String(modalities[0]))
    && (modalities[0] !== 'screen-frames' || input.sourceKind === 'screen')
    && (modalities[0] !== 'camera-frames' || input.sourceKind === 'camera')
    && Array.isArray(categories)
    && categories.length >= 1
    && categories.length <= 32
    && categories.every(isIdentifier)
    && input.cloudProviderId === QWEN_CLOUD_PROVIDER_ID
    && (modelId === QWEN_FLASH_REALTIME_MODEL_ID || (input.sourceKind === 'screen' && modelId === QWEN_PLUS_REALTIME_MODEL_ID))
    && input.regionId === QWEN_CLOUD_REGION_ID
    && input.costBoundaryId === QWEN_CLOUD_COST_BOUNDARY_ID
    && isTimestamp(input.grantedAt)
    && input.showPersistentIndicator === true
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][\w.:-]{0,159}$/iu.test(value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
