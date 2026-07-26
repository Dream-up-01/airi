import type { CharacterBookTokenCounter, CharacterBookTokenizerSnapshot } from '../services/characterBookTokenizer'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { characterBookTokenizerRegistry } from '../services/characterBookTokenizer'

const initialSnapshot: CharacterBookTokenizerSnapshot = {
  status: 'idle',
  exact: false,
  reason: 'missing-provider-or-model',
}

/** Reactive application facade over the model-specific lazy tokenizer registry. */
export const useCharacterBookTokenizerStore = defineStore('character-book-tokenizer', () => {
  const currentSnapshot = ref<CharacterBookTokenizerSnapshot>(initialSnapshot)
  let generation = 0

  async function prepare(providerId?: string, modelId?: string): Promise<CharacterBookTokenizerSnapshot> {
    const currentGeneration = ++generation
    currentSnapshot.value = {
      providerId,
      modelId,
      status: 'loading',
      exact: false,
    }
    const resolved = await characterBookTokenizerRegistry.prepare(providerId, modelId)
    if (currentGeneration === generation)
      currentSnapshot.value = resolved
    return resolved
  }

  function counter(providerId?: string, modelId?: string): CharacterBookTokenCounter | undefined {
    return characterBookTokenizerRegistry.counter(providerId, modelId)
  }

  return {
    currentSnapshot,
    prepare,
    counter,
  }
})
