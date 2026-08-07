import type { ExtractInvokeRequestOptions } from '@moeru/eventa'
import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import { createContext, defineInvoke } from '@moeru/eventa'
import { QWEN_CLOUD_PRIVACY_PROFILE_ID } from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it, vi } from 'vitest'

import {
  electronQwenCloudControlStatus,
  electronQwenCloudControlStop,
  QWEN_CLOUD_CONTROL_VERSION,
} from '../../../../shared/eventa/perception-cloud'
import { QwenCloudControlManager } from './qwen-cloud-control-manager'
import { createQwenCloudControlService } from './qwen-cloud-control-service'

type ElectronMainContext = ReturnType<typeof createElectronContext>['context']

/** `webContents.id` of the window the service registration under test belongs to. */
const OWNING_WEB_CONTENTS_ID = 11

// NOTICE:
// The in-memory eventa context is what the electron main adapter wraps, so it is
// runtime-compatible and only the declared option types differ.
// Source: `node_modules/@moeru/eventa/dist/adapters/electron/main.mjs` calls the core
// `createContext()` and returns it as `{ context, dispose }`.
// Removal condition: drop once `@moeru/eventa` ships a test double for its electron context.
function createTestContext(): ElectronMainContext {
  return createContext() as unknown as ElectronMainContext
}

// NOTICE:
// The service now verifies `options.raw.ipcMainEvent.sender.id`, which only a real `ipcMain`
// message carries, so unit tests have to supply it. Only that one field is read.
// Root cause of the cast: `raw.ipcMainEvent` is declared as electron's full `IpcMainEvent`
// (whose `sender` is a `WebContents`), which cannot be constructed outside electron main.
// Source: `node_modules/@moeru/eventa/dist/adapters/electron/main.mjs:48` emits inbound
// messages with `{ raw: { ipcMainEvent, event } }`.
// Removal condition: drop once `@moeru/eventa` ships a test double for its electron context.
function fromWindow(webContentsId: number): ExtractInvokeRequestOptions<ElectronMainContext> {
  return { raw: { ipcMainEvent: { sender: { id: webContentsId } } } } as unknown as ExtractInvokeRequestOptions<ElectronMainContext>
}

describe('qwen cloud control manager', () => {
  it('accepts the Electron main env-prefixed local privacy evidence', () => {
    vi.stubEnv('MAIN_VITE_AIRI_QWEN_RETENTION_VERIFIED', 'true')
    vi.stubEnv('MAIN_VITE_AIRI_QWEN_PRIVACY_PROFILE_ID', QWEN_CLOUD_PRIVACY_PROFILE_ID)
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'secret-key-value',
      getModelAvailabilityVerified: () => true,
      providerClientAvailable: true,
    })

    expect(manager.status('request-main-env')).toMatchObject({
      state: 'ready',
      providerRetentionVerified: true,
    })
    vi.unstubAllEnvs()
  })

  it('binds the retention verification flag to the dated official privacy profile', () => {
    vi.stubEnv('AIRI_QWEN_RETENTION_VERIFIED', 'true')
    vi.stubEnv('AIRI_QWEN_PRIVACY_PROFILE_ID', 'outdated-profile')
    const createManager = () => new QwenCloudControlManager({
      getWorkspaceId: () => 'workspace-1',
      getApiKey: () => 'secret-key-value',
      getModelAvailabilityVerified: () => true,
      providerClientAvailable: true,
    })

    expect(createManager().status('request-outdated')).toMatchObject({
      state: 'blocked',
      providerRetentionVerified: false,
      blockingCodes: expect.arrayContaining(['provider-retention-unverified']),
    })

    vi.stubEnv('AIRI_QWEN_PRIVACY_PROFILE_ID', QWEN_CLOUD_PRIVACY_PROFILE_ID)
    expect(createManager().status('request-current')).toMatchObject({
      state: 'ready',
      providerRetentionVerified: true,
    })
    vi.unstubAllEnvs()
  })

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
    const context = createTestContext()
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => undefined,
      getApiKey: () => undefined,
    })
    createQwenCloudControlService({
      context,
      manager,
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const status = defineInvoke(context, electronQwenCloudControlStatus)
    const stop = defineInvoke(context, electronQwenCloudControlStop)
    const request = { contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId: 'request-eventa' } as const

    await expect(status(request, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ state: 'blocked', uploadActive: false })
    await expect(stop(request, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ state: 'stopped', uploadActive: false })
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  /**
   * @example
   * ```ts
   * await expect(stop(request, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(stopActiveSessions).not.toHaveBeenCalled()
   * ```
   */
  it('never stops another window sessions through a foreign control invoke', async () => {
    const context = createTestContext()
    const stopActiveSessions = vi.fn()
    const manager = new QwenCloudControlManager({
      getWorkspaceId: () => undefined,
      getApiKey: () => undefined,
      stopActiveSessions,
    })
    const mediaGateway = { stopAll: vi.fn() }
    createQwenCloudControlService({
      context,
      manager,
      mediaGateway: mediaGateway as unknown as Parameters<typeof createQwenCloudControlService>[0]['mediaGateway'],
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const stop = defineInvoke(context, electronQwenCloudControlStop)
    const request = { contractVersion: QWEN_CLOUD_CONTROL_VERSION, requestId: 'request-foreign' } as const

    await expect(stop(request, fromWindow(OWNING_WEB_CONTENTS_ID + 1))).rejects.toMatchObject({
      message: 'cross-window-invocation-rejected',
    })
    expect(mediaGateway.stopAll).toHaveBeenCalledTimes(0)
    expect(stopActiveSessions).toHaveBeenCalledTimes(0)
    expect(manager.status('request-after').state).not.toBe('stopped')
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
