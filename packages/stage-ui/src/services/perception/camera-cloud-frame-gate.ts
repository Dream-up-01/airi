export const CAMERA_CLOUD_MAX_JPEG_BYTES = 190 * 1024
export const CAMERA_CLOUD_MAX_BASE64_BYTES = 256 * 1024

export type CameraCloudResolution = '640x360' | '960x540'
export type CameraCloudFrameDropReason
  = | 'stale-generation'
    | 'invalid-frame'
    | 'payload-too-large'
    | 'privacy-blocked'
    | 'background'
    | 'no-person'
    | 'unchanged'
    | 'busy'
    | 'cadence-limited'

export interface CameraCloudFrameCandidate {
  frameId: string
  generation: number
  capturedAt: number
  monotonicTimestamp: number
  width: number
  height: number
  jpegBytes: Uint8Array
  significantVisualChange: boolean
  personPresent: boolean
  foreground: boolean
  privacyMode: boolean
  busy: boolean
  release: (reason: CameraCloudFrameDropReason) => void
}

export type CameraCloudFrameDecision
  = | { accepted: true, nextEligibleAt: number, encodedBase64Bytes: number }
    | { accepted: false, reason: CameraCloudFrameDropReason, nextEligibleAt: number }

/**
 * Memory-only cloud camera admission gate. It keeps timing metadata only and never
 * retains the JPEG candidate after returning from `evaluate`.
 */
export class CameraCloudFrameGate {
  readonly #generation: number
  readonly #width: number
  readonly #height: number
  readonly #intervalMs: number
  #lastAcceptedMonotonic?: number

  constructor(options: { generation: number, resolution?: CameraCloudResolution, fpsMax?: number }) {
    if (!Number.isInteger(options.generation) || options.generation < 1)
      throw new Error('camera_cloud_generation_invalid')
    const fpsMax = options.fpsMax ?? 1
    if (!Number.isFinite(fpsMax) || fpsMax <= 0 || fpsMax > 1)
      throw new Error('camera_cloud_cadence_invalid')
    const [width, height] = (options.resolution ?? '640x360').split('x').map(Number)
    this.#generation = options.generation
    this.#width = width!
    this.#height = height!
    this.#intervalMs = Math.ceil(1_000 / fpsMax)
  }

  evaluate(candidate: CameraCloudFrameCandidate): CameraCloudFrameDecision {
    const nextEligibleAt = (this.#lastAcceptedMonotonic ?? candidate.monotonicTimestamp) + this.#intervalMs
    if (candidate.generation !== this.#generation)
      return this.#drop(candidate, 'stale-generation', nextEligibleAt)
    if (!isValidCandidate(candidate, this.#width, this.#height))
      return this.#drop(candidate, 'invalid-frame', nextEligibleAt)

    const encodedBase64Bytes = Math.ceil(candidate.jpegBytes.byteLength / 3) * 4
    if (candidate.jpegBytes.byteLength > CAMERA_CLOUD_MAX_JPEG_BYTES || encodedBase64Bytes > CAMERA_CLOUD_MAX_BASE64_BYTES)
      return this.#drop(candidate, 'payload-too-large', nextEligibleAt)
    if (candidate.privacyMode)
      return this.#drop(candidate, 'privacy-blocked', nextEligibleAt)
    if (!candidate.foreground)
      return this.#drop(candidate, 'background', nextEligibleAt)
    if (!candidate.personPresent)
      return this.#drop(candidate, 'no-person', nextEligibleAt)
    if (!candidate.significantVisualChange)
      return this.#drop(candidate, 'unchanged', nextEligibleAt)
    if (candidate.busy)
      return this.#drop(candidate, 'busy', nextEligibleAt)
    if (this.#lastAcceptedMonotonic !== undefined && candidate.monotonicTimestamp < nextEligibleAt)
      return this.#drop(candidate, 'cadence-limited', nextEligibleAt)

    this.#lastAcceptedMonotonic = candidate.monotonicTimestamp
    return {
      accepted: true,
      encodedBase64Bytes,
      nextEligibleAt: candidate.monotonicTimestamp + this.#intervalMs,
    }
  }

  #drop(candidate: CameraCloudFrameCandidate, reason: CameraCloudFrameDropReason, nextEligibleAt: number): CameraCloudFrameDecision {
    candidate.release(reason)
    return { accepted: false, reason, nextEligibleAt }
  }
}

function isValidCandidate(candidate: CameraCloudFrameCandidate, width: number, height: number): boolean {
  return !!candidate.frameId
    && Number.isInteger(candidate.generation)
    && Number.isInteger(candidate.capturedAt)
    && candidate.capturedAt >= 0
    && Number.isFinite(candidate.monotonicTimestamp)
    && candidate.monotonicTimestamp >= 0
    && candidate.width === width
    && candidate.height === height
    && candidate.jpegBytes.byteLength >= 4
    && candidate.jpegBytes[0] === 0xFF
    && candidate.jpegBytes[1] === 0xD8
    && candidate.jpegBytes.at(-2) === 0xFF
    && candidate.jpegBytes.at(-1) === 0xD9
}
