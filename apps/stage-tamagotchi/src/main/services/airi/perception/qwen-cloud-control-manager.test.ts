import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  electronQwenCloudControlStatus,
  electronQwenCloudControlStop,
  QWEN_CLOUD_CONTROL_VERSION,
} from '../../../../shared/eventa/perception-cloud'
import { QwenCloudControlManager } from './qwen-cloud-control-manager'
import { createQwenCloudControlService } from './qwen-cloud-control-service'

describe('qwen cloud control manager', () => {
  it('stays blocked and inert until every external prerequisite is verified', async () => {
    const stopActiveSessions = vi.fn()
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'secret-key-value',
      getProviderRetentionVerified: () => false,
      getModelAvailabilityVerified: () => false,
      providerClientAvailable: false,
      stopActiveSessions,
    })
    const status = manager.status('request-1')
    expect(status).toMatchObject({
      state: 'blocked',
      workspaceConfigured: true,
      apiKeyConfigured: true,
      providerRetentionVerified: false,
      modelAvailabilityVerified: false,
      providerClientAvailable: false,
      uploadActive: false,
      cameraAutomaticEscalation: false,
    })
    expect(JSON.stringify(status)).not.toContain('workspace-1')
    expect(JSON.stringify(status)).not.toContain('secret-key-value')

    await manager.stop('request-2')
    expect(stopActiveSessions).toHaveBeenCalledOnce()
    expect(manager.status('request-3').state).toBe('stopped')
  })

  it('serves validated Eventa control status without transmitting secrets', async () => {
    const context = createContext()
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => undefined,
      getApiKey: () => undefined,
    })
    createQwenCloudControlService({ context: context as any, manager })
    const status = defineInvoke(context, electronQwenCloudControlStatus)
    const stop = defineInvoke(context, electronQwenCloudControlStop)
    const request = { contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId: 'request-eventa' } as const

    await expect(status(request)).resolves.toMatchObject({ state: 'blocked', uploadActive: false })
    await expect(stop(request)).resolves.toMatchObject({ state: 'stopped', uploadActive: false })
  })

  it('reports the injected production socket factory without opening a connection', () => {
    let socketCreated = false
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'secret-key-value',
      getProviderRetentionVerified: () => true,
      getModelAvailabilityVerified: () => true,
      socketFactory: () => {
        socketCreated = true
        throw new Error('must not connect during readiness checks')
      },
    })

    expect(manager.status('request-ready')).toMatchObject({
      state: 'ready',
      providerClientAvailable: true,
      uploadActive: false,
    })
    expect(socketCreated).toBe(false)
  })
})
