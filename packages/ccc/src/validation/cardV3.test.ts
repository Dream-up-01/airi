import { describe, expect, it } from 'vitest'

import { parseCharacterCardV3Json, validateCharacterCardV3 } from './cardV3'

function validCard() {
  return {
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
      character_version: '1.0.0',
      creator: '',
      creator_notes: '',
      extensions: { vendor: { enabled: true } },
      post_history_instructions: '',
      system_prompt: '',
      tags: [],
      group_only_greetings: [],
      character_book: {
        entries: [{
          id: 'place-library',
          keys: ['图书馆'],
          secondary_keys: ['浮光镇'],
          content: '图书馆位于浮光镇北侧。',
          enabled: true,
          insertion_order: 2,
          use_regex: false,
          extensions: { source: 'fixture' },
        }],
        extensions: { vendor_book: true },
      },
    },
  }
}

describe('character card V3 validation', () => {
  it('preserves standard lorebook fields and unknown extensions', () => {
    const result = validateCharacterCardV3(validCard())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value.data.character_book?.entries[0]?.id).toBe('place-library')
      expect(result.value.data.character_book?.extensions).toEqual({ vendor_book: true })
      expect(result.value.data.extensions).toEqual({ vendor: { enabled: true } })
    }
  })

  it('rejects a malformed lorebook before it reaches chat state', () => {
    const card = validCard()
    card.data.character_book = { entries: [{}], extensions: {} } as never

    const result = validateCharacterCardV3(card)

    expect(result.success).toBe(false)
    if (result.success === false)
      expect(result.errors.map(error => error.path)).toContain('data.character_book.entries.0.content')
  })

  it('rejects prototype-related extension keys', () => {
    const card = validCard()
    card.data.extensions = JSON.parse('{"__proto__":{"polluted":true}}')

    const result = validateCharacterCardV3(card)

    expect(result).toEqual({
      success: false,
      errors: [expect.objectContaining({ code: 'unsafe_key', path: '$.data.extensions.__proto__' })],
    })
  })

  it('rejects programmatic objects with a modified prototype', () => {
    const card = validCard()
    card.data.extensions = Object.create({ polluted: true }) as Record<string, unknown>

    const result = validateCharacterCardV3(card)

    expect(result).toEqual({
      success: false,
      errors: [expect.objectContaining({ code: 'unsafe_key', path: '$.data.extensions' })],
    })
  })

  it('rejects oversized JSON before parsing application fields', () => {
    const result = parseCharacterCardV3Json(JSON.stringify(validCard()), { maxJsonBytes: 8 })

    expect(result).toEqual({
      success: false,
      errors: [expect.objectContaining({ code: 'resource_limit', path: '$' })],
    })
  })

  it('returns a stable invalid JSON error', () => {
    expect(parseCharacterCardV3Json('{')).toEqual({
      success: false,
      errors: [expect.objectContaining({ code: 'invalid_json', path: '$' })],
    })
  })
})
