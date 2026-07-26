import type { ConversationPolicyResult } from '../domains/companion'
import type { VoiceStyleResolution } from '../domains/voiceConversation'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export interface VoiceStylePolicyContext {
  sessionId: string
  turnId: string
  policy: Pick<ConversationPolicyResult, 'risk' | 'scenario'>
}

export interface VoiceStyleRuntimeResolution extends VoiceStyleResolution {
  sessionId: string
  turnId: string
  providerId: string
  modelId: string
  resolvedAt: number
}

/** Runtime-only bridge from checked M1 turn policy to the existing TTS path. */
export const useVoiceStyleRuntimeStore = defineStore('voice-style-runtime', () => {
  const policies = new Map<string, VoiceStylePolicyContext>()
  const latestResolution = shallowRef<VoiceStyleRuntimeResolution>()

  function capturePolicy(context: VoiceStylePolicyContext) {
    policies.set(context.turnId, context)
  }

  function policyForTurn(turnId: string | undefined) {
    return turnId ? policies.get(turnId)?.policy : undefined
  }

  function publishResolution(resolution: VoiceStyleRuntimeResolution) {
    latestResolution.value = resolution
  }

  function clearTurn(turnId: string | undefined) {
    if (!turnId)
      return
    policies.delete(turnId)
  }

  function clear() {
    policies.clear()
    latestResolution.value = undefined
  }

  return {
    latestResolution,
    capturePolicy,
    policyForTurn,
    publishResolution,
    clearTurn,
    clear,
  }
})
