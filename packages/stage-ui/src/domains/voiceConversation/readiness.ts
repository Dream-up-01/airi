import type { VoiceConversationCancelReason, VoiceConversationErrorCode } from './session'

export interface VoiceConversationReadinessInput {
  hearingConfigured: boolean
  chatConfigured: boolean
  speechConfigured: boolean
  requiresCloudPrivacyAcknowledgement?: boolean
  cloudPrivacyAcknowledged?: boolean
}

export type VoiceConversationSetupIssueCode
  = | 'hearing_not_configured'
    | 'chat_not_configured'
    | 'speech_not_configured'
    | 'cloud_tts_privacy_not_acknowledged'

export interface VoiceConversationSetupIssue {
  code: VoiceConversationSetupIssueCode
  errorCode: Extract<VoiceConversationErrorCode, VoiceConversationSetupIssueCode>
  cancelReason: Extract<VoiceConversationCancelReason, 'asr-error' | 'chat-error' | 'tts-error'>
}

/**
 * Returns the first missing dependency in microphone-to-playback order.
 */
export function resolveVoiceConversationSetupIssue(
  input: VoiceConversationReadinessInput,
): VoiceConversationSetupIssue | undefined {
  if (!input.hearingConfigured) {
    return {
      code: 'hearing_not_configured',
      errorCode: 'hearing_not_configured',
      cancelReason: 'asr-error',
    }
  }

  if (!input.chatConfigured) {
    return {
      code: 'chat_not_configured',
      errorCode: 'chat_not_configured',
      cancelReason: 'chat-error',
    }
  }

  if (!input.speechConfigured) {
    return {
      code: 'speech_not_configured',
      errorCode: 'speech_not_configured',
      cancelReason: 'tts-error',
    }
  }

  if (input.requiresCloudPrivacyAcknowledgement && !input.cloudPrivacyAcknowledged) {
    return {
      code: 'cloud_tts_privacy_not_acknowledged',
      errorCode: 'cloud_tts_privacy_not_acknowledged',
      cancelReason: 'tts-error',
    }
  }
}
