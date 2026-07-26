import { defineEventa } from '@moeru/eventa'
import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

export const voiceSettingsStorageKeys = {
  activeSpeechModel: 'settings/speech/active-model',
  activeSpeechProvider: 'settings/speech/active-provider',
  activeSpeechVoice: 'settings/speech/voice',
  activeTranscriptionCustomModel: 'settings/hearing/active-custom-model',
  activeTranscriptionModel: 'settings/hearing/active-model',
  activeTranscriptionProvider: 'settings/hearing/active-provider',
  providerCredentials: 'settings/credentials/providers',
  textChatSpeechProfile: 'settings/speech/output-profile/text-chat',
  voiceConversationPreferences: 'settings/voice-conversation/preferences-v2',
  voiceConversationSpeechProfile: 'settings/speech/output-profile/voice-conversation',
} as const

export type VoiceSettingsStorageKey = typeof voiceSettingsStorageKeys[keyof typeof voiceSettingsStorageKeys]

interface VoiceSettingsChangedPayload {
  keys: VoiceSettingsStorageKey[]
}

const VOICE_SETTINGS_CHANNEL_NAME = 'airi:voice-settings-sync'
const voiceSettingsChangedEvent = defineEventa<VoiceSettingsChangedPayload>('eventa:event:voice-settings:changed')
const allowedStorageKeys = new Set<VoiceSettingsStorageKey>(Object.values(voiceSettingsStorageKeys))

let channel: BroadcastChannel | undefined
let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined

function getVoiceSettingsSyncContext() {
  channel ??= new BroadcastChannel(VOICE_SETTINGS_CHANNEL_NAME)
  context ??= createBroadcastChannelContext(channel).context
  return context
}

function sanitizeStorageKeys(value: unknown): VoiceSettingsStorageKey[] {
  if (!Array.isArray(value))
    return []

  return [...new Set(value.filter((key): key is VoiceSettingsStorageKey => (
    typeof key === 'string' && allowedStorageKeys.has(key as VoiceSettingsStorageKey)
  )))]
}

/**
 * Signals another renderer that persisted voice configuration changed. Values,
 * including provider credentials, never cross the Eventa transport.
 */
export function notifyVoiceSettingsChanged(keys: VoiceSettingsStorageKey[]) {
  const safeKeys = sanitizeStorageKeys(keys)
  if (safeKeys.length === 0)
    return

  getVoiceSettingsSyncContext().emit(voiceSettingsChangedEvent, { keys: safeKeys })
}

export function onVoiceSettingsChanged(listener: (keys: VoiceSettingsStorageKey[]) => void) {
  const subscription = getVoiceSettingsSyncContext().on(voiceSettingsChangedEvent, (event) => {
    const safeKeys = sanitizeStorageKeys(event?.body?.keys)
    if (safeKeys.length > 0)
      listener(safeKeys)
  })

  return subscription
}
