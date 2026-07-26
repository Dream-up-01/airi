import { describe, expect, it } from 'vitest'

import {
  createAsrTranscriptAccumulator,
  isLikelyNonSpeechTranscript,
  normalizeAsrTranscript,
  reduceAsrTranscriptSegment,
} from './transcript'

describe('voice conversation ASR transcript normalization', () => {
  it('normalizes Mandarin whitespace and repeated punctuation without changing mixed English names', () => {
    expect(normalizeAsrTranscript('我 今天  有点累。。')).toBe('我今天有点累。')
    expect(normalizeAsrTranscript('DeepSeek  V4   Flash 和 Gemma 4 e4b')).toBe('DeepSeek V4 Flash 和 Gemma 4 e4b')
    expect(normalizeAsrTranscript('你好   ，  栖遥……')).toBe('你好，栖遥……')
  })

  it('identifies empty, marker, punctuation-only, and short filler inputs', () => {
    expect(isLikelyNonSpeechTranscript('')).toBe(true)
    expect(isLikelyNonSpeechTranscript('[silence]')).toBe(true)
    expect(isLikelyNonSpeechTranscript('。。。')).toBe(true)
    expect(isLikelyNonSpeechTranscript('嗯')).toBe(true)
    expect(isLikelyNonSpeechTranscript('嗯。')).toBe(true)
    expect(isLikelyNonSpeechTranscript('啊！')).toBe(true)
    expect(isLikelyNonSpeechTranscript('嗯，我今天有点累')).toBe(false)
  })

  it('keeps partial transcript UI-only and final transcript separate', () => {
    const initial = createAsrTranscriptAccumulator('turn-1')
    const partial = reduceAsrTranscriptSegment(initial, {
      segmentId: 'segment-1',
      turnId: 'turn-1',
      text: '我 今天',
      isFinal: false,
    })

    expect(partial.ok).toBe(true)
    if (!partial.ok)
      throw new Error('expected ok partial')
    expect(partial.accepted).toBe(true)
    if (!partial.accepted)
      throw new Error('expected accepted partial')

    expect(partial.partialText).toBe('我今天')
    expect(partial.accumulator.finalText).toBe('')

    const final = reduceAsrTranscriptSegment(partial.accumulator, {
      segmentId: 'segment-2',
      turnId: 'turn-1',
      text: '我 今天 有点累',
      isFinal: true,
    })

    expect(final.ok).toBe(true)
    if (!final.ok)
      throw new Error('expected ok final')
    expect(final.accepted).toBe(true)
    if (!final.accepted)
      throw new Error('expected accepted final')

    expect(final.finalText).toBe('我今天有点累')
    expect(final.accumulator.partialText).toBe('')
  })

  it('deduplicates repeated provider segments and repeated final text', () => {
    const initial = createAsrTranscriptAccumulator('turn-1')
    const first = reduceAsrTranscriptSegment(initial, {
      segmentId: 'segment-1',
      providerSegmentId: 'provider-1',
      turnId: 'turn-1',
      text: '你好栖遥',
      isFinal: true,
    })
    if (!first.ok || !first.accepted)
      throw new Error('expected first segment to be accepted')

    const duplicateProviderSegment = reduceAsrTranscriptSegment(first.accumulator, {
      segmentId: 'segment-2',
      providerSegmentId: 'provider-1',
      turnId: 'turn-1',
      text: '你好栖遥',
      isFinal: true,
    })

    expect(duplicateProviderSegment).toMatchObject({
      ok: true,
      accepted: false,
      reason: 'duplicate-segment',
    })

    const duplicateText = reduceAsrTranscriptSegment(first.accumulator, {
      segmentId: 'segment-3',
      turnId: 'turn-1',
      text: '你好栖遥',
      isFinal: true,
    })

    expect(duplicateText).toMatchObject({
      ok: true,
      accepted: false,
      reason: 'duplicate-text',
    })
  })

  it('merges overlapping final transcript chunks deterministically', () => {
    const initial = createAsrTranscriptAccumulator('turn-1')
    const first = reduceAsrTranscriptSegment(initial, {
      segmentId: 'segment-1',
      turnId: 'turn-1',
      text: '我今天有点累',
      isFinal: true,
    })
    if (!first.ok || !first.accepted)
      throw new Error('expected first segment to be accepted')

    const second = reduceAsrTranscriptSegment(first.accumulator, {
      segmentId: 'segment-2',
      turnId: 'turn-1',
      text: '有点累，但是想学习',
      isFinal: true,
    })
    if (!second.ok || !second.accepted)
      throw new Error('expected second segment to be accepted')

    expect(second.finalText).toBe('我今天有点累，但是想学习')
  })

  it('rejects stale turn ASR segments without mutating the accumulator', () => {
    const initial = createAsrTranscriptAccumulator('turn-1')
    const result = reduceAsrTranscriptSegment(initial, {
      segmentId: 'segment-old',
      turnId: 'turn-old',
      text: '旧文本',
      isFinal: true,
    })

    expect(result).toEqual({
      ok: false,
      accumulator: initial,
      reason: 'stale-turn',
    })
  })
})
