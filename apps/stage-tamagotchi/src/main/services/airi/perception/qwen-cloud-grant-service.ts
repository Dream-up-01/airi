import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronQwenCloudGrantRegister,
  electronQwenCloudGrantRevoke,
  parseQwenCloudGrantSnapshot,
} from '../../../../shared/eventa/perception-cloud'

export function createQwenCloudGrantService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: QwenCloudGrantRegistry
  ownerId: string
  onRevoke?: (grantId: string) => void
}) {
  const cleanups = [
    defineInvokeHandler(params.context, electronQwenCloudGrantRegister, input => validate(params.registry.register(input, params.ownerId))),
    defineInvokeHandler(params.context, electronQwenCloudGrantRevoke, (input) => {
      const response = params.registry.revoke(input)
      if (typeof input === 'object' && input && 'grantId' in input && typeof input.grantId === 'string')
        params.onRevoke?.(input.grantId)
      return validate(response)
    }),
  ]
  return () => cleanups.forEach(cleanup => cleanup())
}

function validate(input: unknown) {
  const parsed = parseQwenCloudGrantSnapshot(input)
  if (!parsed.ok)
    throw new Error('invalid-response')
  return parsed.value
}
