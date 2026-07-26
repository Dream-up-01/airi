import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudControlManager } from './qwen-cloud-control-manager'
import type { QwenCloudMediaGatewayManager } from './qwen-cloud-media-gateway-manager'

import {
  electronQwenCloudControlStatus,
  electronQwenCloudControlStop,
  electronQwenCloudControlValidate,
  parseQwenCloudControlRequest,
  parseQwenCloudControlStatus,
} from '../../../../shared/eventa/perception-cloud'
import { defineWindowScopedInvokeHandler } from '../../../windows/shared/windowScopedInvoke'

export class QwenCloudControlError extends Error {
  constructor(readonly code: 'invalid-schema' | 'invalid-response') {
    super(code)
    this.name = 'QwenCloudControlError'
  }
}

export function createQwenCloudControlService(params: {
  context: ReturnType<typeof createContext>['context']
  manager: QwenCloudControlManager
  mediaGateway?: QwenCloudMediaGatewayManager
  /**
   * `webContents.id` of the renderer allowed to drive this registration.
   * Required because eventa's electron main listeners are process-global, so without it
   * a stop issued by one window would also tear down every other window's transports.
   */
  callerWebContentsId: number
}) {
  const cleanups = [
    defineWindowScopedInvokeHandler(params.context, electronQwenCloudControlStatus, params.callerWebContentsId, input => handle(input, requestId => params.manager.status(requestId))),
    defineWindowScopedInvokeHandler(params.context, electronQwenCloudControlValidate, params.callerWebContentsId, input => handle(input, requestId => params.manager.validate(requestId))),
    defineWindowScopedInvokeHandler(params.context, electronQwenCloudControlStop, params.callerWebContentsId, input => handle(input, async (requestId) => {
      params.mediaGateway?.stopAll('user-stop')
      return await params.manager.stop(requestId)
    })),
  ]
  return () => cleanups.forEach(cleanup => cleanup())
}

async function handle(
  input: unknown,
  action: (requestId: string) => unknown | Promise<unknown>,
) {
  const parsed = parseQwenCloudControlRequest(input)
  if (!parsed.ok)
    throw new QwenCloudControlError('invalid-schema')
  const response = await action(parsed.value.requestId)
  const validated = parseQwenCloudControlStatus(response)
  if (!validated.ok)
    throw new QwenCloudControlError('invalid-response')
  return validated.value
}
