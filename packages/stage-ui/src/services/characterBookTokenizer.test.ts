import { describe, expect, it, vi } from 'vitest'

import { CharacterBookTokenizerRegistry, resolveCharacterBookTokenizer } from './characterBookTokenizer'

describe('character book tokenizer registry', () => {
  it('maps only explicit compatible model families', () => {
    expect(resolveCharacterBookTokenizer('official-provider', 'gpt-4o-mini')?.kind).toBe('tiktoken-o200k')
    expect(resolveCharacterBookTokenizer('openrouter-ai', 'openai/gpt-4.1')?.kind).toBe('tiktoken-o200k')
    expect(resolveCharacterBookTokenizer('azure-openai', 'gpt-4-turbo')?.kind).toBe('tiktoken-cl100k')
    expect(resolveCharacterBookTokenizer('openai-compatible', 'gpt-4o')).toBeUndefined()
    expect(resolveCharacterBookTokenizer('ollama', 'Qwen/Qwen2.5-7B-Instruct')).toMatchObject({
      kind: 'huggingface',
      tokenizerModelId: 'Qwen/Qwen2.5-7B-Instruct',
    })
    expect(resolveCharacterBookTokenizer('openrouter', 'Qwen/Qwen2.5-7B-Instruct')).toBeUndefined()
    expect(resolveCharacterBookTokenizer('ollama', 'unmapped:latest')).toBeUndefined()
  })

  it('deduplicates concurrent loads and exposes a counter only after success', async () => {
    let release: ((counter: (text: string) => number) => void) | undefined
    const loadTiktoken = vi.fn(() => new Promise<(text: string) => number>((resolve) => {
      release = resolve
    }))
    const registry = new CharacterBookTokenizerRegistry({
      loadHuggingFace: vi.fn(),
      loadTiktoken,
    })

    const first = registry.prepare('official-provider', 'gpt-4o')
    const second = registry.prepare('openrouter-ai', 'openai/gpt-4o-mini')
    expect(registry.snapshot('official-provider', 'gpt-4o').status).toBe('loading')
    expect(registry.counter('official-provider', 'gpt-4o')).toBeUndefined()
    expect(loadTiktoken).toHaveBeenCalledTimes(1)

    release?.(text => text.length)
    await expect(first).resolves.toMatchObject({ status: 'ready', exact: true })
    await expect(second).resolves.toMatchObject({ status: 'ready', exact: true })
    expect(registry.counter('openrouter-ai', 'openai/gpt-4o-mini')?.('中文')).toBe(2)
  })

  it('returns explicit unsupported and failed states without an estimate', async () => {
    const registry = new CharacterBookTokenizerRegistry({
      loadHuggingFace: vi.fn(),
      loadTiktoken: vi.fn().mockRejectedValue(new Error('load failed')),
    })

    await expect(registry.prepare('custom', 'unknown-model')).resolves.toMatchObject({
      status: 'unsupported',
      reason: 'model-not-mapped',
    })
    await expect(registry.prepare('official-provider', 'gpt-4o')).resolves.toMatchObject({
      status: 'failed',
      reason: 'tokenizer-load-failed',
    })
    expect(registry.counter('official-provider', 'gpt-4o')).toBeUndefined()
  })

  it('loads the bundled OpenAI rank data and counts Chinese text', async () => {
    const registry = new CharacterBookTokenizerRegistry()
    await expect(registry.prepare('official-provider', 'gpt-4o-mini')).resolves.toMatchObject({ status: 'ready' })
    const count = registry.counter('official-provider', 'gpt-4o-mini')?.('你好，栖遥。')
    expect(count).toBeTypeOf('number')
    expect(count).toBeGreaterThan(0)
  })
})
