import type { CharacterSourceDocument } from './contracts'

/** Sensitive source category removed before an optional cloud extraction call. */
export type CharacterSourceRedactionKind = 'credential' | 'local-path'

/** Location-only redaction notice; it never copies the matched source value. */
export interface CharacterSourceRedaction {
  /** Block containing the replacement. */
  blockId: string
  /** Sensitive value category. */
  kind: CharacterSourceRedactionKind
  /** Half-open source range in the local, unredacted block. */
  originalStart: number
  originalEnd: number
  /** Half-open range of the replacement in the provider copy. */
  redactedStart: number
  redactedEnd: number
}

/** Sanitized provider input and local warnings for user review. */
export interface RedactedCharacterSourceDocument {
  /** Copy safe to send to the explicitly selected provider. */
  document: CharacterSourceDocument
  /** Redaction locations and categories without secret values. */
  redactions: CharacterSourceRedaction[]
}

const CREDENTIAL_PATTERNS = [
  /\bsk-[\w-]{16,}\b/giu,
  /\bgh[pousr]_[a-z0-9]{20,}\b/giu,
  /\bAKIA[A-Z0-9]{16}\b/gu,
  /\bAIza[\w-]{30,}\b/gu,
  /\b(?:hf|xox[baprs])_[a-z0-9-]{20,}\b/giu,
  /\bBearer\s+[\w.~+/=-]{16,}\b/giu,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/giu,
] as const

const LOCAL_PATH_PATTERNS = [
  /\b[A-Z]:\\(?:Users|Documents and Settings)\\[^\s<>:"|?*]+/giu,
  /\/(?:Users|home)\/[^\s/]+(?:\/\S+)*/gu,
] as const

interface SensitiveRange {
  kind: CharacterSourceRedactionKind
  start: number
  end: number
}

function sensitiveRanges(text: string): SensitiveRange[] {
  const candidates: SensitiveRange[] = []
  for (const [kind, patterns] of [
    ['credential', CREDENTIAL_PATTERNS],
    ['local-path', LOCAL_PATH_PATTERNS],
  ] as const) {
    for (const sourcePattern of patterns) {
      const pattern = new RegExp(sourcePattern.source, sourcePattern.flags)
      for (const match of text.matchAll(pattern)) {
        if (match.index !== undefined)
          candidates.push({ kind, start: match.index, end: match.index + match[0].length })
      }
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end || left.kind.localeCompare(right.kind))
  return candidates.filter((range, index, ranges) => index === 0 || range.start >= ranges[index - 1]!.end)
}

function redactBlock(blockId: string, text: string): { text: string, redactions: CharacterSourceRedaction[] } {
  const redactions: CharacterSourceRedaction[] = []
  const output: string[] = []
  let originalCursor = 0
  let redactedCursor = 0
  for (const range of sensitiveRanges(text)) {
    const prefix = text.slice(originalCursor, range.start)
    const replacement = `[REDACTED:${range.kind}]`
    output.push(prefix, replacement)
    redactedCursor += prefix.length
    redactions.push({
      blockId,
      kind: range.kind,
      originalStart: range.start,
      originalEnd: range.end,
      redactedStart: redactedCursor,
      redactedEnd: redactedCursor + replacement.length,
    })
    redactedCursor += replacement.length
    originalCursor = range.end
  }
  output.push(text.slice(originalCursor))
  return { text: output.join(''), redactions }
}

/**
 * Redacts high-confidence credentials and machine-local user paths from the
 * provider copy while leaving ordinary fictional violence or adversarial
 * prose intact as character data.
 */
export function redactCharacterSourceForProvider(document: CharacterSourceDocument): RedactedCharacterSourceDocument {
  const redactions: CharacterSourceRedaction[] = []
  const blocks = document.blocks.map((block) => {
    const result = redactBlock(block.blockId, block.text)
    redactions.push(...result.redactions)
    return { ...block, text: result.text }
  })

  return {
    document: { ...document, blocks },
    redactions,
  }
}
