import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({
  initialValue: undefined as unknown,
  storedValue: undefined as unknown,
}))

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')

  return {
    useLocalStorageManualReset: <T>(_key: string, fallback: T) => {
      const value = vue.ref((storageMock.initialValue ?? fallback) as T)
      vue.watch(value, newValue => storageMock.storedValue = JSON.parse(JSON.stringify(newValue)), {
        deep: true,
        flush: 'sync',
      })

      return Object.assign(value, {
        reset: () => value.value = structuredClone(fallback),
      })
    },
  }
})

describe('voice conversation preferences store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storageMock.initialValue = undefined
    storageMock.storedValue = undefined
  })

  it('normalizes tampered persisted preferences at the store boundary', async () => {
    storageMock.initialValue = {
      mode: 'cloud-always-on',
      interruptionPolicy: 'force-interrupt',
      vadThreshold: 9,
      minSpeechDurationMs: -5,
      trailingSilenceMs: Number.NaN,
      cloudPrivacyAcknowledged: 'yes',
      apiKey: 'must-not-persist',
    }

    const { useVoiceConversationPreferencesStore } = await import('./voiceConversationPreferences')
    const store = useVoiceConversationPreferencesStore()

    expect(store.preferences).toEqual({
      mode: 'streaming-asr',
      interruptionPolicy: 'disabled',
      vadThreshold: 0.9,
      minSpeechDurationMs: 100,
      trailingSilenceMs: 1_600,
      cloudPrivacyAcknowledged: false,
    })
    expect(JSON.stringify(storageMock.storedValue)).not.toContain('must-not-persist')
  })

  it('persists only normalized preference fields', async () => {
    const { useVoiceConversationPreferencesStore } = await import('./voiceConversationPreferences')
    const store = useVoiceConversationPreferencesStore()

    store.update({
      mode: 'streaming-asr',
      interruptionPolicy: 'vadBargeIn',
      vadThreshold: 0,
      cloudPrivacyAcknowledged: true,
    })

    expect(store.preferences).toMatchObject({
      mode: 'streaming-asr',
      interruptionPolicy: 'vadBargeIn',
      vadThreshold: 0.1,
      cloudPrivacyAcknowledged: true,
    })
    expect(Object.keys(storageMock.storedValue as object).sort()).toEqual([
      'cloudPrivacyAcknowledged',
      'interruptionPolicy',
      'minSpeechDurationMs',
      'mode',
      'trailingSilenceMs',
      'vadThreshold',
    ])
  })
})
