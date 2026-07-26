import type { QwenCloudControlStatus } from '../../../../shared/eventa/perception-cloud'
import type { QwenCloudCostLedgerPort } from './qwen-cloud-cost-ledger-store'
import type { QwenRealtimeSocketFactory } from './qwen-realtime-protocol'

import process from 'node:process'

import {
  evaluateQwenCloudReadiness,
  QwenCloudCostLedger,
} from '@proj-airi/stage-ui/domains/perception'

import { createQwenCloudControlStatus } from '../../../../shared/eventa/perception-cloud'

export interface QwenCloudControlManagerOptions {
  getWorkspaceId?: () => string | undefined
  getApiKey?: () => string | undefined
  getProviderRetentionVerified?: () => boolean
  getModelAvailabilityVerified?: () => boolean
  providerClientAvailable?: boolean
  socketFactory?: QwenRealtimeSocketFactory
  costLedger?: QwenCloudCostLedgerPort
  stopActiveSessions?: () => void | Promise<void>
}

export class QwenCloudControlManager {
  readonly #getWorkspaceId: () => string | undefined
  readonly #getApiKey: () => string | undefined
  readonly #getProviderRetentionVerified: () => boolean
  readonly #getModelAvailabilityVerified: () => boolean
  readonly #providerClientAvailable: boolean
  readonly #costLedger: QwenCloudCostLedgerPort
  readonly #stopActiveSessions?: () => void | Promise<void>
  #stopped = false

  constructor(options: QwenCloudControlManagerOptions = {}) {
    this.#getWorkspaceId = options.getWorkspaceId ?? (() => process.env.AIRI_QWEN_WORKSPACE_ID)
    this.#getApiKey = options.getApiKey ?? (() => process.env.DASHSCOPE_API_KEY)
    this.#getProviderRetentionVerified = options.getProviderRetentionVerified ?? (() => process.env.AIRI_QWEN_RETENTION_VERIFIED === 'true')
    this.#getModelAvailabilityVerified = options.getModelAvailabilityVerified ?? (() => process.env.AIRI_QWEN_MODELS_VERIFIED === 'true')
    this.#providerClientAvailable = options.socketFactory !== undefined || options.providerClientAvailable === true
    this.#costLedger = options.costLedger ?? new QwenCloudCostLedger()
    this.#stopActiveSessions = options.stopActiveSessions
  }

  status(requestId: string): QwenCloudControlStatus {
    const readiness = evaluateQwenCloudReadiness({
      workspaceConfigured: isWorkspaceConfigured(this.#getWorkspaceId()),
      apiKeyConfigured: isApiKeyConfigured(this.#getApiKey()),
      providerRetentionVerified: this.#getProviderRetentionVerified() === true,
      modelAvailabilityVerified: this.#getModelAvailabilityVerified() === true,
      providerClientAvailable: this.#providerClientAvailable,
      costLedgerAvailable: this.#costLedger.isAvailable?.() ?? true,
    })
    return createQwenCloudControlStatus({
      requestId,
      ...readiness,
      state: this.#stopped ? 'stopped' : readiness.state,
      cost: this.#costLedger.snapshot('cloud-control'),
      costLedgerAvailable: this.#costLedger.isAvailable?.() ?? true,
    })
  }

  validate(requestId: string): QwenCloudControlStatus {
    this.#stopped = false
    return this.status(requestId)
  }

  async stop(requestId: string): Promise<QwenCloudControlStatus> {
    this.#stopped = true
    await this.#stopActiveSessions?.()
    return this.status(requestId)
  }
}

export function setupQwenCloudControlManager(options: QwenCloudControlManagerOptions = {}): QwenCloudControlManager {
  return new QwenCloudControlManager(options)
}

function isWorkspaceConfigured(value: string | undefined): boolean {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/u.test(value)
}

function isApiKeyConfigured(value: string | undefined): boolean {
  return typeof value === 'string' && value.length >= 8 && value.length <= 512 && !containsWhitespaceOrControl(value)
}

function containsWhitespaceOrControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x20 || codePoint === 0x7F || character.trim().length === 0)
      return true
  }
  return false
}
