import { describe, expect, it } from 'vitest'

import { deriveSpeechOutputProfileFromSelection, isSpeechOutputProfile, recoverSpeechOutputProfile, resolveSpeechOutputProfile } from '.'

describe('speech output routing', () => {
  it('resolves independent immutable profiles for typed and voice turns', () => {
    const profiles = {
      textChat: { providerId: 'gpt-sovits-local', modelId: 'airi-firefly-v4', voiceId: 'airi-firefly' },
      voiceConversation: { providerId: 'minimax-speech', modelId: 'speech-2.8-turbo', voiceId: 'Mandarin_Gentle_Woman' },
    }

    const typed = resolveSpeechOutputProfile('text-chat', profiles)
    const voice = resolveSpeechOutputProfile('voice-conversation', profiles)

    expect(typed.profile?.providerId).toBe('gpt-sovits-local')
    expect(voice.profile?.providerId).toBe('minimax-speech')
    expect(typed.profile).not.toBe(profiles.textChat)
  })

  it('refuses incomplete profiles instead of silently picking another provider', () => {
    expect(isSpeechOutputProfile({ providerId: 'minimax-speech', modelId: 'speech-2.8-turbo', voiceId: '' })).toBe(false)
    expect(resolveSpeechOutputProfile('voice-conversation', {
      textChat: null,
      voiceConversation: { providerId: 'minimax-speech', modelId: 'speech-2.8-turbo', voiceId: '' },
    })).toEqual({
      context: 'voice-conversation',
      profile: null,
      reason: 'profile-not-configured',
    })
  })

  it('updates a model variant while preserving an explicitly configured provider voice', () => {
    expect(deriveSpeechOutputProfileFromSelection({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      voiceId: 'account-voice',
    }, {
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-hd',
      voiceId: '',
    }, true)).toEqual({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-hd',
      voiceId: 'account-voice',
    })
  })

  it('does not carry a voice across providers or incomplete untrusted selections', () => {
    expect(deriveSpeechOutputProfileFromSelection({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      voiceId: 'account-voice',
    }, {
      providerId: 'gpt-sovits-local',
      modelId: 'airi-firefly-v4',
      voiceId: '',
    }, true)).toBeNull()
  })

  it('repairs a missing route from same-provider defaults without overriding the active model', () => {
    expect(recoverSpeechOutputProfile({
      activeSelection: {
        providerId: 'minimax-speech',
        modelId: 'speech-2.8-hd',
        voiceId: '',
      },
      providerDefaults: {
        providerId: 'minimax-speech',
        modelId: 'speech-2.8-turbo',
        voiceId: 'account-voice',
      },
    })).toEqual({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-hd',
      voiceId: 'account-voice',
    })
  })

  it('never combines defaults from another provider or restores a blocked provider', () => {
    expect(recoverSpeechOutputProfile({
      activeSelection: {
        providerId: 'minimax-speech',
        modelId: 'speech-2.8-hd',
        voiceId: '',
      },
      providerDefaults: {
        providerId: 'gpt-sovits-local',
        voiceId: 'airi-firefly',
      },
    })).toBeNull()

    expect(recoverSpeechOutputProfile({
      activeSelection: {
        providerId: 'gpt-sovits-local',
        modelId: 'airi-firefly-v4',
        voiceId: 'airi-firefly',
      },
      blockedProviderIds: ['gpt-sovits-local'],
    })).toBeNull()

    expect(recoverSpeechOutputProfile({
      currentProfile: {
        providerId: 'gpt-sovits-local',
        modelId: 'airi-firefly-v4',
        voiceId: 'airi-firefly',
      },
      activeSelection: {
        providerId: 'gpt-sovits-local',
        modelId: 'airi-firefly-v4',
        voiceId: 'airi-firefly',
      },
      blockedProviderIds: ['gpt-sovits-local'],
    })).toBeNull()
  })
})
