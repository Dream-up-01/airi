// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useSpeechOutputRoutingStore } from './speech-output-routing'

describe('speech output routing store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('exposes an empty profile pair before either speech context is configured', () => {
    const store = useSpeechOutputRoutingStore()

    expect(store.profiles).toEqual({
      textChat: null,
      voiceConversation: null,
    })
  })

  it('keeps typed-chat and voice-conversation output selections separate', () => {
    const store = useSpeechOutputRoutingStore()
    store.setProfile('text-chat', { providerId: 'gpt-sovits-local', modelId: 'airi-firefly-v4', voiceId: 'airi-firefly' })
    store.setProfile('voice-conversation', { providerId: 'minimax-speech', modelId: 'speech-2.8-turbo', voiceId: 'Mandarin_Gentle_Woman' })

    expect(store.profileFor('text-chat').profile?.providerId).toBe('gpt-sovits-local')
    expect(store.profileFor('voice-conversation').profile?.providerId).toBe('minimax-speech')
  })

  it('drops incomplete persisted selections', () => {
    const store = useSpeechOutputRoutingStore()
    store.setProfile('voice-conversation', { providerId: 'minimax-speech', modelId: '', voiceId: '' })

    expect(store.voiceConversationProfile).toBeNull()
    expect(store.profileFor('voice-conversation').profile).toBeNull()
  })

  it('persists profiles as JSON and restores them in a new Pinia instance', async () => {
    const store = useSpeechOutputRoutingStore()
    store.setProfile('voice-conversation', {
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      voiceId: 'Mandarin_Gentle_Woman',
    })
    await nextTick()

    expect(localStorage.getItem('settings/speech/output-profile/voice-conversation')).toBe(JSON.stringify({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      voiceId: 'Mandarin_Gentle_Woman',
    }))

    setActivePinia(createPinia())
    expect(useSpeechOutputRoutingStore().profileFor('voice-conversation').profile).toEqual({
      providerId: 'minimax-speech',
      modelId: 'speech-2.8-turbo',
      voiceId: 'Mandarin_Gentle_Woman',
    })
  })

  it('treats profiles corrupted by the legacy serializer as unconfigured', () => {
    localStorage.setItem('settings/speech/output-profile/voice-conversation', '[object Object]')

    const store = useSpeechOutputRoutingStore()

    expect(store.voiceConversationProfile).toBeNull()
    expect(store.profileFor('voice-conversation').profile).toBeNull()
  })
})
