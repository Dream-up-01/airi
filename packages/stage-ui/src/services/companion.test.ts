import type { AiriExtension } from '../stores/modules/airi-card'

import { describe, expect, it } from 'vitest'

import { validateCompanionPreset } from '../domains/companion'
import { prepareCompanionCard } from './companion'

function preset() {
  const result = validateCompanionPreset({
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
  })

  if (!result.success)
    throw new Error('Expected the fixture to pass validation.')

  return result.value
}

function fallbackModules(): Pick<AiriExtension['modules'], 'consciousness' | 'vision' | 'speech' | 'displayModelId' | 'activeBackgroundId'> {
  return {
    consciousness: { provider: 'openai', model: 'gpt-test' },
    vision: { provider: 'ollama', model: 'vision-test' },
    speech: { provider: 'speech-test', model: 'tts-test', voice_id: 'voice-test' },
    displayModelId: 'display-test',
    activeBackgroundId: 'background-test',
  }
}

describe('companion card preparation', () => {
  it('uses stable IDs and preserves fallback module selections', () => {
    const prepared = prepareCompanionCard(preset(), { fallbackModules: fallbackModules() })

    expect(prepared.cardId).toBe('companion:qiyao-cn-companion')
    expect(prepared.card.extensions.airi.modules.consciousness).toEqual({ provider: 'openai', model: 'gpt-test' })
    expect(prepared.card.extensions.airi.companion?.preset.id).toBe('qiyao-cn-companion')
    expect(prepared.card.systemPrompt?.indexOf('不可覆盖的产品安全')).toBeLessThan(prepared.card.systemPrompt?.indexOf('角色身份') ?? 0)
  })

  it('falls back from unavailable bindings and records restart-safe activation metadata', () => {
    const result = validateCompanionPreset({
      ...preset(),
      model_bindings: {
        consciousness: { provider: 'missing-chat', model: 'missing-model' },
        display_model_id: 'missing-display',
        speech: { provider: 'speech-test', model: 'missing-speech-model', voice_id: 'voice-test' },
        vision: { provider: 'speech-test', model: 'tts-test' },
      },
    })
    if (!result.success)
      throw new Error('Expected the binding fixture to pass schema validation.')

    const prepared = prepareCompanionCard(result.value, {
      availableDisplayModelIds: new Set(['display-test']),
      availableProviderIdsByBinding: {
        consciousness: new Set(['openai', 'speech-test']),
        speech: new Set(['speech-test']),
        vision: new Set(['ollama']),
      },
      fallbackModules: fallbackModules(),
      knownModelsByProvider: new Map([
        ['speech-test', new Set(['tts-test'])],
      ]),
      previousActiveCardId: 'default',
    })

    expect(prepared.card.extensions.airi.modules.consciousness).toEqual({ provider: 'openai', model: 'gpt-test' })
    expect(prepared.card.extensions.airi.modules.speech).toEqual({ provider: 'speech-test', model: 'tts-test', voice_id: 'voice-test' })
    expect(prepared.card.extensions.airi.modules.vision).toEqual({ provider: 'ollama', model: 'vision-test' })
    expect(prepared.card.extensions.airi.modules.displayModelId).toBe('display-test')
    expect(prepared.bindingWarnings).toEqual([
      { binding: 'consciousness', code: 'provider_unavailable', requested: 'missing-chat/missing-model' },
      { binding: 'vision', code: 'provider_unavailable', requested: 'speech-test/tts-test' },
      { binding: 'speech', code: 'model_unavailable', requested: 'speech-test/missing-speech-model' },
      { binding: 'display', code: 'display_model_unavailable', requested: 'missing-display' },
    ])
    expect(prepared.card.extensions.airi.companion?.activation?.previousActiveCardId).toBe('default')
  })
})
