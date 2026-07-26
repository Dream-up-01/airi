import type { VoiceConversationDiagnosticsSnapshot } from '../domains/voiceConversation'

import { defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

import { normalizeVoiceConversationDiagnosticsSnapshot } from '../domains/voiceConversation'

const VOICE_DIAGNOSTICS_CHANNEL_NAME = 'airi:voice-runtime-diagnostics'
const voiceDiagnosticsRequestEvent = defineEventa<{ requestedAt: number }>('eventa:event:voice-diagnostics:request')
const voiceDiagnosticsSnapshotEvent = defineEventa<VoiceConversationDiagnosticsSnapshot>('eventa:event:voice-diagnostics:snapshot')

let channel: BroadcastChannel | undefined
let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined

function getVoiceDiagnosticsContext() {
  channel ??= new BroadcastChannel(VOICE_DIAGNOSTICS_CHANNEL_NAME)
  context ??= createBroadcastChannelContext(channel).context
  return context
}

export function publishVoiceRuntimeDiagnostics(value: VoiceConversationDiagnosticsSnapshot) {
  const snapshot = normalizeVoiceConversationDiagnosticsSnapshot(value)
  if (snapshot)
    getVoiceDiagnosticsContext().emit(voiceDiagnosticsSnapshotEvent, snapshot)
}

export function requestVoiceRuntimeDiagnostics() {
  getVoiceDiagnosticsContext().emit(voiceDiagnosticsRequestEvent, { requestedAt: Date.now() })
}

export function onVoiceRuntimeDiagnosticsRequested(listener: () => void) {
  const subscription = getVoiceDiagnosticsContext().on(voiceDiagnosticsRequestEvent, () => listener())
  return subscription
}

export function onVoiceRuntimeDiagnosticsSnapshot(listener: (snapshot: VoiceConversationDiagnosticsSnapshot) => void) {
  const subscription = getVoiceDiagnosticsContext().on(voiceDiagnosticsSnapshotEvent, (event) => {
    const snapshot = normalizeVoiceConversationDiagnosticsSnapshot(event?.body)
    if (snapshot)
      listener(snapshot)
  })
  return subscription
}
