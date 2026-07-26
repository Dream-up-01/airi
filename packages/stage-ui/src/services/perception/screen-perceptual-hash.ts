/**
 * Produces a bounded 64-bit change-detection hash from an RGBA frame.
 * The caller retains ownership of the pixels; this function stores nothing.
 */
export function createScreenPerceptualHash(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192)
    throw new Error('screen_hash_dimensions_invalid')
  if (rgba.length < width * height * 4)
    throw new Error('screen_hash_payload_invalid')

  const luminance: number[] = []
  for (let row = 0; row < 8; row += 1) {
    const y = Math.min(height - 1, Math.floor(((row + 0.5) * height) / 8))
    for (let column = 0; column < 8; column += 1) {
      const x = Math.min(width - 1, Math.floor(((column + 0.5) * width) / 8))
      const offset = (y * width + x) * 4
      const red = Number(rgba[offset] ?? 0)
      const green = Number(rgba[offset + 1] ?? 0)
      const blue = Number(rgba[offset + 2] ?? 0)
      luminance.push(Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue))
    }
  }

  const average = luminance.reduce((total, value) => total + value, 0) / luminance.length
  let spatialHash = ''
  for (let index = 0; index < 56; index += 4) {
    let nibble = 0
    for (let bit = 0; bit < 4; bit += 1) {
      if (luminance[index + bit]! >= average)
        nibble |= 1 << (3 - bit)
    }
    spatialHash += nibble.toString(16)
  }

  return `${spatialHash}${Math.round(average).toString(16).padStart(2, '0')}`
}
