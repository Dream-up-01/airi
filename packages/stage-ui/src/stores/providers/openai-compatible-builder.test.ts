import { describe, expect, it, vi } from 'vitest'

import { buildOpenAICompatibleProvider } from './openai-compatible-builder'

describe('buildOpenAICompatibleProvider', () => {
  /**
   * @example
   * provider.transcription('FunAudioLLM/SenseVoiceSmall', { language: 'zh' })
   */
  it('preserves transcription extra options for OpenAI-compatible ASR providers', async () => {
    const metadata = buildOpenAICompatibleProvider({
      id: 'test-openai-compatible-transcription',
      name: 'Test Transcription',
      nameKey: 'test.transcription.title',
      description: 'Test transcription provider',
      descriptionKey: 'test.transcription.description',
      icon: 'i-lobe-icons:openai',
      category: 'transcription',
      creator: () => ({
        transcription: (model: string) => ({
          baseURL: 'https://example.com/v1/',
          model,
        }),
      }),
    })

    const provider = await metadata.createProvider({})

    expect('transcription' in provider).toBe(true)
    expect((provider as any).transcription('FunAudioLLM/SenseVoiceSmall', { language: 'zh' })).toEqual({
      baseURL: 'https://example.com/v1/',
      language: 'zh',
      model: 'FunAudioLLM/SenseVoiceSmall',
    })
  })

  it('uses the provider-specific normalized base URL for runtime requests', async () => {
    const creator = vi.fn(() => ({ speech: () => ({}) }))
    const metadata = buildOpenAICompatibleProvider({
      id: 'test-local-speech',
      name: 'Test Local Speech',
      nameKey: 'test.speech.title',
      description: 'Test local speech provider',
      descriptionKey: 'test.speech.description',
      icon: 'i-lobe-icons:openai',
      category: 'speech',
      creator,
      normalizeBaseUrl: value => typeof value === 'string' ? `${value.replace(/\/+$/, '')}/v1/` : undefined,
    })

    await metadata.createProvider({ apiKey: '', baseUrl: 'http://localhost:9888' })

    expect(creator).toHaveBeenCalledWith('', 'http://localhost:9888/v1/')
  })
})
