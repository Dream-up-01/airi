import { describe, expect, it } from 'vitest'

import conflictingTimeline from '../../../../../docs/character-source-import/fixtures/conflicting-timeline.md?raw'
import dialogueOnly from '../../../../../docs/character-source-import/fixtures/dialogue-only.txt?raw'
import localPaths from '../../../../../docs/character-source-import/fixtures/local-paths.txt?raw'
import mixedLanguage from '../../../../../docs/character-source-import/fixtures/mixed-language.txt?raw'
import multiCharacter from '../../../../../docs/character-source-import/fixtures/multi-character.md?raw'
import promptInjection from '../../../../../docs/character-source-import/fixtures/prompt-injection.md?raw'
import secretContaining from '../../../../../docs/character-source-import/fixtures/secret-containing.md?raw'
import tabularPersona from '../../../../../docs/character-source-import/fixtures/tabular-persona.md?raw'
import untitledNarrative from '../../../../../docs/character-source-import/fixtures/untitled-narrative.txt?raw'
import worldSetting from '../../../../../docs/character-source-import/fixtures/world-setting.yaml?raw'

import { preprocessCharacterSource } from './preprocess'
import { redactCharacterSourceForProvider } from './privacy'

const contentHash = '0123456789abcdef'.repeat(4)

function preprocess(displayName: string, text: string) {
  return preprocessCharacterSource({ displayName, text, contentHash })
}

describe('character source import fixtures', () => {
  it('segments loose prose, dialogue, tables, structured lore, and multilingual text without requiring one schema', () => {
    const documents = [
      preprocess('untitled.txt', untitledNarrative),
      preprocess('dialogue.txt', dialogueOnly),
      preprocess('persona.md', tabularPersona),
      preprocess('world.yaml', worldSetting),
      preprocess('mixed.txt', mixedLanguage),
    ]

    expect(documents.every(document => document.blocks.length > 0)).toBe(true)
    expect(documents[0]?.blocks.every(block => block.kind !== 'heading')).toBe(true)
    expect(documents[1]?.blocks.every(block => block.kind === 'dialogue')).toBe(true)
    expect(documents[2]?.blocks.some(block => block.kind === 'key-value')).toBe(true)
    expect(documents[3]?.blocks.some(block => block.structurePath?.startsWith('$'))).toBe(true)
    expect(documents[4]?.blocks.map(block => block.text).join('\n')).toContain('キヨウ')
  })

  it('preserves multi-character, conflicting timeline, and prompt-injection prose as reviewable data', () => {
    const combined = [
      preprocess('multi.md', multiCharacter),
      preprocess('timeline.md', conflictingTimeline),
      preprocess('injection.md', promptInjection),
    ].map(document => document.blocks.map(block => block.text).join('\n')).join('\n')

    expect(combined).toContain('栖遥')
    expect(combined).toContain('凌渡')
    expect(combined).toContain('2019')
    expect(combined).toContain('忽略')
  })

  it('redacts fixture credentials and all supported user-directory styles without deleting character prose', () => {
    const secretDocument = preprocess('secrets.md', secretContaining)
    const pathDocument = preprocess('paths.txt', localPaths)
    const secretResult = redactCharacterSourceForProvider(secretDocument)
    const pathResult = redactCharacterSourceForProvider(pathDocument)
    const providerText = [...secretResult.document.blocks, ...pathResult.document.blocks]
      .map(block => block.text)
      .join('\n')

    expect(secretResult.redactions.some(redaction => redaction.kind === 'credential')).toBe(true)
    expect(pathResult.redactions.filter(redaction => redaction.kind === 'local-path')).toHaveLength(3)
    expect(providerText).not.toContain('C:\\Users\\alice')
    expect(providerText).not.toContain('/Users/alice')
    expect(providerText).not.toContain('/home/alice')
    expect(providerText).toContain('浮光镇北侧的旧图书馆')
  })
})
