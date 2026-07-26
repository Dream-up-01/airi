import { exportToJSON, exportToPNG, parseCharacterCardV3Json, parseCharacterCardV3Png } from '@proj-airi/ccc'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { validateCompanionPreset } from '../../domains/companion'
import { prepareCompanionCard } from '../../services/companion'
import { useCharacterSourceImportStore } from '../characterSourceImport'
import { useCompanionPresetStore } from '../companion'
import { useSettingsStageModel } from '../settings/stage-model'
import { useAiriCardStore } from './airi-card'

vi.mock('./artistry', async () => {
  const { defineStore } = await import('pinia')

  return {
    useArtistryStore: defineStore('artistry', {
      state: () => ({
        globalProvider: 'mock-artistry-provider',
        globalModel: 'mock-artistry-model',
        globalPromptPrefix: 'mock-artistry-prefix',
        globalProviderOptions: {},
        activeProvider: 'mock-artistry-provider',
        activeModel: 'mock-artistry-model',
        defaultPromptPrefix: 'mock-artistry-prefix',
        providerOptions: {},
      }),
      actions: {
        resetToGlobal() {},
      },
    }),
  }
})

vi.mock('./consciousness', async () => {
  const { defineStore } = await import('pinia')

  return {
    useConsciousnessStore: defineStore('consciousness', {
      state: () => ({
        activeProvider: 'mock-consciousness-provider',
        activeModel: 'mock-consciousness-model',
      }),
    }),
  }
})

vi.mock('./speech', async () => {
  const { defineStore } = await import('pinia')

  return {
    useSpeechStore: defineStore('speech', {
      state: () => ({
        activeSpeechProvider: 'mock-speech-provider',
        activeSpeechModel: 'mock-speech-model',
        activeSpeechVoiceId: 'mock-speech-voice',
      }),
    }),
  }
})

vi.mock('./vision', async () => {
  const { defineStore } = await import('pinia')

  return {
    useVisionStore: defineStore('vision', {
      state: () => ({
        activeProvider: 'mock-vision-provider',
        activeModel: 'mock-vision-model',
      }),
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('airi-card store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('persists selected module config on active card', () => {
    const stageModelStore = useSettingsStageModel()
    stageModelStore.stageModelSelected = 'preset-live2d-1'

    const cardStore = useAiriCardStore()
    cardStore.initialize()

    expect(cardStore.updateActiveCardDisplayModel('display-model-iru-v2')).toBe(true)
    expect(cardStore.updateActiveCardConsciousness({ provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' })).toBe(true)
    expect(cardStore.updateActiveCardVision({ provider: 'ollama', model: 'llava' })).toBe(true)
    expect(cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules).toMatchObject({
      displayModelId: 'display-model-iru-v2',
      consciousness: { provider: 'openrouter-ai', model: 'anthropic/claude-sonnet' },
      vision: { provider: 'ollama', model: 'llava' },
      speech: { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' },
    })
    expect(stageModelStore.stageModelSelected).toBe('preset-live2d-1')
  })

  it('updates speech config on the active card', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()

    expect(cardStore.updateActiveCardSpeech({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice_id: 'aria' })).toBe(true)
    expect(cardStore.activeCard?.extensions.airi.modules.speech).toMatchObject({
      provider: 'elevenlabs',
      model: 'eleven_multilingual_v2',
      voice_id: 'aria',
    })
  })

  it('preserves a CCv3 character book during import', () => {
    const cardStore = useAiriCardStore()
    const cardId = cardStore.addCard({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '栖遥',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        alternate_greetings: [],
        character_book: {
          entries: [{
            id: 'rule-1',
            keys: ['浮光镇'],
            content: '浮光镇终年多雾。',
            enabled: true,
            insertion_order: 1,
            extensions: {},
          }],
          extensions: {},
        },
        character_version: '1.0.0',
        creator: '',
        creator_notes: '',
        extensions: {},
        post_history_instructions: '',
        system_prompt: '',
        tags: [],
        group_only_greetings: [],
      },
    })

    expect(cardStore.getCard(cardId)?.characterBook).toEqual({
      entries: [{
        id: 'rule-1',
        keys: ['浮光镇'],
        content: '浮光镇终年多雾。',
        enabled: true,
        insertion_order: 1,
        extensions: {},
      }],
      extensions: {},
    })
  })

  it('round-trips complete lorebook semantics through AIRI Card and JSON/PNG', () => {
    const cardStore = useAiriCardStore()
    const source = {
      spec: 'chara_card_v3' as const,
      spec_version: '3.0' as const,
      data: {
        name: '栖遥',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        alternate_greetings: [],
        character_book: {
          name: '浮光世界',
          description: '完整世界书',
          scan_depth: 5,
          token_budget: 640,
          recursive_scanning: true,
          entries: [{
            id: 'location-library',
            keys: ['^旧图书馆$'],
            secondary_keys: ['浮光镇'],
            content: '旧图书馆位于浮光镇北侧。',
            enabled: true,
            insertion_order: 3,
            use_regex: true,
            selective: true,
            case_sensitive: true,
            position: 'before_char' as const,
            extensions: { vendor_entry: { preserved: true } },
          }],
          extensions: { vendor_book: { preserved: true } },
        },
        character_version: '1.0.0',
        creator: '',
        creator_notes: '',
        extensions: { vendor_card: { preserved: true } },
        post_history_instructions: '',
        system_prompt: '',
        tags: [],
        group_only_greetings: [],
      },
    }
    const airiCard = cardStore.getCard(cardStore.addCard(source))!
    const jsonResult = parseCharacterCardV3Json(JSON.stringify(exportToJSON(airiCard)))
    const onePixelPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    const pngResult = parseCharacterCardV3Png(exportToPNG(airiCard, onePixelPng))

    expect(jsonResult.success).toBe(true)
    expect(pngResult.success).toBe(true)
    if (jsonResult.success && pngResult.success) {
      expect(jsonResult.value.data.character_book).toEqual(source.data.character_book)
      expect(pngResult.value.data.character_book).toEqual(source.data.character_book)
    }
  })

  it('rejects an invalid CCv3 lorebook before mutating card state', () => {
    const cardStore = useAiriCardStore()

    expect(() => cardStore.addCard({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Invalid',
        character_book: {} as never,
      } as never,
    })).toThrowError('Character Card V3 validation failed.')
    expect(cardStore.cards.size).toBe(0)
  })

  it('rejects malformed lorebooks on neutral Card inputs', () => {
    const cardStore = useAiriCardStore()
    const cardCount = cardStore.cards.size

    expect(() => cardStore.addCard({
      name: 'invalid-neutral-card',
      version: '1.0.0',
      characterBook: { entries: [{ enabled: true }] } as never,
    })).toThrow('Character book validation failed')
    expect(cardStore.cards.size).toBe(cardCount)
  })

  it('restores the previous card after companion activation', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const result = validateCompanionPreset({
      schema_version: 1,
      id: 'qiyao-cn-companion',
      version: '0.1.0',
      identity: {
        name: '栖遥',
        description: '一名成年 AI 虚拟陪伴角色。',
      },
      behavior: {
        personality: ['温和'],
        primary_scenarios: ['日常聊天'],
        greeting: '你好，我是栖遥。',
      },
    })
    if (!result.success)
      throw new Error('Expected the fixture to pass validation.')

    const prepared = prepareCompanionCard(result.value, { fallbackModules: cardStore.currentModels })
    const snapshot = cardStore.upsertAndActivateCard(prepared.cardId, prepared.card)

    expect(cardStore.activeCardId).toBe('companion:qiyao-cn-companion')
    expect(cardStore.systemPrompt.match(/【角色身份】/gu)).toHaveLength(1)

    cardStore.restoreCardActivation(snapshot)

    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.getCard('companion:qiyao-cn-companion')).toBeUndefined()
  })

  it('does not mutate active card state when companion preview validation fails', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const presetStore = useCompanionPresetStore()

    expect(presetStore.previewParsedPreset({ schema_version: 2 }, 'invalid.yaml')).toBe(false)
    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.cards.size).toBe(1)
    expect(presetStore.canActivate).toBe(false)
  })

  it('requires explicit confirmation before replacing a duplicate companion preset ID', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const presetStore = useCompanionPresetStore()
    const preset = {
      schema_version: 1,
      id: 'qiyao-cn-companion',
      version: '0.1.0',
      identity: {
        name: '栖遥',
        description: '一名尊重边界的成年 AI 虚拟陪伴角色。',
      },
      behavior: {
        personality: ['温和', '自然'],
        primary_scenarios: ['日常聊天', '学习陪伴'],
        greeting: '你好，我是栖遥。',
      },
    }

    expect(presetStore.previewParsedPreset(preset, 'qiyao.yaml')).toBe(true)
    expect(presetStore.activatePreview()).toBe('companion:qiyao-cn-companion')

    expect(presetStore.previewParsedPreset({ ...preset, version: '0.2.0' }, 'qiyao-v0.2.yaml')).toBe(true)
    expect(presetStore.willReplaceExistingCard).toBe(true)
    expect(presetStore.canActivate).toBe(false)
    expect(presetStore.activatePreview()).toBeUndefined()

    presetStore.confirmReplacement()

    expect(presetStore.canActivate).toBe(true)
    expect(presetStore.activatePreview()).toBe('companion:qiyao-cn-companion')
    expect(cardStore.activeCard?.version).toBe('0.2.0')
  })

  it('deactivates a companion without an in-memory activation snapshot', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const result = validateCompanionPreset({
      schema_version: 1,
      id: 'qiyao-cn-companion',
      version: '0.1.0',
      identity: {
        name: '栖遥',
        description: '一名尊重边界的成年 AI 虚拟陪伴角色。',
      },
      behavior: {
        personality: ['温和'],
        primary_scenarios: ['日常聊天'],
        greeting: '你好，我是栖遥。',
      },
    })
    if (!result.success)
      throw new Error('Expected the fixture to pass validation.')

    const prepared = prepareCompanionCard(result.value, {
      fallbackModules: cardStore.currentModels,
      previousActiveCardId: 'default',
    })
    cardStore.upsertAndActivateCard(prepared.cardId, prepared.card)
    cardStore.clearCardActivationSnapshot()

    // Clearing the exact snapshot models recovery from older persisted state;
    // the companion card's origin metadata remains the fallback boundary.
    const presetStore = useCompanionPresetStore()

    expect(presetStore.lastActivation).toBeUndefined()
    expect(presetStore.canRestore).toBe(true)
    expect(presetStore.restorePrevious()).toBe(true)
    expect(cardStore.activeCardId).toBe('default')
    expect(cardStore.getCard(prepared.cardId)).toBeDefined()
  })

  it('restores a replaced companion card from the latest activation snapshot', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const firstPreset = validateCompanionPreset({
      schema_version: 1,
      id: 'qiyao',
      version: '0.1.0',
      identity: {
        name: '栖遥',
        description: '一名尊重边界的成年 AI 虚拟陪伴角色。',
      },
      behavior: {
        personality: ['温和'],
        primary_scenarios: ['日常聊天'],
        greeting: '你好，我是栖遥。',
      },
    })
    if (!firstPreset.success)
      throw new Error('Expected the first replacement fixture to pass validation.')
    const firstCard = prepareCompanionCard(firstPreset.value, {
      fallbackModules: cardStore.currentModels,
      previousActiveCardId: 'default',
    })
    cardStore.upsertAndActivateCard(firstCard.cardId, firstCard.card)
    cardStore.clearCardActivationSnapshot()

    const secondPreset = validateCompanionPreset({
      ...firstPreset.value,
      version: '0.2.0',
    })
    if (!secondPreset.success)
      throw new Error('Expected the second replacement fixture to pass validation.')
    const secondCard = prepareCompanionCard(secondPreset.value, {
      fallbackModules: cardStore.currentModels,
      previousActiveCardId: 'default',
    })
    cardStore.upsertAndActivateCard(secondCard.cardId, secondCard.card)
    const presetStore = useCompanionPresetStore()

    expect(presetStore.lastActivation?.previousCard?.version).toBe('0.1.0')
    expect(presetStore.restorePrevious()).toBe(true)
    expect(cardStore.getCard('companion:qiyao')?.version).toBe('0.1.0')
    expect(cardStore.activeCardId).toBe('default')
    expect(presetStore.lastActivation).toBeUndefined()
  })

  it('rejects an exact rollback when its previous active card no longer exists', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const originId = cardStore.addCard({
      name: 'Temporary origin',
      version: '1.0.0',
    })
    cardStore.activateCard(originId)
    const snapshot = cardStore.upsertAndActivateCard('companion:test', {
      name: 'Companion',
      version: '1.0.0',
    })
    cardStore.removeCard(originId)

    expect(cardStore.restoreCardActivation(snapshot)).toBe(false)
    expect(cardStore.activeCardId).toBe('companion:test')
  })

  it('creates an imported draft exactly once without activating it', () => {
    const cardStore = useAiriCardStore()
    cardStore.initialize()
    const activeBefore = cardStore.activeCardId
    const sizeBefore = cardStore.cards.size
    const importStore = useCharacterSourceImportStore()
    importStore.step = 'confirming'
    importStore.editableDraft = {
      schemaVersion: 1,
      draftId: 'draft-once',
      documentId: 'source-once',
      selectedCandidateId: 'candidate-once',
      name: {
        value: '栖遥',
        supportStatus: 'explicit',
        evidenceBlockIds: [],
        quote: '',
        evidenceValidation: 'verified',
        userConfirmed: true,
        origin: 'user',
        sourceFactIds: [],
      },
      description: undefined,
      story: [],
      relationships: [],
      personality: [],
      scenario: undefined,
      languageStyle: {
        tone: [],
        addressTerms: [],
        pronouns: [],
        sentencePatterns: [],
        vocabulary: [],
        catchphrases: [],
        emotionalExpression: [],
        prohibitedExpressions: [],
      },
      greetings: [],
      messageExamples: [],
      loreBook: {},
      loreEntries: [],
      facts: [],
      confirmedFactIds: [],
      conflicts: [],
      unclassifiedBlockIds: [],
      unclassifiedExcerpts: [],
      promptSectionSources: [],
      blockingReasonCodes: [],
      exportWarningCodes: [],
      warningCodes: [],
    }

    const firstCardId = importStore.confirmAndCreateCard()
    const repeatedCardId = importStore.confirmAndCreateCard()

    expect(firstCardId).toBeTruthy()
    expect(repeatedCardId).toBe(firstCardId)
    expect(cardStore.cards.size).toBe(sizeBefore + 1)
    expect(cardStore.activeCardId).toBe(activeBefore)
  })
})
