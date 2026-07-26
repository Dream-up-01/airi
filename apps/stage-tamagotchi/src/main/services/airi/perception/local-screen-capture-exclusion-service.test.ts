import type { ExtractInvokeRequestOptions } from '@moeru/eventa'
import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  electronLocalScreenCaptureExclusion,
  LOCAL_SCREEN_CONSENT_VERSION,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenCaptureExclusionService } from './local-screen-capture-exclusion-service'
import { createLocalScreenConsentRegistry } from './local-screen-consent-registry'

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

function register(registry: ReturnType<typeof createLocalScreenConsentRegistry>) {
  registry.register({
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId: 'session:screen',
    generation: 1,
    grant: {
      contractVersion: 'perception/v0.3',
      grantId: 'grant:screen',
      sourceKind: 'screen',
      sourceId: 'screen:1',
      processingMode: 'local-only',
      allowedModalities: ['screen-frames'],
      allowedFactCategories: ['screen.activity'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  })
}

describe('local screen capture exclusion service', () => {
  /**
   * @example
   * ```ts
   * await expect(setExclusion(request, fromWindow(11))).resolves.toMatchObject({ enabled: true })
   * expect(setContentProtection).toHaveBeenLastCalledWith(true)
   * ```
   */
  it('requires consent and restores capturability during cleanup', async () => {
    const context = createTestContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    const setContentProtection = vi.fn()
    const cleanup = createLocalScreenCaptureExclusionService({
      context,
      registry,
      window: { setContentProtection },
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const setExclusion = defineInvoke(context, electronLocalScreenCaptureExclusion)
    const request = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen',
      enabled: true,
    } as const

    await expect(setExclusion(request, fromWindow(OWNING_WEB_CONTENTS_ID))).rejects.toMatchObject({ message: 'consent-missing' })
    expect(setContentProtection).not.toHaveBeenCalled()

    register(registry)
    await expect(setExclusion(request, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toMatchObject({ enabled: true })
    expect(setContentProtection).toHaveBeenLastCalledWith(true)

    cleanup()
    expect(setContentProtection).toHaveBeenLastCalledWith(false)
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  /**
   * @example
   * ```ts
   * await expect(setExclusion(request, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(setContentProtection).toHaveBeenCalledTimes(0)
   * ```
   */
  it('never toggles content protection for an invoke sent by another window', async () => {
    const context = createTestContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    register(registry)
    const setContentProtection = vi.fn()
    createLocalScreenCaptureExclusionService({
      context,
      registry,
      window: { setContentProtection },
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const setExclusion = defineInvoke(context, electronLocalScreenCaptureExclusion)

    await expect(setExclusion({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen',
      enabled: true,
    }, fromWindow(OWNING_WEB_CONTENTS_ID + 1))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
    expect(setContentProtection).toHaveBeenCalledTimes(0)
  })

  // Found by code review 2026-07-26 (M3 perception IPC review)
  //
  // ROOT CAUSE:
  //
  // Both window rpc setups invoke this service's cleanup from the window's own
  // `once('closed')` handler, so the native window is already destroyed when it
  // runs. The cleanup unconditionally restored protection while an exclusion
  // was active:
  //
  //   if (active)
  //     params.window.setContentProtection(false)
  //
  // On a real BrowserWindow that throws "Object has been destroyed", and since
  // the teardown runs inside an Electron event handler with no try/catch, the
  // throw became an uncaught exception in the main process. It only became
  // reachable once the settings window started registering this service too,
  // because the settings window is the one users actually close mid-session.
  //
  // We fixed this by skipping the restore when the window reports itself
  // destroyed; OS-level protection is released with the window anyway.
  it('does not touch a destroyed window while cleaning up an active exclusion', async () => {
    const context = createTestContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    register(registry)
    const setContentProtection = vi.fn()
    const cleanup = createLocalScreenCaptureExclusionService({
      context,
      registry,
      window: { setContentProtection, isDestroyed: () => true },
      callerWebContentsId: OWNING_WEB_CONTENTS_ID,
    })
    const setExclusion = defineInvoke(context, electronLocalScreenCaptureExclusion)

    await setExclusion({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen',
      enabled: true,
    }, fromWindow(OWNING_WEB_CONTENTS_ID))
    expect(setContentProtection).toHaveBeenCalledTimes(1)
    expect(setContentProtection).toHaveBeenNthCalledWith(1, true)

    expect(() => cleanup()).not.toThrow()
    expect(setContentProtection).toHaveBeenCalledTimes(1)
  })
})
