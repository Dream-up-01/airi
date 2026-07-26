import { describe, expect, it } from 'vitest'

import { resolveVoiceConversationSetupIssue } from './readiness'

describe('voice conversation setup readiness', () => {
  it('accepts a fully configured microphone-to-playback chain', () => {
    expect(resolveVoiceConversationSetupIssue({
      hearingConfigured: true,
      chatConfigured: true,
      speechConfigured: true,
      requiresCloudPrivacyAcknowledgement: true,
      cloudPrivacyAcknowledged: true,
    })).toBeUndefined()
  })

  it.each([
    {
      input: { hearingConfigured: false, chatConfigured: false, speechConfigured: false },
      expected: { code: 'hearing_not_configured', errorCode: 'hearing_not_configured', cancelReason: 'asr-error' },
    },
    {
      input: { hearingConfigured: true, chatConfigured: false, speechConfigured: false },
      expected: { code: 'chat_not_configured', errorCode: 'chat_not_configured', cancelReason: 'chat-error' },
    },
    {
      input: { hearingConfigured: true, chatConfigured: true, speechConfigured: false },
      expected: { code: 'speech_not_configured', errorCode: 'speech_not_configured', cancelReason: 'tts-error' },
    },
    {
      input: {
        hearingConfigured: true,
        chatConfigured: true,
        speechConfigured: true,
        requiresCloudPrivacyAcknowledgement: true,
        cloudPrivacyAcknowledged: false,
      },
      expected: {
        code: 'cloud_tts_privacy_not_acknowledged',
        errorCode: 'cloud_tts_privacy_not_acknowledged',
        cancelReason: 'tts-error',
      },
    },
  ])('returns the first missing dependency in pipeline order', ({ input, expected }) => {
    expect(resolveVoiceConversationSetupIssue(input)).toEqual(expected)
  })
})
