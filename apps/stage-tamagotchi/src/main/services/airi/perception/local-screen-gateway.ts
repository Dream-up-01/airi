import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LocalTransformersScreenManager } from './local-transformers-screen'

import {
  electronLocalScreenAnalyze,
  electronLocalScreenStatus,
  electronLocalScreenStop,
  electronLocalScreenValidate,
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  MAX_LOCAL_SCREEN_FRAMES,
  parseLocalScreenAnalyzeMessage,
  parseLocalScreenAnalyzeResponse,
  parseLocalScreenGatewayStatusRequest,
  parseLocalScreenGatewayStopRequest,
  parseLocalScreenGatewayValidateRequest,
} from '../../../../shared/eventa/perception-local-screen'
import { defineWindowScopedInvokeHandler } from '../../../windows/shared/windowScopedInvoke'
import { LocalScreenGatewayError } from './local-transformers-screen'

export interface LocalScreenGatewayConsentVerifier {
  isActive: (grantId: string, sessionId: string, generation: number) => boolean
}

export function createLocalScreenGateway(params: {
  context: ReturnType<typeof createContext>['context']
  manager: LocalTransformersScreenManager
  consent: LocalScreenGatewayConsentVerifier
  /**
   * `webContents.id` of the renderer allowed to drive this registration's runtime.
   * Required because eventa's electron main listeners are process-global, so without it
   * one window's frames would also be analyzed and stopped by every other window's copy
   * of this gateway.
   */
  callerWebContentsId: number
}) {
  const cleanups = [
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenValidate, params.callerWebContentsId, async (input, options) => {
      const parsed = parseLocalScreenGatewayValidateRequest(input)
      if (!parsed.ok)
        throw new LocalScreenGatewayError(parsed.errorCode)
      const request = parsed.value
      if (!params.consent.isActive(request.consentGrantId, request.sessionId, request.generation))
        throw new LocalScreenGatewayError('consent-missing')
      return await params.manager.validate(request, options?.abortController?.signal)
    }),
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenAnalyze, params.callerWebContentsId, async (incoming, options) => {
      const signal = options?.abortController?.signal
      let open: Extract<import('../../../../shared/eventa/perception-local-screen').LocalScreenAnalyzeMessage, { type: 'open' }> | undefined
      let completed = false
      let lastSequence = -1
      const jpegFrames: Uint8Array[] = []
      try {
        for await (const input of incoming) {
          if (signal?.aborted)
            throw new LocalScreenGatewayError('runtime-cancelled')
          const parsed = parseLocalScreenAnalyzeMessage(input)
          if (!parsed.ok)
            throw new LocalScreenGatewayError(parsed.errorCode)
          const message = parsed.value

          if (message.type === 'open') {
            if (open || completed)
              throw new LocalScreenGatewayError('invalid-order')
            if (!params.consent.isActive(message.consentGrantId, message.sessionId, message.generation))
              throw new LocalScreenGatewayError('consent-missing')
            open = message
            continue
          }

          if (!open || completed || !sameCorrelation(open, message))
            throw new LocalScreenGatewayError('invalid-order')

          if (message.type === 'frame') {
            if (message.sequence <= lastSequence)
              throw new LocalScreenGatewayError('invalid-order')
            if (jpegFrames.length >= MAX_LOCAL_SCREEN_FRAMES)
              throw new LocalScreenGatewayError('payload-too-large')
            lastSequence = message.sequence
            jpegFrames.push(message.jpeg)
            continue
          }

          if (message.type === 'complete')
            completed = true
        }

        if (!open || !completed || jpegFrames.length === 0)
          throw new LocalScreenGatewayError('invalid-order')
        if (!params.consent.isActive(open.consentGrantId, open.sessionId, open.generation))
          throw new LocalScreenGatewayError('consent-missing')
        const acceptedOpen = open

        const response = await params.manager.analyze({
          jpegFrames,
          signal,
          envelope: {
            observationId: acceptedOpen.observationId,
            sessionId: acceptedOpen.sessionId,
            generation: acceptedOpen.generation,
            sourceId: acceptedOpen.sourceId,
            observedAt: acceptedOpen.observedAt,
            eventId: index => `${acceptedOpen.observationId}:e${index}`,
            adapterId: 'screen:transformers-local',
            runtimeModelId: LOCAL_SCREEN_MODEL_ID,
            runtimeProviderId: 'transformers-service',
          },
        })
        const outbound = parseLocalScreenAnalyzeResponse(response)
        if (!outbound.ok)
          throw new LocalScreenGatewayError('runtime-output-invalid')
        return outbound.value
      }
      finally {
        jpegFrames.length = 0
      }
    }),
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenStop, params.callerWebContentsId, async (input) => {
      const parsed = parseLocalScreenGatewayStopRequest(input)
      if (!parsed.ok)
        throw new LocalScreenGatewayError(parsed.errorCode)
      return await params.manager.stop(parsed.value)
    }),
    defineWindowScopedInvokeHandler(params.context, electronLocalScreenStatus, params.callerWebContentsId, (input) => {
      const parsed = parseLocalScreenGatewayStatusRequest(input)
      if (!parsed.ok)
        throw new LocalScreenGatewayError(parsed.errorCode)
      return params.manager.status(parsed.value)
    }),
  ]

  return () => cleanups.forEach(cleanup => cleanup())
}

function sameCorrelation(
  left: { contractVersion: string, sessionId: string, generation: number, observationId: string },
  right: { contractVersion: string, sessionId: string, generation: number, observationId: string },
): boolean {
  return left.contractVersion === LOCAL_SCREEN_GATEWAY_VERSION
    && right.contractVersion === LOCAL_SCREEN_GATEWAY_VERSION
    && left.sessionId === right.sessionId
    && left.generation === right.generation
    && left.observationId === right.observationId
}
