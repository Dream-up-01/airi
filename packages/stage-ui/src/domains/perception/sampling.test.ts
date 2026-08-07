import { describe, expect, it } from 'vitest'

import {
  defaultPerceptionSamplingRate,
  parsePerceptionSamplingRate,
  PERCEPTION_SAMPLING_RATES,
  perceptionSamplingIntervalMs,
} from './sampling'

describe('perception sampling contract', () => {
  it('accepts only the five bounded rates', () => {
    expect(PERCEPTION_SAMPLING_RATES).toEqual([1, 2, 5, 10, 30])
    expect(parsePerceptionSamplingRate(30)).toBe(30)
    expect(parsePerceptionSamplingRate('10')).toBe(10)
    expect(parsePerceptionSamplingRate(3)).toBeUndefined()
    expect(parsePerceptionSamplingRate(Number.NaN)).toBeUndefined()
    expect(parsePerceptionSamplingRate('30.0')).toBeUndefined()
  })

  it('preserves current scheduler defaults by source', () => {
    expect(defaultPerceptionSamplingRate('screen')).toBe(2)
    expect(defaultPerceptionSamplingRate('camera')).toBe(10)
  })

  it('converts rates to integer intervals', () => {
    expect(perceptionSamplingIntervalMs(1)).toBe(1_000)
    expect(perceptionSamplingIntervalMs(2)).toBe(500)
    expect(perceptionSamplingIntervalMs(5)).toBe(200)
    expect(perceptionSamplingIntervalMs(10)).toBe(100)
    expect(perceptionSamplingIntervalMs(30)).toBe(34)
  })
})
