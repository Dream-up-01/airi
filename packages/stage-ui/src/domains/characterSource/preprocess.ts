import type { CharacterSourceBlock, CharacterSourceDocument, CharacterSourceFormat } from './contracts'

import { nanoid } from 'nanoid'
import { integer, maxLength, maxValue, minLength, minValue, number, optional, pipe, safeParse, strictObject, string } from 'valibot'

import { CharacterSourceDocumentSchema } from './contracts'

/** Stable preprocessing failure categories safe to show in import UI. */
export type CharacterSourcePreprocessErrorCode = 'control_character' | 'empty_document' | 'invalid_options' | 'invalid_output' | 'source_too_large'

/** Error raised before any untrusted document content reaches a provider. */
export class CharacterSourcePreprocessError extends Error {
  /** Machine-readable UI localization key. */
  readonly code: CharacterSourcePreprocessErrorCode

  constructor(code: CharacterSourcePreprocessErrorCode, message: string) {
    super(message)
    this.name = 'CharacterSourcePreprocessError'
    this.code = code
  }
}

/** Inputs supplied by a bounded platform file reader. */
export interface PreprocessCharacterSourceOptions {
  /** User-visible name; path components are removed defensively. */
  displayName: string
  /** Content digest calculated locally by the platform adapter. */
  contentHash: string
  /** Decoded UTF-8 text. */
  text: string
  /** Optional language hint from the user or local detector. */
  languageHint?: string
  /** Maximum normalized document length. @default 1,000,000 */
  maxDocumentLength?: number
  /** Maximum block length before controlled overlap splitting. @default 4,000 */
  maxBlockLength?: number
  /** Overlap retained only for oversized blocks. @default 160 */
  blockOverlap?: number
}

interface RawBlock {
  kind: CharacterSourceBlock['kind']
  sourceEnd: number
  sourceStart: number
  text: string
}

const PreprocessCharacterSourceOptionsSchema = strictObject({
  displayName: pipe(string(), minLength(1), maxLength(1_024)),
  contentHash: pipe(string(), minLength(64), maxLength(64)),
  text: string(),
  languageHint: optional(pipe(string(), minLength(2), maxLength(64))),
  maxDocumentLength: optional(pipe(number(), integer(), minValue(1), maxValue(10_000_000))),
  maxBlockLength: optional(pipe(number(), integer(), minValue(1), maxValue(32_000))),
  blockOverlap: optional(pipe(number(), integer(), minValue(0), maxValue(8_000))),
})

const FORMAT_BY_EXTENSION: Record<string, CharacterSourceFormat> = {
  '.docx': 'docx',
  '.json': 'json',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
  '.yaml': 'yaml',
  '.yml': 'yaml',
}

function sanitizeDisplayName(displayName: string): string {
  const leaf = displayName.split(/[\\/]/u).at(-1)?.trim() || 'character-source.txt'
  return leaf.slice(0, 160)
}

function inferFormat(displayName: string): CharacterSourceFormat {
  const dotIndex = displayName.lastIndexOf('.')
  if (dotIndex < 0)
    return 'plain-text'
  return FORMAT_BY_EXTENSION[displayName.slice(dotIndex).toLowerCase()] ?? 'plain-text'
}

function normalizeText(text: string, maxDocumentLength: number): string {
  const normalized = text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  if (!normalized.trim())
    throw new CharacterSourcePreprocessError('empty_document', 'The character source document is empty.')
  if (normalized.length > maxDocumentLength)
    throw new CharacterSourcePreprocessError('source_too_large', `The character source exceeds the ${maxDocumentLength} character limit.`)
  const hasUnsupportedControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 8 || (codePoint >= 11 && codePoint <= 12) || (codePoint >= 14 && codePoint <= 31) || codePoint === 127
  })
  if (hasUnsupportedControlCharacter)
    throw new CharacterSourcePreprocessError('control_character', 'The character source contains unsupported control characters.')
  return normalized
}

function classifyStructuredLine(line: string, nextLine: string | undefined): CharacterSourceBlock['kind'] | undefined {
  if (/^\s{0,3}#{1,6}\s+\S/u.test(line))
    return 'heading'
  if (/^\s*(?:[-*+]\s+|\d+[.)、]\s*)\S/u.test(line))
    return 'list-item'
  if ((line.match(/\|/gu)?.length ?? 0) >= 2 || line.includes('\t'))
    return 'table-row'
  if (/^\s*(?:[“「『].+[”」』]|[^:：\n]{1,24}[:：]\s*[“「『].+[”」』])\s*$/u.test(line))
    return 'dialogue'
  if (/^\s*[^:：\n]{1,48}[:：](?:\s*\S.*)?$/u.test(line))
    return 'key-value'
  // Plain-text headings are intentionally conservative: a complete prose
  // sentence before a blank line must remain evidence, not become a title.
  if (/^\S.{0,30}\S$/u.test(line) && nextLine === '' && !/[。！？.!?；;：:]$/u.test(line))
    return 'heading'
  return undefined
}

function splitRawBlock(raw: RawBlock, maxBlockLength: number, overlap: number): RawBlock[] {
  if (raw.text.length <= maxBlockLength)
    return [raw]

  const blocks: RawBlock[] = []
  let offset = 0
  while (offset < raw.text.length) {
    const end = Math.min(raw.text.length, offset + maxBlockLength)
    blocks.push({
      kind: raw.kind,
      text: raw.text.slice(offset, end),
      sourceStart: raw.sourceStart + offset,
      sourceEnd: raw.sourceStart + end,
    })
    if (end === raw.text.length)
      break
    offset = Math.max(offset + 1, end - overlap)
  }
  return blocks
}

function segmentText(text: string, maxBlockLength: number, overlap: number): CharacterSourceBlock[] {
  const lines = text.split('\n')
  const offsets: number[] = []
  let runningOffset = 0
  for (const line of lines) {
    offsets.push(runningOffset)
    runningOffset += line.length + 1
  }

  const rawBlocks: RawBlock[] = []
  let paragraphStart = -1
  let paragraphLines: string[] = []

  function flushParagraph(): void {
    if (paragraphStart < 0)
      return
    const blockText = paragraphLines.join('\n')
    rawBlocks.push({
      kind: 'paragraph',
      text: blockText,
      sourceStart: paragraphStart,
      sourceEnd: paragraphStart + blockText.length,
    })
    paragraphStart = -1
    paragraphLines = []
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      flushParagraph()
      continue
    }

    const kind = classifyStructuredLine(line, lines[index + 1])
    if (!kind) {
      if (paragraphStart < 0)
        paragraphStart = offsets[index] ?? 0
      paragraphLines.push(line)
      continue
    }

    flushParagraph()
    const sourceStart = offsets[index] ?? 0
    rawBlocks.push({
      kind,
      text: line,
      sourceStart,
      sourceEnd: sourceStart + line.length,
    })
  }
  flushParagraph()

  return rawBlocks
    .flatMap(raw => splitRawBlock(raw, maxBlockLength, overlap))
    .map((raw, order) => ({
      blockId: `block-${String(order + 1).padStart(5, '0')}`,
      order,
      ...raw,
    }))
}

function annotateStructurePaths(blocks: CharacterSourceBlock[], format: CharacterSourceFormat): CharacterSourceBlock[] {
  if (format !== 'json' && format !== 'yaml')
    return blocks

  const ancestors: Array<{ indentation: number, key: string }> = []
  return blocks.map((block) => {
    const firstLine = block.text.split('\n', 1)[0] ?? ''
    let indentation = 0
    while (firstLine[indentation] === ' ' || firstLine[indentation] === '\t')
      indentation++
    let source = firstLine.slice(indentation)
    if (format === 'yaml' && source.startsWith('- '))
      source = source.slice(2)

    let key = ''
    let remainingValue = ''
    if (format === 'json') {
      if (!source.startsWith('"'))
        return block
      let closingQuote = 1
      for (; closingQuote < source.length; closingQuote++) {
        if (source[closingQuote] === '"' && source[closingQuote - 1] !== '\\')
          break
      }
      if (closingQuote >= source.length)
        return block
      const colonIndex = source.indexOf(':', closingQuote + 1)
      if (colonIndex < 0 || source.slice(closingQuote + 1, colonIndex).trim())
        return block
      try {
        const parsedKey: unknown = JSON.parse(source.slice(0, closingQuote + 1))
        if (typeof parsedKey !== 'string')
          return block
        key = parsedKey
      }
      catch {
        return block
      }
      remainingValue = source.slice(colonIndex + 1).trim()
    }
    else {
      const colonIndex = source.indexOf(':')
      if (colonIndex < 1)
        return block
      key = source.slice(0, colonIndex).trim()
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith('\'') && key.endsWith('\'')))
        key = key.slice(1, -1).trim()
      remainingValue = source.slice(colonIndex + 1).trim()
    }
    if (!key || key.length > 96 || key.includes('#'))
      return block

    while (ancestors.length > 0 && ancestors.at(-1)!.indentation >= indentation)
      ancestors.pop()
    const structurePath = `$${[...ancestors.map(ancestor => ancestor.key), key].map(part => `.${part}`).join('')}`
    if (!remainingValue || remainingValue === '{' || remainingValue === '[')
      ancestors.push({ indentation, key })
    return { ...block, structurePath }
  })
}

/**
 * Normalizes and segments arbitrary character text without interpreting any
 * source line as an instruction or discarding unclassified prose.
 */
export function preprocessCharacterSource(options: PreprocessCharacterSourceOptions): CharacterSourceDocument {
  const input = safeParse(PreprocessCharacterSourceOptionsSchema, options)
  if (!input.success || !/^[a-f0-9]{64}$/u.test(options.contentHash))
    throw new CharacterSourcePreprocessError('invalid_options', 'Character source preprocessing options are invalid.')

  const maxDocumentLength = input.output.maxDocumentLength ?? 1_000_000
  const maxBlockLength = input.output.maxBlockLength ?? 4_000
  const blockOverlap = Math.min(input.output.blockOverlap ?? 160, Math.max(0, maxBlockLength - 1))
  const text = normalizeText(input.output.text, maxDocumentLength)
  const displayName = sanitizeDisplayName(input.output.displayName)
  const format = inferFormat(displayName)
  const blocks = annotateStructurePaths(segmentText(text, maxBlockLength, blockOverlap), format)

  const result = safeParse(CharacterSourceDocumentSchema, {
    schemaVersion: 1,
    documentId: `source:${nanoid()}`,
    displayName,
    contentHash: input.output.contentHash,
    format,
    languageHint: input.output.languageHint,
    blocks,
  })
  if (!result.success)
    throw new CharacterSourcePreprocessError('invalid_output', 'Character source preprocessing produced an invalid document contract.')
  return result.output
}
