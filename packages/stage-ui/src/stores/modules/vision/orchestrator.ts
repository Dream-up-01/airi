import type { VisionWorkloadId } from '../../../composables/vision/use-vision-workloads'

import { errorMessageFrom } from '@moeru/std'
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'

import { useVisionInference } from '../../../composables/vision'
import { useVisionStore } from './store'

/**
 * Payload describing one captured frame routed through the vision orchestrator.
 */
export interface VisionCapturePayload {
  /** JPEG or PNG data URL captured from the selected source. */
  imageDataUrl: string
  /** Vision workload that describes how the frame should be interpreted. */
  workloadId: VisionWorkloadId
}

/**
 * Coordinates memory-only screen-capture inference for the legacy Devtools workflow.
 *
 * Use when:
 * - A renderer page captures frames and needs multimodal inference results
 * - A developer needs to inspect the provider response locally
 *
 * This store deliberately has no context channel dependency. Production perception facts
 * must enter through PerceptionStateManager; raw frames and free model output cannot be
 * published to chat, context, telemetry or an export path from this Devtools facade.
 *
 * Expects:
 * - The vision settings store to already contain an active provider and model
 *
 * Returns:
 * - A Pinia store that tracks the latest result, last error, and capture-processing actions
 */
export const useVisionOrchestratorStore = defineStore('vision-orchestrator', () => {
  const visionStore = useVisionStore()
  const { activeProvider, activeModel } = storeToRefs(visionStore)
  const { runVisionInference } = useVisionInference()

  const lastResultAt = ref<number | null>(null)
  const lastError = ref<string | null>(null)
  const lastWorkloadId = ref<VisionWorkloadId>('screen:interpret')

  async function processCapture(payload: VisionCapturePayload) {
    if (!activeProvider.value || !activeModel.value) {
      const configurationError = new Error('Vision model is not configured')
      recordError(configurationError)
      throw configurationError
    }

    lastWorkloadId.value = payload.workloadId

    try {
      const text = await runVisionInference({
        imageDataUrl: payload.imageDataUrl,
        workloadId: payload.workloadId,
      })

      lastResultAt.value = Date.now()
      lastError.value = null

      return { contextUpdates: 0, text }
    }
    catch (error) {
      recordError(error)
      throw error
    }
  }

  function recordError(error: unknown) {
    const message = errorMessageFrom(error)
    lastError.value = message === 'Vision model is not configured'
      ? message
      : 'Vision inference failed'
  }

  return {
    lastResultAt,
    lastError,
    lastWorkloadId,
    processCapture,
    recordError,
  }
})
