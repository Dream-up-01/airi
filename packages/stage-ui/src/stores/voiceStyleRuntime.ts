import type { ConversationPolicyResult } from '../domains/companion'
import type { VoiceStyleResolution } from '../domains/voiceConversation'

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

export interface VoiceStylePolicyContext {
  sessionId: string
  turnId: string
  policy: Pick<ConversationPolicyResult, 'risk' | 'scenario'>
}

/**
 * Session-scoped companion policy snapshot.
 *
 * Captured whenever a companion card is active and a voice session exists —
 * even between voice turns — so TTS resolution never loses the risk level
 * just because `activeTurnId` was cleared by an interrupt/stop.
 */
export interface VoiceStyleSessionPolicyContext {
  sessionId: string
  policy: Pick<ConversationPolicyResult, 'risk' | 'scenario'>
}

/**
 * Voice turn/session a queued TTS segment originated from.
 *
 * Both ids are snapshots taken when the segment's TTS intent was opened, never
 * the live voice conversation state — see {@link useVoiceStyleRuntimeStore}'s
 * `policyForSegment`.
 */
export interface VoiceStyleSegmentOrigin {
  /**
   * Voice turn active when the intent was opened. `undefined` when the intent
   * opened between turns (interrupt/stop clears the active turn) or from text
   * chat during a voice session.
   */
  turnId: string | undefined
  /**
   * Voice session active when the intent was opened. `undefined` when no voice
   * session existed at that moment.
   */
  sessionId: string | undefined
}

export interface VoiceStyleRuntimeResolution extends VoiceStyleResolution {
  sessionId: string
  /**
   * Voice turn the resolved segment belongs to, snapshotted when its TTS intent
   * was opened.
   *
   * `undefined` when the segment was enqueued while the session had no active
   * turn (interrupted/stopped session, or text typed during a voice session).
   * Those segments still resolve a style — from the session-scoped policy — so
   * this diagnostic snapshot has to be able to represent them.
   */
  turnId: string | undefined
  providerId: string
  modelId: string
  resolvedAt: number
}

// NOTICE:
// Retention cap for the turn/session policy maps. Interrupted voice turns
// never reach `playback-completed`, so `clearTurn` never fires for them and
// the maps would otherwise grow for the whole renderer lifetime. 16 entries
// comfortably covers every turn whose queued TTS segments can still be
// synthesizing while newer turns start. Root cause: policy lifetime is not
// tied to the voice session object. Removal condition: policies move onto
// the voice session/turn records themselves and are cleared with them.
const POLICY_RETENTION_LIMIT = 16

// Re-inserting an existing key first deletes it so Map insertion order acts
// as recency order: a re-captured policy moves to the newest slot instead of
// being evicted as if it were stale.
function setWithEviction<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key)
  map.set(key, value)
  while (map.size > POLICY_RETENTION_LIMIT) {
    const oldest = map.keys().next()
    if (oldest.done)
      break
    map.delete(oldest.value)
  }
}

/** Runtime-only bridge from checked M1 turn policy to the existing TTS path. */
export const useVoiceStyleRuntimeStore = defineStore('voice-style-runtime', () => {
  const policies = new Map<string, VoiceStylePolicyContext>()
  const sessionPolicies = new Map<string, VoiceStyleSessionPolicyContext>()
  const latestResolution = shallowRef<VoiceStyleRuntimeResolution>()

  function capturePolicy(context: VoiceStylePolicyContext) {
    setWithEviction(policies, context.turnId, context)
  }

  function captureSessionPolicy(context: VoiceStyleSessionPolicyContext) {
    setWithEviction(sessionPolicies, context.sessionId, context)
  }

  /**
   * Companion policy that governs the delivery of one queued TTS segment.
   *
   * Use when:
   * - A TTS segment is about to be synthesized and its voice style has to be
   *   derived from the policy that was checked for the turn producing it.
   *
   * Expects:
   * - `origin` holds the ids snapshotted when the segment's TTS intent was
   *   opened. Passing the live voice conversation ids is wrong: a listening
   *   restart mints a new session id (`replaceVoiceConversationSession` in
   *   `apps/stage-tamagotchi/src/renderer/pages/index.vue`) and an interrupt
   *   clears the active turn id, while the segments enqueued before that are
   *   still synthesizing.
   *
   * Returns:
   * - The turn-scoped policy when one was captured for that turn, otherwise the
   *   session-scoped policy captured for that session, otherwise `undefined` so
   *   the caller keeps its own default.
   */
  function policyForSegment(origin: VoiceStyleSegmentOrigin) {
    const turnPolicy = origin.turnId ? policies.get(origin.turnId) : undefined
    if (turnPolicy)
      return turnPolicy.policy

    return origin.sessionId ? sessionPolicies.get(origin.sessionId)?.policy : undefined
  }

  function publishResolution(resolution: VoiceStyleRuntimeResolution) {
    latestResolution.value = resolution
  }

  // Turn-scoped cleanup only: the session policy must outlive individual
  // turns because it is the fallback for segments whose turn policy was
  // never captured. Session entries are bounded by the retention cap and
  // wiped by `clear()`.
  function clearTurn(turnId: string | undefined) {
    if (!turnId)
      return
    policies.delete(turnId)
  }

  function clear() {
    policies.clear()
    sessionPolicies.clear()
    latestResolution.value = undefined
  }

  return {
    latestResolution,
    capturePolicy,
    captureSessionPolicy,
    policyForSegment,
    publishResolution,
    clearTurn,
    clear,
  }
})
