import { createContext, defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { evaluateQwenCloudReadiness, QwenCloudCostLedger } from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it } from 'vitest'

import {
  createQwenCloudControlStatus,
  electronQwenCloudControlStatus,
  parseQwenCloudControlRequest,
  parseQwenCloudControlStatus,
  QWEN_CLOUD_CONTROL_VERSION,
} from './perception-cloud'

describe('qwen cloud Eventa control boundary', () => {
  it('keeps invoke generics response-first and validates both boundaries', async () => {
    const context = createContext()
    defineInvokeHandler(context, electronQwenCloudControlStatus, (input) => {
      const parsed = parseQwenCloudControlRequest(input)
      if (!parsed.ok)
        throw new Error(parsed.errorCode)
      const readiness = evaluateQwenCloudReadiness({
        workspaceConfigured: false,
        apiKeyConfigured: false,
        providerRetentionVerified: false,
        modelAvailabilityVerified: false,
        providerClientAvailable: false,
      })
      return createQwenCloudControlStatus({
        requestId: parsed.value.requestId,
        ...readiness,
        costLedgerAvailable: true,
        cost: new QwenCloudCostLedger().snapshot('cloud-control'),
      })
    })

    const invoke = defineInvoke(context, electronQwenCloudControlStatus)
    const response = await invoke({ contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId: 'request-1' })
    expect(parseQwenCloudControlStatus(response).ok).toBe(true)
    expect(response).toMatchObject({
      contractVersion: 'perception-cloud-control/v0.4',
      providerPrivacyProfileId: 'qwen-realtime-cn-support-2026-07-27',
      providerRetention: 'service-logs-one-month',
      providerDataUse: 'not-used-for-training-improvement-evaluation-or-human-review',
      providerDataBoundary: 'cn-mainland-no-cross-region-or-cross-border',
      sessionContextRetention: 'cleared-on-disconnect',
    })
    expect(response.uploadActive).toBe(false)
    expect(JSON.stringify(response)).not.toMatch(/workspace(Id|Value)|"apiKey"|secret(Value)?|Bearer/iu)
  })

  it('rejects extra fields and inconsistent ready state', () => {
    expect(parseQwenCloudControlRequest({
      contractVersion: QWEN_CLOUD_CONTROL_VERSION,
      requestId: 'request-1',
      apiKey: 'forbidden',
    })).toEqual({ ok: false, errorCode: 'invalid-schema' })

    const status = createQwenCloudControlStatus({
      requestId: 'request-2',
      state: 'ready',
      workspaceConfigured: false,
      apiKeyConfigured: false,
      providerRetentionVerified: false,
      modelAvailabilityVerified: false,
      providerClientAvailable: false,
      costLedgerAvailable: true,
      blockingCodes: ['workspace-missing'],
      cost: new QwenCloudCostLedger().snapshot('cloud-control'),
    })
    expect(parseQwenCloudControlStatus(status)).toEqual({ ok: false, errorCode: 'invalid-schema' })
  })
})
