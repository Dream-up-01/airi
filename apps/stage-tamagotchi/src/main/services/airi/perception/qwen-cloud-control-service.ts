import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudControlManager } from './qwen-cloud-control-manager'
import type { QwenCloudMediaGatewayManager } from './qwen-cloud-media-gateway-manager'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronQwenCloudControlStatus,
  electronQwenCloudControlStop,
  electronQwenCloudControlValidate,
  parseQwenCloudControlRequest,
  parseQwenCloudControlStatus,
} from '../../../../shared/eventa/perception-cloud'

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
}) {
  const cleanups = [
    defineInvokeHandler(params.context, electronQwenCloudControlStatus, input => handle(input, requestId => params.manager.status(requestId))),
    defineInvokeHandler(params.context, electronQwenCloudControlValidate, input => handle(input, requestId => params.manager.validate(requestId))),
    defineInvokeHandler(params.context, electronQwenCloudControlStop, input => handle(input, async (requestId) => {
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
