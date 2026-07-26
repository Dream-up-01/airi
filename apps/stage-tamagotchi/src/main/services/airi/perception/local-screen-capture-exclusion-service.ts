import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LocalScreenConsentRegistry } from './local-screen-consent-registry'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLocalScreenCaptureExclusion,
  LOCAL_SCREEN_CONSENT_VERSION,
  parseLocalScreenCaptureExclusionRequest,
  parseLocalScreenCaptureExclusionStatus,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { LocalScreenConsentRegistryError } from './local-screen-consent-registry'

export interface LocalScreenCaptureExclusionWindow {
  setContentProtection: (enabled: boolean) => void
}

/** Prevents AIRI's own main window from appearing in whole-display captures. */
export function createLocalScreenCaptureExclusionService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: LocalScreenConsentRegistry
  window: LocalScreenCaptureExclusionWindow
}) {
  let active: { sessionId: string, generation: number, grantId: string } | undefined
  const cleanupHandler = defineInvokeHandler(params.context, electronLocalScreenCaptureExclusion, (input) => {
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
    if (active)
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
