import type { AsrSegment } from './session'

export interface AsrTranscriptAccumulator {
  turnId: string
  finalText: string
  partialText: string
  acceptedSegmentIds: readonly string[]
  acceptedProviderSegmentIds: readonly string[]
}

export type AsrTranscriptSegmentResult
  = | {
    ok: true
    accepted: true
    accumulator: AsrTranscriptAccumulator
    finalText?: string
    partialText?: string
  }
  | {
    ok: true
    accepted: false
    accumulator: AsrTranscriptAccumulator
    reason: 'empty' | 'duplicate-segment' | 'duplicate-text'
  }
  | {
    ok: false
    accumulator: AsrTranscriptAccumulator
    reason: 'stale-turn'
  }

const zeroWidthAndBomPattern = /[\u200B-\u200D\uFEFF]/g
const cjkOrKanaPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const cjkOrKanaGlobalPattern = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu
const spaceBeforeChinesePunctuationPattern = /\s+([，。！？、；：）】》”’])/g
const spaceAfterChinesePunctuationBeforeCjkPattern = /([，。！？、；：])\s+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu
const spaceAfterChineseOpeningPattern = /([（【《“‘])\s+/g
const repeatedChinesePunctuationPattern = /([，。！？、；：])\1+/g
const repeatedAsciiPunctuationPattern = /([!?])\1+/g
const ellipsisPattern = /\.{3,}|…{2,}|⋯{2,}/g
const whitespacePattern = /\s+/g
const terminalPunctuationPattern = /[。！？!?，,、；;：:\s]+$/g

const nonSpeechMarkers = new Set([
  '[silence]',
  '[noise]',
  '[empty]',
  '(silence)',
  '(noise)',
  '<silence>',
  '<noise>',
])

const shortFillers = new Set(['嗯', '啊', '呃', '额', '唔', '唉', '呐', '嗯嗯', '啊啊'])

export function createAsrTranscriptAccumulator(turnId: string): AsrTranscriptAccumulator {
  return {
    turnId,
    finalText: '',
    partialText: '',
    acceptedSegmentIds: [],
    acceptedProviderSegmentIds: [],
  }
}

/**
 * Normalizes ASR text without changing the user's meaning.
 *
 * Before:
 * - `"我 今天  有点累。。"`
 * - `"DeepSeek  V4   Flash"`
 *
 * After:
 * - `"我今天有点累。"`
 * - `"DeepSeek V4 Flash"`
 */
export function normalizeAsrTranscript(text: string): string {
  return text
    .replace(zeroWidthAndBomPattern, '')
    .replaceAll('\u3000', ' ')
    .replace(ellipsisPattern, '……')
    .replace(whitespacePattern, ' ')
    .replace(cjkOrKanaGlobalPattern, '$1$2')
    .replace(spaceBeforeChinesePunctuationPattern, '$1')
    .replace(spaceAfterChinesePunctuationBeforeCjkPattern, '$1$2')
    .replace(spaceAfterChineseOpeningPattern, '$1')
    .replace(repeatedChinesePunctuationPattern, '$1')
    .replace(repeatedAsciiPunctuationPattern, '$1')
    .trim()
}

export function isLikelyNonSpeechTranscript(text: string): boolean {
  const normalized = normalizeAsrTranscript(text)
  if (!normalized)
    return true

  const lower = normalized.toLowerCase()
  if (nonSpeechMarkers.has(lower))
    return true

  if (/^[。！？!?，,、；;：:\s]+$/.test(normalized))
    return true

  return shortFillers.has(normalized.replace(terminalPunctuationPattern, ''))
}

export function reduceAsrTranscriptSegment(
  accumulator: AsrTranscriptAccumulator,
  segment: AsrSegment,
): AsrTranscriptSegmentResult {
  if (segment.turnId !== accumulator.turnId) {
    return {
      ok: false,
      accumulator,
      reason: 'stale-turn',
    }
  }

  const providerSegmentId = segment.providerSegmentId?.trim()
  const duplicateSegment = accumulator.acceptedSegmentIds.includes(segment.segmentId)
    || (!!providerSegmentId && accumulator.acceptedProviderSegmentIds.includes(providerSegmentId))
  if (duplicateSegment) {
    return {
      ok: true,
      accepted: false,
      accumulator,
      reason: 'duplicate-segment',
    }
  }

  const text = normalizeAsrTranscript(segment.text)
  if (isLikelyNonSpeechTranscript(text)) {
    return {
      ok: true,
      accepted: false,
      accumulator,
      reason: 'empty',
    }
  }

  const nextIds = [...accumulator.acceptedSegmentIds, segment.segmentId]
  const nextProviderIds = providerSegmentId
    ? [...accumulator.acceptedProviderSegmentIds, providerSegmentId]
    : [...accumulator.acceptedProviderSegmentIds]

  if (!segment.isFinal) {
    return {
      ok: true,
      accepted: true,
      partialText: text,
      accumulator: {
        ...accumulator,
        partialText: text,
        acceptedSegmentIds: nextIds,
        acceptedProviderSegmentIds: nextProviderIds,
      },
    }
  }

  const finalText = mergeFinalTranscript(accumulator.finalText, text)
  if (finalText === accumulator.finalText) {
    return {
      ok: true,
      accepted: false,
      accumulator: {
        ...accumulator,
        acceptedSegmentIds: nextIds,
        acceptedProviderSegmentIds: nextProviderIds,
      },
      reason: 'duplicate-text',
    }
  }

  return {
    ok: true,
    accepted: true,
    finalText,
    accumulator: {
      ...accumulator,
      finalText,
      partialText: '',
      acceptedSegmentIds: nextIds,
      acceptedProviderSegmentIds: nextProviderIds,
    },
  }
}

function mergeFinalTranscript(previous: string, next: string): string {
  if (!previous)
    return next

  if (previous === next || previous.endsWith(next))
    return previous

  if (next.startsWith(previous))
    return next

  const overlap = findTextOverlap(previous, next)
  if (overlap > 0)
    return previous + next.slice(overlap)

  return `${previous}${needsSpaceBetweenTranscriptParts(previous, next) ? ' ' : ''}${next}`
}

function findTextOverlap(previous: string, next: string): number {
  const max = Math.min(previous.length, next.length)
  for (let size = max; size > 0; size--) {
    if (previous.slice(-size) === next.slice(0, size))
      return size
  }
  return 0
}

function needsSpaceBetweenTranscriptParts(previous: string, next: string): boolean {
  const prev = previous.at(-1)
  const first = next.at(0)
  if (!prev || !first)
    return false

  if (cjkOrKanaPattern.test(prev) || cjkOrKanaPattern.test(first))
    return false

  if (/^[，。！？、；：,.!?;:]$/.test(first))
    return false

  return true
}
