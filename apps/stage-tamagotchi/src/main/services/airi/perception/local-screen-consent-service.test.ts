import type { ExtractInvokeRequestOptions } from '@moeru/eventa'
import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  electronLocalScreenConsentRegister,
  electronLocalScreenConsentRevoke,
  electronLocalScreenConsentStatus,
  LOCAL_SCREEN_CONSENT_VERSION,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenConsentRegistry } from './local-screen-consent-registry'
import { createLocalScreenConsentService } from './local-screen-consent-service'

type ElectronMainContext = ReturnType<typeof createElectronContext>['context']

/** `webContents.id` of the window each service registration under test belongs to. */
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

function grant() {
  return {
    contractVersion: 'perception/v0.3' as const,
    grantId: 'grant:screen-local',
    sourceKind: 'screen' as const,
    sourceId: 'screen:primary',
    processingMode: 'local-only' as const,
    allowedModalities: ['screen-frames' as const],
    allowedFactCategories: ['screen.activity', 'screen.health'],
    grantedAt: 1_000,
    showPersistentIndicator: true,
  }
}

describe('local screen consent Eventa service', () => {
  /**
   * @example
   * ```ts
   * await expect(register(payload, fromWindow(11))).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })
   * ```
   */
  it('registers, reports and revokes the same strict memory-only grant', async () => {
    const context = createTestContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    createLocalScreenConsentService({ context, registry, callerWebContentsId: OWNING_WEB_CONTENTS_ID })
    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    const status = defineInvoke(context, electronLocalScreenConsentStatus)
    const revoke = defineInvoke(context, electronLocalScreenConsentRevoke)

    await expect(register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: grant(),
    }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })
    await expect(status({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
    }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ activeSourceIds: ['screen:primary'] })
    await expect(revoke({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen-local',
      reason: 'user-stop',
    }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ activeGrantIds: [] })
  })

  /**
   * @example
   * ```ts
   * await expect(register(cloudExpandedPayload, fromWindow(11))).rejects.toMatchObject({ message: 'consent-policy-violation' })
   * ```
   */
  it('rejects a cloud-expanded grant at the main inbound boundary', async () => {
    const context = createTestContext()
    createLocalScreenConsentService({
      context,
      registry: createLocalScreenConsentRegistry(),
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    await expect(register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: {
        ...grant(),
        processingMode: 'cloud-approved',
        cloudProviderId: 'aliyun',
        cloudModelId: 'qwen3.5-omni-flash-realtime',
        regionId: 'cn-beijing',
        costBoundaryId: 'budget:1',
      },
    }, fromWindow(OWNING_WEB_CONTENTS_ID))).rejects.toMatchObject({ message: 'consent-policy-violation' })
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  //
  // ROOT CAUSE:
  //
  // The settings window and the main window each register this service on their own eventa
  // context, but eventa's electron main adapter attaches its message listener with
  // `ipcMain.on(...)` (node_modules/@moeru/eventa/dist/adapters/electron/main.mjs:5), which is
  // process-global. A `consent/register` invoke sent by one window was therefore emitted into
  // *every* registered context, so every copy of this handler ran and wrote the grant into the
  // shared registry, occupying `activeSessionId`. The response then went to
  // `window.webContents.send(...)` (:26) — the context's bound window, not the caller — and
  // `onlySameWindow` defaults to false (:12) while only filtering response delivery (:25),
  // never handler execution. Net effect: the caller's invoke hung forever while a foreign
  // window had already registered consent, and the session stayed occupied for the rest of the
  // process lifetime, so screen perception became permanently unusable.
  //
  // We fixed this by routing every handler through `defineWindowScopedInvokeHandler`, which
  // compares `options.raw.ipcMainEvent.sender.id` against the `webContents.id` the
  // registration belongs to and throws before the handler body runs.
  /**
   * @example
   * ```ts
   * await expect(register(payload, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(registry.register).toHaveBeenCalledTimes(0)
   * ```
   */
  it('never touches the shared registry for an invoke sent by another window', async () => {
    const context = createTestContext()
    const backing = createLocalScreenConsentRegistry({ now: () => 1_000 })
    const registry = {
      register: vi.fn(backing.register),
      revoke: vi.fn(backing.revoke),
      status: vi.fn(backing.status),
      isActive: vi.fn(backing.isActive),
      clearAll: vi.fn(backing.clearAll),
      clearOwner: vi.fn(backing.clearOwner),
    }
    createLocalScreenConsentService({ context, registry, callerWebContentsId: OWNING_WEB_CONTENTS_ID })
    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    const payload = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: grant(),
    }

    await expect(register(payload, fromWindow(OWNING_WEB_CONTENTS_ID + 1))).rejects.toMatchObject({
      message: 'cross-window-invocation-rejected',
    })
    expect(registry.register).toHaveBeenCalledTimes(0)

    // The owning window still works, and the registry was never left half-occupied.
    await expect(register(payload, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({
      activeGrantIds: ['grant:screen-local'],
    })
    expect(registry.register).toHaveBeenCalledTimes(1)
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // The settings window's teardown (`windows/settings/rpc/index.electron.ts`,
  // `settingsWindow.once('closed', ...)`) only unbound the eventa handlers and
  // cleared the qwen cloud grants. A screen perception session started from the
  // settings page therefore survived the window in the shared consent registry:
  // `activeSessionId` still named its session and the renderer that could have
  // revoked the grant no longer existed, so the main window's next register()
  // threw `session-conflict` and screen perception was dead until the app was
  // restarted. The main window's `clearAll()` could not simply be copied here —
  // closing settings must not drop the consent the main window is capturing with.
  //
  // We fixed this by tagging every grant with the registering window
  // (`renderer:<webContentsId>`) and releasing only that owner from this
  // service's cleanup, which the window teardown already calls.
  /**
   * @example
   * ```ts
   * cleanupSettingsWindow()
   * await expect(registerFromMainWindow(payload, fromWindow(12))).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })
   * ```
   */
  it('frees the session for another window when the registering window is torn down', async () => {
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    const settingsContext = createTestContext()
    const cleanupSettingsWindow = createLocalScreenConsentService({
      context: settingsContext,
      registry,
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const registerFromSettings = defineInvoke(settingsContext, electronLocalScreenConsentRegister)
    await expect(registerFromSettings({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen-settings',
      generation: 1,
      grant: grant(),
    }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })

    // The user closes the settings window without stopping the capture first.
    cleanupSettingsWindow()

    const mainContext = createTestContext()
    createLocalScreenConsentService({
      context: mainContext,
      registry,
      callerWebContentsId: OWNING_WEB_CONTENTS_ID + 1,
    })
    const registerFromMain = defineInvoke(mainContext, electronLocalScreenConsentRegister)
    await expect(registerFromMain({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen-main',
      generation: 1,
      grant: grant(),
    }, fromWindow(OWNING_WEB_CONTENTS_ID + 1))).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })
    expect(registry.isActive('grant:screen-local', 'session:screen-main', 1)).toBe(true)
  })
})
