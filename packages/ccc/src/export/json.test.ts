import type { Card } from '../define'

import { getMetadata } from 'meta-png'
import { describe, expect, it } from 'vitest'

import { parseCharacterCardV3Json, parseCharacterCardV3Png } from '../validation'
import { exportToJSON } from './json'
import { exportToPNG } from './png'
import { CardExportPrivacyException } from './privacy'

describe('cCv3 JSON export', () => {
  it('preserves the complete standard character book contract', () => {
    const card: Card = {
      name: '栖遥',
      version: '1.0.0',
      characterBook: {
        name: '浮光世界',
        description: '角色所在世界的基础资料。',
        scan_depth: 4,
        token_budget: 768,
        recursive_scanning: true,
        extensions: { vendor_flag: true },
        entries: [{
          id: 'location-library',
          name: '旧图书馆',
          keys: ['旧图书馆', '^藏书楼$'],
          secondary_keys: ['浮光镇'],
          content: '旧图书馆位于浮光镇北侧。',
          enabled: true,
          constant: false,
          selective: true,
          use_regex: true,
          case_sensitive: false,
          position: 'before_char',
          priority: 20,
          insertion_order: 3,
          extensions: { source: 'character-import' },
        }],
      },
    }

    const exported = exportToJSON(card)
    expect(exported.data.character_book).toEqual(card.characterBook)

    const imported = parseCharacterCardV3Json(JSON.stringify(exported))
    expect(imported.success).toBe(true)
    if (imported.success)
      expect(imported.value.data.character_book).toEqual(card.characterBook)
  })

  it('round-trips a standard character book through CCv3 PNG metadata', () => {
    const card: Card = {
      name: '栖遥',
      version: '1.0.0',
      characterBook: {
        entries: [{
          id: 7,
          keys: ['浮光镇'],
          secondary_keys: ['旧图书馆'],
          selective: true,
          content: '旧图书馆位于浮光镇北侧。',
          enabled: true,
          insertion_order: 2,
          position: 'after_char',
          extensions: { preserved: true },
        }],
        extensions: { preserved: true },
      },
    }
    const onePixelPng = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), character => character.charCodeAt(0))
    const png = exportToPNG(card, onePixelPng)

    expect(getMetadata(png, 'ccv3')).toBeTruthy()
    const imported = parseCharacterCardV3Png(png)
    expect(imported.success).toBe(true)
    if (imported.success)
      expect(imported.value.data.character_book).toEqual(card.characterBook)
  })

  it('blocks credentials, local paths, and temporary source metadata before export', () => {
    const card: Card = {
      name: 'unsafe-card',
      version: '1.0.0',
      notes: 'Bearer abcdefghijklmnopqrstuvwxyz',
      extensions: {
        source_hash: 'not-for-distribution',
        nested: { apiKey: 'also-not-for-distribution' },
        path: 'C:\\Users\\alice\\private.txt',
      },
    }

    expect(() => exportToJSON(card)).toThrow(CardExportPrivacyException)
    try {
      exportToJSON(card)
    }
    catch (error) {
      expect(error).toBeInstanceOf(CardExportPrivacyException)
      expect((error as CardExportPrivacyException).issues).toEqual(expect.arrayContaining([
        { code: 'credential_value', path: '$.notes' },
        { code: 'source_metadata', path: '$.extensions.source_hash' },
        { code: 'credential_field', path: '$.extensions.nested.apiKey' },
        { code: 'local_path', path: '$.extensions.path' },
      ]))
    }
  })

  it('allows optional undefined object fields that JSON export omits', () => {
    expect(() => exportToJSON({
      name: 'safe-card',
      version: '1.0.0',
      extensions: { optionalValue: undefined },
    })).not.toThrow()
  })
})
