export const QWEN_CLOUD_POLICY_VERSION = 'perception-cloud-policy/v0.3' as const
export const QWEN_CLOUD_PROVIDER_ID = 'aliyun-bailian' as const
export const QWEN_CLOUD_REGION_ID = 'cn-mainland' as const
export const QWEN_CLOUD_ENDPOINT_REGION_ID = 'cn-beijing' as const
export const QWEN_FLASH_REALTIME_MODEL_ID = 'qwen3.5-omni-flash-realtime' as const
export const QWEN_PLUS_REALTIME_MODEL_ID = 'qwen3.5-omni-plus-realtime' as const
export const QWEN_CLOUD_COST_BOUNDARY_ID = 'qwen-cloud-cny-5-10-50-v1' as const
export const QWEN_CLOUD_PRICE_PROFILE_ID = 'qwen-realtime-cn-2026-07-17' as const

export const qwenScreenEscalationReasons = [
  'flash-low-confidence',
  'consecutive-conflict',
  'complex-multi-window-relation',
  'temporal-process-reasoning',
  'user-requested-process-analysis',
  'tool-relevance-uncertain',
] as const

export type QwenScreenEscalationReason = typeof qwenScreenEscalationReasons[number]
export type QwenRealtimeCloudModelId = typeof QWEN_FLASH_REALTIME_MODEL_ID | typeof QWEN_PLUS_REALTIME_MODEL_ID

export interface QwenCloudBudgetLimits {
  currency: 'CNY'
  session: number
  day: number
  month: number
}

export interface QwenCloudPerceptionPolicy {
  contractVersion: typeof QWEN_CLOUD_POLICY_VERSION
  providerId: typeof QWEN_CLOUD_PROVIDER_ID
  regionId: typeof QWEN_CLOUD_REGION_ID
  endpointRegionId: typeof QWEN_CLOUD_ENDPOINT_REGION_ID
  consent: {
    screenFrames: 'per-session'
    cameraFrames: 'per-session'
    microphoneAudio: 'per-session'
  }
  screen: {
    residentModelId: typeof QWEN_FLASH_REALTIME_MODEL_ID
    escalationModelId: typeof QWEN_PLUS_REALTIME_MODEL_ID
    automaticEscalation: true
    escalationReasons: QwenScreenEscalationReason[]
  }
  camera: {
    modelId: typeof QWEN_FLASH_REALTIME_MODEL_ID
    automaticEscalation: false
  }
  outputMode: 'text-encoded-objective-json'
  responseControl: 'manual'
  failureMode: 'stop-no-fallback'
  localRetention: 'none'
  providerRetention: 'shortest-available-no-training'
  proactiveReactions: false
  costBoundaryId: typeof QWEN_CLOUD_COST_BOUNDARY_ID
  budgets: QwenCloudBudgetLimits
}

export const approvedQwenCloudPerceptionPolicy: Readonly<QwenCloudPerceptionPolicy> = Object.freeze({
  contractVersion: QWEN_CLOUD_POLICY_VERSION,
  providerId: QWEN_CLOUD_PROVIDER_ID,
  regionId: QWEN_CLOUD_REGION_ID,
  endpointRegionId: QWEN_CLOUD_ENDPOINT_REGION_ID,
  consent: Object.freeze({
    screenFrames: 'per-session',
    cameraFrames: 'per-session',
    microphoneAudio: 'per-session',
  }),
  screen: Object.freeze({
    residentModelId: QWEN_FLASH_REALTIME_MODEL_ID,
    escalationModelId: QWEN_PLUS_REALTIME_MODEL_ID,
    automaticEscalation: true,
    escalationReasons: Object.freeze([...qwenScreenEscalationReasons]) as unknown as QwenScreenEscalationReason[],
  }),
  camera: Object.freeze({
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    automaticEscalation: false,
  }),
  outputMode: 'text-encoded-objective-json',
  responseControl: 'manual',
  failureMode: 'stop-no-fallback',
  localRetention: 'none',
  providerRetention: 'shortest-available-no-training',
  proactiveReactions: false,
  costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
  budgets: Object.freeze({
    currency: 'CNY',
    session: 5,
    day: 10,
    month: 50,
  }),
})

export type QwenCloudPolicyParseResult
  = | { success: true, data: QwenCloudPerceptionPolicy }
    | { success: false, errorCode: 'cloud-policy-invalid' }

export function parseQwenCloudPerceptionPolicy(input: unknown): QwenCloudPolicyParseResult {
  if (!isRecord(input) || !hasExactKeys(input, [
    'budgets',
    'camera',
    'consent',
    'contractVersion',
    'costBoundaryId',
    'endpointRegionId',
    'failureMode',
    'localRetention',
    'outputMode',
    'proactiveReactions',
    'providerId',
    'providerRetention',
    'regionId',
    'responseControl',
    'screen',
  ])) {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  if (!isRecord(input.consent) || !hasExactKeys(input.consent, ['cameraFrames', 'microphoneAudio', 'screenFrames'])
    || input.consent.screenFrames !== 'per-session'
    || input.consent.cameraFrames !== 'per-session'
    || input.consent.microphoneAudio !== 'per-session') {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  if (!isRecord(input.screen) || !hasExactKeys(input.screen, ['automaticEscalation', 'escalationModelId', 'escalationReasons', 'residentModelId'])
    || input.screen.residentModelId !== QWEN_FLASH_REALTIME_MODEL_ID
    || input.screen.escalationModelId !== QWEN_PLUS_REALTIME_MODEL_ID
    || input.screen.automaticEscalation !== true
    || !isExactEscalationReasonSet(input.screen.escalationReasons)) {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  if (!isRecord(input.camera) || !hasExactKeys(input.camera, ['automaticEscalation', 'modelId'])
    || input.camera.modelId !== QWEN_FLASH_REALTIME_MODEL_ID
    || input.camera.automaticEscalation !== false) {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  if (!isRecord(input.budgets) || !hasExactKeys(input.budgets, ['currency', 'day', 'month', 'session'])
    || input.budgets.currency !== 'CNY'
    || input.budgets.session !== 5
    || input.budgets.day !== 10
    || input.budgets.month !== 50) {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  if (input.contractVersion !== QWEN_CLOUD_POLICY_VERSION
    || input.providerId !== QWEN_CLOUD_PROVIDER_ID
    || input.regionId !== QWEN_CLOUD_REGION_ID
    || input.endpointRegionId !== QWEN_CLOUD_ENDPOINT_REGION_ID
    || input.outputMode !== 'text-encoded-objective-json'
    || input.responseControl !== 'manual'
    || input.failureMode !== 'stop-no-fallback'
    || input.localRetention !== 'none'
    || input.providerRetention !== 'shortest-available-no-training'
    || input.proactiveReactions !== false
    || input.costBoundaryId !== QWEN_CLOUD_COST_BOUNDARY_ID) {
    return { success: false, errorCode: 'cloud-policy-invalid' }
  }

  return { success: true, data: clonePolicy(input as unknown as QwenCloudPerceptionPolicy) }
}

export type QwenCloudReadinessBlockingCode
  = | 'workspace-missing'
    | 'api-key-missing'
    | 'provider-retention-unverified'
    | 'model-availability-unverified'
    | 'provider-client-unavailable'
    | 'cost-ledger-unavailable'

export interface QwenCloudReadinessEvidence {
  workspaceConfigured: boolean
  apiKeyConfigured: boolean
  providerRetentionVerified: boolean
  modelAvailabilityVerified: boolean
  providerClientAvailable: boolean
  costLedgerAvailable?: boolean
}

export interface QwenCloudReadiness {
  state: 'blocked' | 'ready'
  blockingCodes: QwenCloudReadinessBlockingCode[]
  workspaceConfigured: boolean
  apiKeyConfigured: boolean
  providerRetentionVerified: boolean
  modelAvailabilityVerified: boolean
  providerClientAvailable: boolean
}

export function evaluateQwenCloudReadiness(evidence: QwenCloudReadinessEvidence): QwenCloudReadiness {
  const blockingCodes: QwenCloudReadinessBlockingCode[] = []
  if (!evidence.workspaceConfigured)
    blockingCodes.push('workspace-missing')
  if (!evidence.apiKeyConfigured)
    blockingCodes.push('api-key-missing')
  if (!evidence.providerRetentionVerified)
    blockingCodes.push('provider-retention-unverified')
  if (!evidence.modelAvailabilityVerified)
    blockingCodes.push('model-availability-unverified')
  if (!evidence.providerClientAvailable)
    blockingCodes.push('provider-client-unavailable')
  if (evidence.costLedgerAvailable === false)
    blockingCodes.push('cost-ledger-unavailable')
  return {
    state: blockingCodes.length === 0 ? 'ready' : 'blocked',
    blockingCodes,
    ...evidence,
  }
}

export interface QwenRealtimeUsage {
  inputTextImageTokens: number
  inputAudioTokens: number
  outputTextTokens: number
  outputAudioTokens?: number
}

export type QwenCostEstimateResult
  = | { ok: true, amountMicros: number, amountCny: number, priceProfileId: typeof QWEN_CLOUD_PRICE_PROFILE_ID }
    | { ok: false, errorCode: 'cloud-usage-invalid' | 'cloud-output-audio-forbidden' }

const qwenPriceTenthsCnyPerMillion: Record<QwenRealtimeCloudModelId, {
  inputTextImage: number
  inputAudio: number
  outputText: number
}> = {
  [QWEN_FLASH_REALTIME_MODEL_ID]: { inputTextImage: 33, inputAudio: 270, outputText: 200 },
  [QWEN_PLUS_REALTIME_MODEL_ID]: { inputTextImage: 100, inputAudio: 800, outputText: 600 },
}

export function estimateQwenRealtimeCost(modelId: QwenRealtimeCloudModelId, usage: QwenRealtimeUsage): QwenCostEstimateResult {
  if (!isTokenCount(usage.inputTextImageTokens) || !isTokenCount(usage.inputAudioTokens) || !isTokenCount(usage.outputTextTokens)
    || (usage.outputAudioTokens !== undefined && !isTokenCount(usage.outputAudioTokens))) {
    return { ok: false, errorCode: 'cloud-usage-invalid' }
  }
  if ((usage.outputAudioTokens ?? 0) !== 0)
    return { ok: false, errorCode: 'cloud-output-audio-forbidden' }

  const rates = qwenPriceTenthsCnyPerMillion[modelId]
  const amountMicros = Math.ceil((
    usage.inputTextImageTokens * rates.inputTextImage
    + usage.inputAudioTokens * rates.inputAudio
    + usage.outputTextTokens * rates.outputText
  ) / 10)
  return {
    ok: true,
    amountMicros,
    amountCny: amountMicros / 1_000_000,
    priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
  }
}

export interface QwenCloudCostEntry {
  sessionId: string
  modelId: QwenRealtimeCloudModelId
  incurredAt: number
  amountMicros: number
  priceProfileId: typeof QWEN_CLOUD_PRICE_PROFILE_ID
}

export interface QwenCloudCostSnapshot {
  costBoundaryId: typeof QWEN_CLOUD_COST_BOUNDARY_ID
  currency: 'CNY'
  sessionSpent: number
  daySpent: number
  monthSpent: number
  sessionRemaining: number
  dayRemaining: number
  monthRemaining: number
}

export type QwenCloudCostAuthorization
  = | { allowed: true, snapshot: QwenCloudCostSnapshot }
    | { allowed: false, boundary: 'session' | 'day' | 'month', snapshot: QwenCloudCostSnapshot }

export class QwenCloudCostLedger {
  readonly #now: () => number
  readonly #entries: QwenCloudCostEntry[] = []

  constructor(options: { now?: () => number, restoredEntries?: QwenCloudCostEntry[] } = {}) {
    this.#now = options.now ?? (() => Date.now())
    for (const entry of options.restoredEntries ?? []) {
      if (isValidCostEntry(entry))
        this.#entries.push({ ...entry })
    }
  }

  authorize(sessionId: string, estimatedAmountMicros: number): QwenCloudCostAuthorization {
    if (!isIdentifier(sessionId) || !Number.isSafeInteger(estimatedAmountMicros) || estimatedAmountMicros < 0)
      throw new Error('qwen_cloud_cost_authorization_invalid')
    const current = this.snapshot(sessionId)
    const amountCny = estimatedAmountMicros / 1_000_000
    if (current.sessionSpent + amountCny > approvedQwenCloudPerceptionPolicy.budgets.session)
      return { allowed: false, boundary: 'session', snapshot: current }
    if (current.daySpent + amountCny > approvedQwenCloudPerceptionPolicy.budgets.day)
      return { allowed: false, boundary: 'day', snapshot: current }
    if (current.monthSpent + amountCny > approvedQwenCloudPerceptionPolicy.budgets.month)
      return { allowed: false, boundary: 'month', snapshot: current }
    return { allowed: true, snapshot: current }
  }

  record(entry: QwenCloudCostEntry): QwenCloudCostAuthorization {
    if (!isValidCostEntry(entry))
      throw new Error('qwen_cloud_cost_entry_invalid')
    const authorization = this.authorize(entry.sessionId, entry.amountMicros)
    if (!authorization.allowed)
      return authorization
    this.#entries.push({ ...entry })
    return { allowed: true, snapshot: this.snapshot(entry.sessionId) }
  }

  recordIncurred(entry: QwenCloudCostEntry): QwenCloudCostAuthorization {
    if (!isValidCostEntry(entry))
      throw new Error('qwen_cloud_cost_entry_invalid')
    this.#entries.push({ ...entry })
    const snapshot = this.snapshot(entry.sessionId)
    if (snapshot.sessionSpent > approvedQwenCloudPerceptionPolicy.budgets.session)
      return { allowed: false, boundary: 'session', snapshot }
    if (snapshot.daySpent > approvedQwenCloudPerceptionPolicy.budgets.day)
      return { allowed: false, boundary: 'day', snapshot }
    if (snapshot.monthSpent > approvedQwenCloudPerceptionPolicy.budgets.month)
      return { allowed: false, boundary: 'month', snapshot }
    return { allowed: true, snapshot }
  }

  snapshot(sessionId: string): QwenCloudCostSnapshot {
    if (!isIdentifier(sessionId))
      throw new Error('qwen_cloud_cost_session_invalid')
    const now = this.#now()
    const day = chinaDayBucket(now)
    const month = day.slice(0, 7)
    let sessionMicros = 0
    let dayMicros = 0
    let monthMicros = 0
    for (const entry of this.#entries) {
      const entryDay = chinaDayBucket(entry.incurredAt)
      if (entry.sessionId === sessionId)
        sessionMicros += entry.amountMicros
      if (entryDay === day)
        dayMicros += entry.amountMicros
      if (entryDay.startsWith(month))
        monthMicros += entry.amountMicros
    }
    const sessionSpent = sessionMicros / 1_000_000
    const daySpent = dayMicros / 1_000_000
    const monthSpent = monthMicros / 1_000_000
    return {
      costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
      currency: 'CNY',
      sessionSpent,
      daySpent,
      monthSpent,
      sessionRemaining: Math.max(0, approvedQwenCloudPerceptionPolicy.budgets.session - sessionSpent),
      dayRemaining: Math.max(0, approvedQwenCloudPerceptionPolicy.budgets.day - daySpent),
      monthRemaining: Math.max(0, approvedQwenCloudPerceptionPolicy.budgets.month - monthSpent),
    }
  }

  exportEntries(): QwenCloudCostEntry[] {
    return this.#entries.map(entry => ({ ...entry }))
  }
}

export function parseQwenCloudCostEntries(input: unknown): { ok: true, entries: QwenCloudCostEntry[] } | { ok: false, errorCode: 'cloud-cost-entries-invalid' } {
  if (!Array.isArray(input) || input.length > 4_096 || !input.every(isValidCostEntry))
    return { ok: false, errorCode: 'cloud-cost-entries-invalid' }
  return { ok: true, entries: input.map(entry => ({ ...entry })) }
}

function clonePolicy(policy: QwenCloudPerceptionPolicy): QwenCloudPerceptionPolicy {
  return {
    ...policy,
    consent: { ...policy.consent },
    screen: { ...policy.screen, escalationReasons: [...policy.screen.escalationReasons] },
    camera: { ...policy.camera },
    budgets: { ...policy.budgets },
  }
}

function isExactEscalationReasonSet(value: unknown): value is QwenScreenEscalationReason[] {
  return Array.isArray(value)
    && value.length === qwenScreenEscalationReasons.length
    && new Set(value).size === qwenScreenEscalationReasons.length
    && value.every(reason => typeof reason === 'string' && qwenScreenEscalationReasons.includes(reason as QwenScreenEscalationReason))
}

function isValidCostEntry(entry: unknown): entry is QwenCloudCostEntry {
  return isRecord(entry)
    && hasExactKeys(entry, ['amountMicros', 'incurredAt', 'modelId', 'priceProfileId', 'sessionId'])
    && isIdentifier(entry.sessionId)
    && (entry.modelId === QWEN_FLASH_REALTIME_MODEL_ID || entry.modelId === QWEN_PLUS_REALTIME_MODEL_ID)
    && typeof entry.incurredAt === 'number'
    && Number.isSafeInteger(entry.incurredAt)
    && entry.incurredAt >= 0
    && typeof entry.amountMicros === 'number'
    && Number.isSafeInteger(entry.amountMicros)
    && entry.amountMicros >= 0
    && entry.priceProfileId === QWEN_CLOUD_PRICE_PROFILE_ID
}

function chinaDayBucket(timestamp: number): string {
  return new Date(timestamp + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
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
