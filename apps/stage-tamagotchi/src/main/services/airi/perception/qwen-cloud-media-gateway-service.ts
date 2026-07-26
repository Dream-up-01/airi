import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudMediaGatewayManager } from './qwen-cloud-media-gateway-manager'

import { defineInvokeHandler, defineStreamInvokeHandler } from '@moeru/eventa'

import {
  electronPerceptionMediaStream,
  electronPerceptionMediaTransportCancel,
  electronPerceptionMediaTransportStatus,
  parsePerceptionMediaTransportCancelRequest,
  parsePerceptionMediaTransportStatusRequest,
  PERCEPTION_MEDIA_TRANSPORT_VERSION,
} from '../../../../shared/eventa/perception'

export function createQwenCloudMediaGatewayService(params: {
  context: ReturnType<typeof createContext>['context']
  manager: QwenCloudMediaGatewayManager
}) {
  defineStreamInvokeHandler(params.context, electronPerceptionMediaStream, async function* (incoming, options) {
    yield* params.manager.handle(incoming, options?.abortController?.signal)
  })
  const cleanups = [
    defineInvokeHandler(params.context, electronPerceptionMediaTransportStatus, (input) => {
      const parsed = parsePerceptionMediaTransportStatusRequest(input)
      if (!parsed.ok)
        throw new Error(parsed.errorCode)
      return params.manager.status(parsed.value)
    }),
    defineInvokeHandler(params.context, electronPerceptionMediaTransportCancel, (input) => {
      const parsed = parsePerceptionMediaTransportCancelRequest(input)
      if (!parsed.ok)
        throw new Error(parsed.errorCode)
      params.manager.cancelWindow(parsed.value.windowId, parsed.value.reason)
      const status = params.manager.status(parsed.value)
      return {
        contractVersion: PERCEPTION_MEDIA_TRANSPORT_VERSION,
        sessionId: parsed.value.sessionId,
        generation: parsed.value.generation,
        windowId: parsed.value.windowId,
        type: status.state === 'unknown' ? 'rejected' as const : 'cancelled' as const,
        acceptedAudioBytes: status.acceptedAudioBytes,
        acceptedImageBytes: status.acceptedImageBytes,
        droppedItems: status.droppedItems,
        ...(status.state === 'unknown' ? { errorCode: 'cancelled' as const } : {}),
      }
    }),
  ]
  return () => cleanups.forEach(cleanup => cleanup())
}
