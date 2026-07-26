import type {
  CreateVoiceConversationSessionOptions,
  VoiceConversationCancelReason,
  VoiceConversationEvent,
  VoiceConversationProviderSnapshot,
  VoiceConversationSession,
  VoiceConversationTransitionFailure,
  VoiceTimelineEntry,
} from '../domains/voiceConversation'

import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import {
  createVoiceConversationSession,
  createVoiceSessionStartTimelineEntry,
  createVoiceTimelineEntry,
  transitionVoiceConversationSession,
} from '../domains/voiceConversation'

export interface StartVoiceConversationOptions extends CreateVoiceConversationSessionOptions {
  /**
   * Skips the permission state when the platform already owns an active
   * microphone stream. The platform layer is still responsible for the real
   * permission request; this store only mirrors product state.
   *
   * @default false
   */
  listeningImmediately?: boolean
}

export interface VoiceConversationProviderSwitchOptions extends VoiceConversationProviderSnapshot {
  now?: number
}

export interface VoiceConversationDispatchOptions {
  textLength?: number
}

export interface BeginVoiceConversationPermissionOptions extends CreateVoiceConversationSessionOptions {}

const maxTimelineEntries = 200

/**
 * Runtime-only voice conversation state boundary for M2.
 *
 * The store intentionally does not open microphones, call providers, send
 * chat messages, or play audio. Those side effects stay in hearing/chat/TTS
 * modules; this store owns correlation state and lifecycle legality.
 */
export const useVoiceConversationStore = defineStore('voice-conversation', () => {
  const session = shallowRef<VoiceConversationSession | null>(null)
  const timeline = shallowRef<VoiceTimelineEntry[]>([])
  const lastTransitionError = shallowRef<VoiceConversationTransitionFailure | null>(null)

  const state = computed(() => session.value?.state ?? 'idle')
  const activeTurnId = computed(() => session.value?.activeTurnId)
  const isActive = computed(() => session.value != null && !['idle', 'stopped', 'failed'].includes(session.value.state))
  const canAcceptUserSpeech = computed(() => state.value === 'listening')

  function start(options: StartVoiceConversationOptions): VoiceConversationSession {
    const created = createVoiceConversationSession(options)
    session.value = created
    timeline.value = [createVoiceSessionStartTimelineEntry(created)]
    lastTransitionError.value = null

    if (!options.listeningImmediately)
      return created

    const result = dispatch({ type: 'start-listening', at: options.now })
    if (!result)
      return created

    return result
  }

  function dispatch(event: VoiceConversationEvent, options?: VoiceConversationDispatchOptions): VoiceConversationSession | null {
    if (!session.value)
      return null

    const result = transitionVoiceConversationSession(session.value, event)
    if (!result.ok) {
      lastTransitionError.value = result.error
      return session.value
    }

    session.value = result.session
    recordTimelineEntry(createVoiceTimelineEntry(result.session, event, options))
    lastTransitionError.value = null
    return result.session
  }

  function beginPermissionRequest(options: BeginVoiceConversationPermissionOptions): VoiceConversationSession {
    start({ ...options, listeningImmediately: false })
    return dispatch({ type: 'request-permission', at: options.now }) ?? session.value!
  }

  function grantPermission(at?: number): VoiceConversationSession | null {
    if (state.value !== 'requesting-permission')
      return session.value

    return dispatch({ type: 'permission-granted', at })
  }

  function denyPermission(options: { at?: number, revoked?: boolean } = {}): VoiceConversationSession | null {
    if (!session.value)
      return null

    return dispatch({
      type: options.revoked ? 'permission-revoked' : 'permission-denied',
      code: 'permission_denied',
      at: options.at,
    })
  }

  function stop(reason: VoiceConversationCancelReason = 'user-stop', at?: number): VoiceConversationSession | null {
    return dispatch({ type: 'stop', reason, at })
  }

  function reset(): void {
    session.value = null
    timeline.value = []
    lastTransitionError.value = null
  }

  function isCurrentTurn(turnId: string): boolean {
    return session.value?.activeTurnId === turnId
  }

  function applyProviderSwitch(options: VoiceConversationProviderSwitchOptions): VoiceConversationSession | null {
    if (!session.value)
      return null

    const shouldStopActiveSession = isActive.value
    if (shouldStopActiveSession)
      stop('provider-switch', options.now)

    session.value = {
      ...session.value,
      inputProviderId: options.inputProviderId,
      inputModelId: options.inputModelId,
      outputProviderId: options.outputProviderId,
      outputModelId: options.outputModelId,
      voiceId: options.voiceId,
      updatedAt: options.now ?? Date.now(),
    }

    return session.value
  }

  function recordTimelineEntry(entry: VoiceTimelineEntry | null): void {
    if (!entry)
      return

    timeline.value = [...timeline.value.slice(-(maxTimelineEntries - 1)), entry]
  }

  return {
    session,
    timeline,
    state,
    activeTurnId,
    isActive,
    canAcceptUserSpeech,
    lastTransitionError,
    start,
    beginPermissionRequest,
    grantPermission,
    denyPermission,
    dispatch,
    stop,
    reset,
    isCurrentTurn,
    applyProviderSwitch,
  }
})
