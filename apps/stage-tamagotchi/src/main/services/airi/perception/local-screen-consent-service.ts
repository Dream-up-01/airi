import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LocalScreenConsentRegistry } from './local-screen-consent-registry'

import {
  electronLocalScreenConsentRegister,
  electronLocalScreenConsentRevoke,
  electronLocalScreenConsentStatus,
  parseLocalScreenConsentRegisterRequest,
  parseLocalScreenConsentRevokeRequest,
  parseLocalScreenConsentSnapshot,
  parseLocalScreenConsentStatusRequest,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { defineWindowScopedInvokeHandler } from '../../../windows/shared/windowScopedInvoke'
import { LocalScreenConsentRegistryError } from './local-screen-consent-registry'

export function createLocalScreenConsentService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: LocalScreenConsentRegistry
  /**
   * `webContents.id` of the renderer allowed to drive consent through this registration.
   * Required because eventa's electron main listeners are process-global, so without it
   * a grant registered from one window would also be written by every other window's copy
   * of this service.
   */
  callerWebContentsId: number
}) {
  // The caller's `webContents.id` is also the only stable identity of the window
  // that owns whatever this registration writes into the shared registry.
  const ownerId = `renderer:${params.callerWebContentsId}`
  const cleanups = [
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenConsentRegister, params.callerWebContentsId, (input) => {
      const parsed = parseLocalScreenConsentRegisterRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.register(parsed.value, ownerId))
    }),
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenConsentRevoke, params.callerWebContentsId, (input) => {
      const parsed = parseLocalScreenConsentRevokeRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.revoke(parsed.value))
    }),
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenConsentStatus, params.callerWebContentsId, (input) => {
      const parsed = parseLocalScreenConsentStatusRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.status(parsed.value))
    }),
  ]
  return () => {
    cleanups.forEach(cleanup => cleanup())
    // This runs from the owning window's `closed` handler, so the renderer that
    // could revoke these grants no longer exists. Left behind, they keep the
    // registry's single-session lock occupied and every other window's
    // register() answers `session-conflict` for the rest of the process
    // lifetime. Only this window's grants may go: clearAll() would drop the
    // grants another window is actively capturing with.
    params.registry.clearOwner(ownerId)
  }
}

function assertSnapshot(input: unknown) {
  const parsed = parseLocalScreenConsentSnapshot(input)
  if (!parsed.ok)
    throw new LocalScreenConsentRegistryError('invalid-schema')
  return parsed.value
}
