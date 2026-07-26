import { describe, expect, it } from 'vitest'

import { preprocessCharacterSource } from './preprocess'

const contentHash = '0123456789abcdef'.repeat(4)

describe('character source preprocessing', () => {
  it('normalizes and classifies mixed-format UTF-8 text', () => {
    const document = preprocessCharacterSource({
      displayName: 'C:\\private\\栖遥.md',
      contentHash,
      text: '\uFEFF# 栖遥\r\n\r\n性格：温和但不敷衍\r\n- 喜欢旧书\r\n栖遥：“先坐一会儿吧。”\r\n\r\n她住在浮光镇北侧。',
    })

    expect(document.displayName).toBe('栖遥.md')
    expect(document.format).toBe('md')
    expect(document.blocks.map(block => block.kind)).toEqual([
      'heading',
      'key-value',
      'list-item',
      'dialogue',
      'paragraph',
    ])
    expect(document.blocks.at(-1)?.text).toBe('她住在浮光镇北侧。')
  })

  it('retains DOCX as the trusted source format after local text extraction', () => {
    const document = preprocessCharacterSource({
      displayName: 'character.docx',
      contentHash,
      text: '角色名：栖遥\n性格：温柔但坚定',
    })

    expect(document.format).toBe('docx')
    expect(document.blocks.map(block => block.kind)).toEqual(['key-value', 'key-value'])
  })

  it('splits oversized paragraphs with bounded overlap and stable IDs', () => {
    const document = preprocessCharacterSource({
      displayName: 'character.txt',
      contentHash,
      text: '一二三四五六七八九十',
      maxBlockLength: 6,
      blockOverlap: 2,
    })

    expect(document.blocks.map(block => block.text)).toEqual(['一二三四五六', '五六七八九十'])
    expect(document.blocks.map(block => block.blockId)).toEqual(['block-00001', 'block-00002'])
    expect(document.blocks.map(block => [block.sourceStart, block.sourceEnd])).toEqual([[0, 6], [4, 10]])
  })

  it('rejects unsupported control characters', () => {
    expect(() => preprocessCharacterSource({
      displayName: 'character.txt',
      contentHash,
      text: '角色\u0000设定',
    })).toThrowError(expect.objectContaining({ code: 'control_character' }))
  })

  it('rejects oversized source instead of silently truncating it', () => {
    expect(() => preprocessCharacterSource({
      displayName: 'character.txt',
      contentHash,
      text: '超过上限',
      maxDocumentLength: 3,
    })).toThrowError(expect.objectContaining({ code: 'source_too_large' }))
  })

  it('rejects caller-provided hashes that are not a trusted SHA-256 digest', () => {
    expect(() => preprocessCharacterSource({
      displayName: 'character.txt',
      contentHash: 'caller-controlled',
      text: '角色设定',
    })).toThrowError(expect.objectContaining({ code: 'invalid_options' }))
  })

  it('retains best-effort hierarchy paths for JSON and YAML blocks', () => {
    const json = preprocessCharacterSource({
      displayName: 'character.json',
      contentHash,
      text: '{\n  "character": {\n    "name": "栖遥"\n  }\n}',
    })
    const yaml = preprocessCharacterSource({
      displayName: 'character.yaml',
      contentHash,
      text: 'character:\n  profile:\n    name: 栖遥',
    })

    expect(json.blocks.find(block => block.text.includes('"name"'))?.structurePath).toBe('$.character.name')
    expect(yaml.blocks.find(block => block.text.includes('name:'))?.structurePath).toBe('$.character.profile.name')
  })

  it('accepts malformed structured text as source data instead of requiring a schema', () => {
    const document = preprocessCharacterSource({
      displayName: 'broken.json',
      contentHash,
      text: '{ "角色": “栖遥”, 这不是有效 JSON',
    })

    expect(document.format).toBe('json')
    expect(document.blocks.map(block => block.text).join('\n')).toContain('这不是有效 JSON')
  })

  it('preserves multilingual multi-character dialogue without selecting a protagonist', () => {
    const document = preprocessCharacterSource({
      displayName: 'dialogue.txt',
      contentHash,
      text: '栖遥：“先坐下吧。”\nAiri:「大丈夫？」\nMina: Are you okay?',
    })

    expect(document.blocks).toHaveLength(3)
    expect(document.blocks.map(block => block.text)).toEqual([
      '栖遥：“先坐下吧。”',
      'Airi:「大丈夫？」',
      'Mina: Are you okay?',
    ])
  })

  it('rejects documents containing only whitespace and a BOM', () => {
    expect(() => preprocessCharacterSource({
      displayName: 'empty.txt',
      contentHash,
      text: '\uFEFF \r\n',
    })).toThrowError(expect.objectContaining({ code: 'empty_document' }))
  })
})
