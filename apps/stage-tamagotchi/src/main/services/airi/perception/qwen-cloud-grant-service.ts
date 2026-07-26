import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'

import {
  electronQwenCloudGrantRegister,
  electronQwenCloudGrantRevoke,
  parseQwenCloudGrantSnapshot,
} from '../../../../shared/eventa/perception-cloud'
import { defineWindowScopedInvokeHandler } from '../../../windows/shared/windowScopedInvoke'

export function createQwenCloudGrantService(params: {
  context: ReturnType<typeof createContext>['context']
  registry: QwenCloudGrantRegistry
  ownerId: string
  onRevoke?: (grantId: string) => void
  /**
   * `webContents.id` of the renderer allowed to drive this registration.
   * Required because eventa's electron main listeners are process-global: without it every
   * window's copy of this service rewrites the grant's `ownerId` to its own, so closing one
   * window revokes grants another window is actively using.
   */
  callerWebContentsId: number
}) {
  const cleanups = [
    defineWindowScopedInvokeHandler(params.context, electronQwenCloudGrantRegister, params.callerWebContentsId, input => validate(params.registry.register(input, params.ownerId))),
    defineWindowScopedInvokeHandler(params.context, electronQwenCloudGrantRevoke, params.callerWebContentsId, (input) => {
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
