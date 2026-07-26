import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LocalScreenConsentRegistry } from './local-screen-consent-registry'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLocalScreenConsentRegister,
  electronLocalScreenConsentRevoke,
  electronLocalScreenConsentStatus,
  parseLocalScreenConsentRegisterRequest,
  parseLocalScreenConsentRevokeRequest,
  parseLocalScreenConsentSnapshot,
  parseLocalScreenConsentStatusRequest,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { LocalScreenConsentRegistryError } from './local-screen-consent-registry'

export function createLocalScreenConsentService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: LocalScreenConsentRegistry
}) {
  const cleanups = [
    defineInvokeHandler(params.context, electronLocalScreenConsentRegister, (input) => {
      const parsed = parseLocalScreenConsentRegisterRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.register(parsed.value))
    }),
    defineInvokeHandler(params.context, electronLocalScreenConsentRevoke, (input) => {
      const parsed = parseLocalScreenConsentRevokeRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.revoke(parsed.value))
    }),
    defineInvokeHandler(params.context, electronLocalScreenConsentStatus, (input) => {
      const parsed = parseLocalScreenConsentStatusRequest(input)
      if (!parsed.ok)
        throw new LocalScreenConsentRegistryError(parsed.errorCode)
      return assertSnapshot(params.registry.status(parsed.value))
    }),
  ]
  return () => cleanups.forEach(cleanup => cleanup())
}

function assertSnapshot(input: unknown) {
  const parsed = parseLocalScreenConsentSnapshot(input)
  if (!parsed.ok)
    throw new LocalScreenConsentRegistryError('invalid-schema')
  return parsed.value
}
