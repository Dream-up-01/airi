import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preprocessCharacterSource } from '../domains/characterSource'
import { useCharacterExtractionStore } from './characterExtraction'
import { useCharacterSourceImportStore } from './characterSourceImport'

const providerRequest = {
  apiKey: 'not-a-real-key',
  baseURL: 'https://provider.invalid/v1/',
  model: 'test-model',
  providerId: 'test-provider',
}

const getProviderInstance = vi.hoisted(() => vi.fn())

vi.mock('./providers', () => ({
  useProvidersStore: () => ({ getProviderInstance }),
}))

describe('character source import store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getProviderInstance.mockReset()
    getProviderInstance.mockResolvedValue({ chat: () => providerRequest })
  })

  it('adopts a completed reactive extraction draft for review', async () => {
    const document = preprocessCharacterSource({
      displayName: 'character.txt',
      contentHash: '0123456789abcdef'.repeat(4),
      text: '角色名：栖遥\n性格：沉稳。',
    })
    const extractionStore = useCharacterExtractionStore()
    await extractionStore.startExtraction(document, providerRequest, {
      discoverCandidates: async () => [{
        candidateId: 'candidate:qiyao',
        name: '栖遥',
        aliases: [],
        evidenceBlockIds: ['block-00001'],
        ambiguity: 'clear',
      }],
      extractFacts: async () => [{
        factId: 'fact:qiyao:name',
        candidateId: 'candidate:qiyao',
        category: 'identity',
        predicate: 'name',
        value: '栖遥',
        supportStatus: 'explicit',
        evidenceBlockIds: ['block-00001'],
        quote: '角色名：栖遥',
        evidenceValidation: 'unverified',
      }],
    })
    expect(extractionStore.completedDraft?.name?.value).toBe('栖遥')

    vi.spyOn(extractionStore, 'startExtraction').mockResolvedValue()
    const importStore = useCharacterSourceImportStore()
    await importStore.startFromDocument({
      document,
      providerId: providerRequest.providerId,
      model: providerRequest.model,
      cloudConfirmed: true,
    })

    expect(importStore.step).toBe('reviewing')
    expect(importStore.errorCode).toBeNull()
    expect(importStore.editableDraft?.name?.value).toBe('栖遥')
    expect(importStore.editableDraft).not.toBe(extractionStore.completedDraft)
  })
})
