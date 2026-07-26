import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LocalScreenConsentRegistry } from './local-screen-consent-registry'

import {
  electronLocalScreenCaptureExclusion,
  LOCAL_SCREEN_CONSENT_VERSION,
  parseLocalScreenCaptureExclusionRequest,
  parseLocalScreenCaptureExclusionStatus,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { defineWindowScopedInvokeHandler } from '../../../windows/shared/windowScopedInvoke'
import { LocalScreenConsentRegistryError } from './local-screen-consent-registry'

export interface LocalScreenCaptureExclusionWindow {
  setContentProtection: (enabled: boolean) => void
  /**
   * Present on `Electron.BrowserWindow`. Absent in tests using a minimal double,
   * which is treated as "still alive".
   */
  isDestroyed?: () => boolean
}

/** Prevents AIRI's own window from appearing in whole-display captures. */
export function createLocalScreenCaptureExclusionService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: LocalScreenConsentRegistry
  /**
   * The window kept out of captured frames. Distinct from `callerWebContentsId`: this names the
   * protected surface, and a registration may well protect a window other than the one that
   * requested the exclusion.
   */
  window: LocalScreenCaptureExclusionWindow
  /**
   * `webContents.id` of the renderer allowed to toggle this registration's exclusion.
   * Kept separate from `window` because that one names what is protected, not who may ask.
   */
  callerWebContentsId: number
}) {
  let active: { sessionId: string, generation: number, grantId: string } | undefined
  const cleanupHandler = defineWindowScopedInvokeHandler(params.context, electronLocalScreenCaptureExclusion, params.callerWebContentsId, (input) => {
    const parsed = parseLocalScreenCaptureExclusionRequest(input)
    if (!parsed.ok)
      throw new LocalScreenConsentRegistryError(parsed.errorCode)
    const request = parsed.value

    if (request.enabled) {
      if (!params.registry.isActive(request.grantId, request.sessionId, request.generation))
        throw new LocalScreenConsentRegistryError('consent-missing')
      if (active && (active.sessionId !== request.sessionId || active.generation !== request.generation || active.grantId !== request.grantId))
        throw new LocalScreenConsentRegistryError('session-conflict')
      active = { sessionId: request.sessionId, generation: request.generation, grantId: request.grantId }
      params.window.setContentProtection(true)
      return status(request.sessionId, request.generation, true)
    }

    if (active && (active.sessionId !== request.sessionId || active.generation !== request.generation || active.grantId !== request.grantId))
      throw new LocalScreenConsentRegistryError('stale-generation')
    params.window.setContentProtection(false)
    active = undefined
    return status(request.sessionId, request.generation, false)
  })

  return () => {
    cleanupHandler()
    // This cleanup runs from the window's own 'closed' handler (see the
    // `once('closed')` teardown in both window rpc setups), so the native
    // window is already gone by then. Calling `setContentProtection` on a
    // destroyed BrowserWindow throws "Object has been destroyed", and this
    // runs inside an Electron event handler with no surrounding try/catch —
    // the throw would surface as an uncaught exception in the main process.
    // The OS-level protection dies with the window anyway, so skipping it is
    // also semantically correct.
    if (active && !params.window.isDestroyed?.())
      params.window.setContentProtection(false)
    active = undefined
  }
}

function status(sessionId: string, generation: number, enabled: boolean) {
  const parsed = parseLocalScreenCaptureExclusionStatus({
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId,
    generation,
    enabled,
  })
  if (!parsed.ok)
    throw new LocalScreenConsentRegistryError('invalid-schema')
  return parsed.value
}
