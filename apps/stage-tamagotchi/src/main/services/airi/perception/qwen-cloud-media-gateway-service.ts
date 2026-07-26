import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { QwenCloudMediaGatewayManager } from './qwen-cloud-media-gateway-manager'

import {
  electronPerceptionMediaStream,
  electronPerceptionMediaTransportCancel,
  electronPerceptionMediaTransportStatus,
  parsePerceptionMediaTransportCancelRequest,
  parsePerceptionMediaTransportStatusRequest,
  PERCEPTION_MEDIA_TRANSPORT_VERSION,
} from '../../../../shared/eventa/perception'
import { defineWindowScopedInvokeHandler, defineWindowScopedStreamInvokeHandler } from '../../../windows/shared/windowScopedInvoke'

export function createQwenCloudMediaGatewayService(params: {
  context: ReturnType<typeof createContext>['context']
  manager: QwenCloudMediaGatewayManager
  /**
   * `webContents.id` of the renderer allowed to drive this registration.
   * Required because eventa's electron main listeners are process-global: without it another
   * window's copy of this service opens the upstream transport first, so media leaves the
   * device while the window that captured it is told its consent is missing.
   */
  callerWebContentsId: number
}) {
  defineWindowScopedStreamInvokeHandler(params.context, electronPerceptionMediaStream, params.callerWebContentsId, async function* (incoming, options) {
    yield* params.manager.handle(incoming, options?.abortController?.signal)
  })
  const cleanups = [
    defineWindowScopedInvokeHandler(params.context, electronPerceptionMediaTransportStatus, params.callerWebContentsId, (input) => {
      const parsed = parsePerceptionMediaTransportStatusRequest(input)
      if (!parsed.ok)
        throw new Error(parsed.errorCode)
      return params.manager.status(parsed.value)
    }),
    defineWindowScopedInvokeHandler(params.context, electronPerceptionMediaTransportCancel, params.callerWebContentsId, (input) => {
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
