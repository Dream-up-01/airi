import type { ExtractInvokeRequestOptions } from '@moeru/eventa'
import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudGrantRegisterRequest } from '../../../../shared/eventa/perception-cloud'

import { createContext, defineInvoke } from '@moeru/eventa'
import {
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it, vi } from 'vitest'

import {
  electronQwenCloudGrantRegister,
  electronQwenCloudGrantRevoke,
  QWEN_CLOUD_GRANT_VERSION,
} from '../../../../shared/eventa/perception-cloud'
import { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'
import { createQwenCloudGrantService } from './qwen-cloud-grant-service'

type ElectronMainContext = ReturnType<typeof createElectronContext>['context']

/** `webContents.id` values of the two windows that both register this service. */
const MAIN_WEB_CONTENTS_ID = 11
const SETTINGS_WEB_CONTENTS_ID = 12

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

function request(grantId: string, modality: 'camera-frames' | 'microphone-audio'): QwenCloudGrantRegisterRequest {
  return {
    contractVersion: QWEN_CLOUD_GRANT_VERSION,
    sessionId: 'session:camera',
    generation: 1,
    grant: {
      contractVersion: 'perception/v0.3' as const,
      grantId,
      sourceKind: 'camera' as const,
      sourceId: 'camera:default',
      processingMode: 'mixed' as const,
      allowedModalities: [modality],
      allowedFactCategories: ['person.presence'],
      cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
      cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
      regionId: QWEN_CLOUD_REGION_ID,
      costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  }
}

describe('qwen cloud grant Eventa service', () => {
  /**
   * @example
   * ```ts
   * await expect(register(request('grant:frame', 'camera-frames'), fromWindow(11))).resolves.toMatchObject({ activeGrantIds: ['grant:frame'] })
   * ```
   */
  it('registers and revokes a grant for its own window', async () => {
    const context = createTestContext()
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    const onRevoke = vi.fn()
    createQwenCloudGrantService({
      context,
      registry,
      ownerId: `renderer:${MAIN_WEB_CONTENTS_ID}`,
      onRevoke,
      callerWebContentsId: MAIN_WEB_CONTENTS_ID,
    })
    const register = defineInvoke(context, electronQwenCloudGrantRegister)
    const revoke = defineInvoke(context, electronQwenCloudGrantRevoke)

    await expect(register(request('grant:frame', 'camera-frames'), fromWindow(MAIN_WEB_CONTENTS_ID)))
      .resolves
      .toMatchObject({ activeGrantIds: ['grant:frame'] })
    await expect(revoke({
      contractVersion: QWEN_CLOUD_GRANT_VERSION,
      sessionId: 'session:camera',
      generation: 1,
      grantId: 'grant:frame',
      reason: 'user-stop',
    }, fromWindow(MAIN_WEB_CONTENTS_ID))).resolves.toMatchObject({ activeGrantIds: [] })
    expect(onRevoke).toHaveBeenCalledWith('grant:frame')
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  //
  // ROOT CAUSE:
  //
  // Both `windows/main/rpc/index.electron.ts` and `windows/settings/rpc/index.electron.ts`
  // register this service, each with its own `ownerId` of `renderer:<own webContents.id>`.
  // eventa's electron main adapter registers its message listener with `ipcMain.on(...)`
  // (node_modules/@moeru/eventa/dist/adapters/electron/main.mjs:5), so it is process-global and
  // a single `grant/register` invoke fanned out to *both* registrations. Both handlers ran and
  // called `registry.register(input, ownerId)`, so whichever handler executed last overwrote the
  // grant's `ownerId` with its own window. When that window later closed, its
  // `clearOwner(ownerId)` + `cancelByGrant(...)` teardown revoked a grant the *other* window was
  // actively streaming with, killing a live upload. Response misrouting made it invisible:
  // responses go to `window.webContents.send(...)` (:26) — the context's bound window, not the
  // caller — and `onlySameWindow` defaults to false (:12) while only filtering delivery (:25),
  // never handler execution.
  //
  // We fixed this by routing both handlers through `defineWindowScopedInvokeHandler`, so a
  // registration only ever writes grants for invokes sent by the window it belongs to and the
  // recorded `ownerId` always matches the real caller.
  //
  // The rejection the foreign registration now raises never reaches the real caller: it is
  // emitted on that window's own context and delivered to its own bound renderer (:26), where no
  // pending invoke matches the id, so it is dropped. The test observes both contexts directly
  // because it holds them both; production callers only ever see their own window's response.
  /**
   * @example
   * ```ts
   * await expect(registerFromSettings(payload, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual(['grant:frame'])
   * ```
   */
  it('keeps the grant owner of the calling window when both windows registered the service', async () => {
    // Each window gets its own eventa context, exactly as `createContext(ipcMain, window)` does
    // per window in production. The process-global `ipcMain` listener then delivers one
    // renderer message into *both* contexts, which is what the two invokes below model: the same
    // payload, carrying the main window's sender id, arriving at both registrations.
    const mainContext = createTestContext()
    const settingsContext = createTestContext()
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    const mainRevoked: string[] = []
    const settingsRevoked: string[] = []

    createQwenCloudGrantService({
      context: mainContext,
      registry,
      ownerId: `renderer:${MAIN_WEB_CONTENTS_ID}`,
      onRevoke: grantId => mainRevoked.push(grantId),
      callerWebContentsId: MAIN_WEB_CONTENTS_ID,
    })
    createQwenCloudGrantService({
      context: settingsContext,
      registry,
      ownerId: `renderer:${SETTINGS_WEB_CONTENTS_ID}`,
      onRevoke: grantId => settingsRevoked.push(grantId),
      callerWebContentsId: SETTINGS_WEB_CONTENTS_ID,
    })

    const payload = request('grant:frame', 'camera-frames')
    await expect(defineInvoke(mainContext, electronQwenCloudGrantRegister)(payload, fromWindow(MAIN_WEB_CONTENTS_ID)))
      .resolves
      .toMatchObject({ activeGrantIds: ['grant:frame'] })
    await expect(defineInvoke(settingsContext, electronQwenCloudGrantRegister)(payload, fromWindow(MAIN_WEB_CONTENTS_ID)))
      .rejects
      .toMatchObject({ message: 'cross-window-invocation-rejected' })

    // Closing the settings window must not reach a grant the main window owns.
    expect(registry.clearOwner(`renderer:${SETTINGS_WEB_CONTENTS_ID}`)).toEqual([])
    expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual(['grant:frame'])

    // Only the owning window's teardown releases it.
    expect(registry.clearOwner(`renderer:${MAIN_WEB_CONTENTS_ID}`)).toEqual(['grant:frame'])
    expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual([])
    expect(mainRevoked).toEqual([])
    expect(settingsRevoked).toEqual([])
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  /**
   * @example
   * ```ts
   * await expect(revoke(payload, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(onRevoke).not.toHaveBeenCalled()
   * ```
   */
  it('never revokes a grant or cancels transports for an invoke sent by another window', async () => {
    const context = createTestContext()
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    registry.register(request('grant:frame', 'camera-frames'), `renderer:${MAIN_WEB_CONTENTS_ID}`)
    const onRevoke = vi.fn()
    createQwenCloudGrantService({
      context,
      registry,
      ownerId: `renderer:${MAIN_WEB_CONTENTS_ID}`,
      onRevoke,
      callerWebContentsId: MAIN_WEB_CONTENTS_ID,
    })
    const revoke = defineInvoke(context, electronQwenCloudGrantRevoke)

    await expect(revoke({
      contractVersion: QWEN_CLOUD_GRANT_VERSION,
      sessionId: 'session:camera',
      generation: 1,
      grantId: 'grant:frame',
      reason: 'user-stop',
    }, fromWindow(SETTINGS_WEB_CONTENTS_ID))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
    expect(onRevoke).toHaveBeenCalledTimes(0)
    expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual(['grant:frame'])
  })
})
