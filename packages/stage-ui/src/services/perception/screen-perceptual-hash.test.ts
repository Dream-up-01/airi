import { describe, expect, it } from 'vitest'

import { createScreenPerceptualHash } from './screen-perceptual-hash'

function solidRgba(value: number) {
  const rgba = new Uint8ClampedArray(8 * 8 * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  return rgba
}

describe('screen perceptual hash', () => {
  it('returns a fixed non-pixel 64-bit representation', () => {
    const hash = createScreenPerceptualHash(solidRgba(128), 8, 8)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hash).toBe('ffffffffffffff80')
  })

  it('detects a full-frame lighting change without retaining RGBA', () => {
    expect(createScreenPerceptualHash(solidRgba(0), 8, 8)).not.toBe(
      createScreenPerceptualHash(solidRgba(255), 8, 8),
    )
  })

  it('rejects invalid dimensions and truncated pixel input', () => {
    expect(() => createScreenPerceptualHash([], 0, 8)).toThrow('screen_hash_dimensions_invalid')
    expect(() => createScreenPerceptualHash(new Uint8Array(4), 8, 8)).toThrow('screen_hash_payload_invalid')
  })
})
