import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export type SpeechOutputStopReason = 'manual-chat' | 'provider-switch' | 'voice-interrupt' | 'voice-stop'

/**
 * Represents a user-requested stop-speaking command for the stage output host.
 */
export interface SpeechOutputStopRequest {
  /** Monotonic sequence number so repeated requests with the same reason still notify watchers. */
  id: number
  /** Source of the stop-speaking request. */
  reason: SpeechOutputStopReason
}

export interface SpeechOutputStopAcknowledgement {
  /** The exact request that the Stage audio host has finished draining. */
  requestId: number
}

export const useSpeechOutputControlStore = defineStore('speech-output-control', () => {
  const latestStopRequest = shallowRef<SpeechOutputStopRequest>()
  const latestStopAcknowledgement = shallowRef<SpeechOutputStopAcknowledgement>()
  let nextRequestId = 1

  /**
   * Requests that the active speech output host stops assistant audio playback.
   *
   * Use when:
   * - A UI control should stop TTS playback without cancelling chat text generation.
   *
   * Expects:
   * - A mounted Stage host is watching {@link latestStopRequest}.
   *
   * Returns:
   * - A monotonic request id that the Stage host acknowledges after draining.
   */
  function requestStopSpeaking(reason: SpeechOutputStopReason) {
    const id = nextRequestId++
    latestStopRequest.value = {
      id,
      reason,
    }
    return id
  }

  /** Confirms that the Stage host stopped the active source and drained queued audio. */
  function acknowledgeStopSpeaking(requestId: number) {
    if (!Number.isSafeInteger(requestId) || requestId <= 0)
      return
    if (latestStopAcknowledgement.value && latestStopAcknowledgement.value.requestId >= requestId)
      return

    latestStopAcknowledgement.value = { requestId }
  }

  return {
    latestStopAcknowledgement,
    latestStopRequest,
    acknowledgeStopSpeaking,
    requestStopSpeaking,
  }
})
