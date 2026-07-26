import type { ScreenAnalyzerSelection } from './contracts'

export const screenActivityKinds = [
  'video',
  'game',
  'document',
  'code',
  'browser',
  'chat',
  'meeting',
  'idle',
  'unknown',
] as const

export type ScreenActivityKind = typeof screenActivityKinds[number]
export type ScreenCaptureSurfaceState = 'visible' | 'minimized' | 'source-ended'
export type ScreenChangeGateDropReason
  = | 'self-capture'
    | 'sensitive-surface'
    | 'surface-not-visible'
    | 'stale-generation'
    | 'source-mismatch'
    | 'invalid-signal'
    | 'unchanged'
    | 'cadence-limited'

export interface ScreenFrameSignal {
  sourceId: string
  generation: number
  capturedAt: number
  monotonicTimestamp: number
  /** A non-reversible 64-bit perceptual hash. Raw pixels are never retained here. */
  perceptualHash: string
  surfaceState: ScreenCaptureSurfaceState
  ownedByCurrentApp: boolean
  sensitiveSurface: boolean
}

export interface ScreenChangeGateDecision {
  accepted: boolean
  reason: 'initial-frame' | 'significant-change' | 'periodic-refresh' | ScreenChangeGateDropReason
  changeRatio: number
  cadence: 'active' | 'normal' | 'still'
  nextEligibleAt: number
}

export interface ScreenChangeGateOptions {
  significantChangeRatio?: number
  activeIntervalMs?: number
  normalIntervalMs?: number
  activeWindowMs?: number
  /** Optional local-only refresh; omit to preserve zero-FPS behavior for static cloud routes. */
  unchangedRefreshIntervalMs?: number
}

const HASH_PATTERN = /^[0-9a-f]{16}$/
const SET_BITS_PER_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const

/**
 * Decides whether a derived screen signal may create an ephemeral observation.
 * It retains only the last 64-bit perceptual hash and timing metadata.
 */
export class ScreenChangeGate {
  readonly #significantChangeRatio: number
  readonly #activeIntervalMs: number
  readonly #normalIntervalMs: number
  readonly #activeWindowMs: number
  readonly #unchangedRefreshIntervalMs?: number
  #sourceId = ''
  #generation = 0
  #lastAcceptedHash?: string
  #lastAcceptedMonotonic?: number
  #lastSignificantMonotonic?: number

  constructor(options: ScreenChangeGateOptions = {}) {
    this.#significantChangeRatio = options.significantChangeRatio ?? 0.125
    this.#activeIntervalMs = options.activeIntervalMs ?? 1_000
    this.#normalIntervalMs = options.normalIntervalMs ?? 5_000
    this.#activeWindowMs = options.activeWindowMs ?? 10_000
    this.#unchangedRefreshIntervalMs = options.unchangedRefreshIntervalMs

    if (this.#significantChangeRatio <= 0 || this.#significantChangeRatio > 1)
      throw new Error('screen_change_ratio_invalid')
    if (![this.#activeIntervalMs, this.#normalIntervalMs, this.#activeWindowMs].every(value => Number.isInteger(value) && value > 0))
      throw new Error('screen_change_cadence_invalid')
    if (this.#activeIntervalMs > this.#normalIntervalMs)
      throw new Error('screen_change_cadence_invalid')
    if (this.#unchangedRefreshIntervalMs !== undefined
      && (!Number.isInteger(this.#unchangedRefreshIntervalMs) || this.#unchangedRefreshIntervalMs < this.#normalIntervalMs)) {
      throw new Error('screen_change_cadence_invalid')
    }
  }

  reset(sourceId: string, generation: number): void {
    if (!sourceId || !Number.isInteger(generation) || generation < 1)
      throw new Error('screen_change_generation_invalid')
    this.#sourceId = sourceId
    this.#generation = generation
    this.#lastAcceptedHash = undefined
    this.#lastAcceptedMonotonic = undefined
    this.#lastSignificantMonotonic = undefined
  }

  stop(): void {
    this.#sourceId = ''
    this.#generation = 0
    this.#lastAcceptedHash = undefined
    this.#lastAcceptedMonotonic = undefined
    this.#lastSignificantMonotonic = undefined
  }

  evaluate(signal: ScreenFrameSignal): ScreenChangeGateDecision {
    const invalid = !signal.sourceId
      || !Number.isInteger(signal.generation)
      || signal.generation < 1
      || !Number.isFinite(signal.capturedAt)
      || !Number.isFinite(signal.monotonicTimestamp)
      || signal.monotonicTimestamp < 0
      || !HASH_PATTERN.test(signal.perceptualHash)
    if (invalid)
      return this.#drop('invalid-signal', signal.monotonicTimestamp, 'still')
    if (signal.generation !== this.#generation)
      return this.#drop('stale-generation', signal.monotonicTimestamp, 'still')
    if (signal.sourceId !== this.#sourceId)
      return this.#drop('source-mismatch', signal.monotonicTimestamp, 'still')
    if (signal.ownedByCurrentApp)
      return this.#drop('self-capture', signal.monotonicTimestamp, 'still')
    if (signal.sensitiveSurface)
      return this.#drop('sensitive-surface', signal.monotonicTimestamp, 'still')
    if (signal.surfaceState !== 'visible')
      return this.#drop('surface-not-visible', signal.monotonicTimestamp, 'still')

    if (!this.#lastAcceptedHash || this.#lastAcceptedMonotonic === undefined) {
      this.#accept(signal)
      return {
        accepted: true,
        reason: 'initial-frame',
        changeRatio: 1,
        cadence: 'active',
        nextEligibleAt: signal.monotonicTimestamp + this.#activeIntervalMs,
      }
    }

    if (signal.monotonicTimestamp < this.#lastAcceptedMonotonic)
      return this.#drop('invalid-signal', signal.monotonicTimestamp, 'still')

    const changeRatio = perceptualHashDistance(this.#lastAcceptedHash, signal.perceptualHash)
    if (changeRatio < this.#significantChangeRatio) {
      if (this.#unchangedRefreshIntervalMs !== undefined
        && signal.monotonicTimestamp >= this.#lastAcceptedMonotonic + this.#unchangedRefreshIntervalMs) {
        this.#accept(signal, false)
        return {
          accepted: true,
          reason: 'periodic-refresh',
          changeRatio,
          cadence: 'normal',
          nextEligibleAt: signal.monotonicTimestamp + this.#unchangedRefreshIntervalMs,
        }
      }
      return this.#drop('unchanged', signal.monotonicTimestamp, 'still', changeRatio)
    }

    const isActive = this.#lastSignificantMonotonic !== undefined
      && signal.monotonicTimestamp - this.#lastSignificantMonotonic <= this.#activeWindowMs
    const cadence = isActive ? 'active' : 'normal'
    const interval = isActive ? this.#activeIntervalMs : this.#normalIntervalMs
    const nextEligibleAt = this.#lastAcceptedMonotonic + interval
    if (signal.monotonicTimestamp < nextEligibleAt)
      return this.#drop('cadence-limited', signal.monotonicTimestamp, cadence, changeRatio, nextEligibleAt)

    this.#accept(signal)
    return {
      accepted: true,
      reason: 'significant-change',
      changeRatio,
      cadence,
      nextEligibleAt: signal.monotonicTimestamp + this.#activeIntervalMs,
    }
  }

  #accept(signal: ScreenFrameSignal, significant = true): void {
    this.#lastAcceptedHash = signal.perceptualHash
    this.#lastAcceptedMonotonic = signal.monotonicTimestamp
    if (significant)
      this.#lastSignificantMonotonic = signal.monotonicTimestamp
  }

  #drop(
    reason: ScreenChangeGateDropReason,
    monotonicTimestamp: number,
    cadence: ScreenChangeGateDecision['cadence'],
    changeRatio = 0,
    nextEligibleAt = monotonicTimestamp,
  ): ScreenChangeGateDecision {
    return { accepted: false, reason, changeRatio, cadence, nextEligibleAt }
  }
}

/** Keeps screen analyzer modes mutually exclusive and generation-aware. */
export class ScreenAnalyzerSelectionController {
  #selection: ScreenAnalyzerSelection

  constructor(initial: ScreenAnalyzerSelection = { mode: 'off', generation: 1 }) {
    if (!Number.isInteger(initial.generation) || initial.generation < 1)
      throw new Error('screen_analyzer_generation_invalid')
    this.#selection = { ...initial }
  }

  get selection(): ScreenAnalyzerSelection {
    return { ...this.#selection }
  }

  select(mode: ScreenAnalyzerSelection['mode']): { changed: boolean, previous: ScreenAnalyzerSelection, current: ScreenAnalyzerSelection } {
    const previous = this.selection
    if (mode === previous.mode)
      return { changed: false, previous, current: previous }

    this.#selection = { mode, generation: previous.generation + 1 }
    return { changed: true, previous, current: this.selection }
  }
}

function perceptualHashDistance(left: string, right: string): number {
  let changedBits = 0
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16)
    changedBits += SET_BITS_PER_NIBBLE[xor]!
  }
  return changedBits / 64
}
