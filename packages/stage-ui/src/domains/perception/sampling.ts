export const PERCEPTION_SAMPLING_RATES = [1, 2, 5, 10, 30] as const

export type PerceptionSamplingRate = typeof PERCEPTION_SAMPLING_RATES[number]
export type PerceptionSamplingSource = 'screen' | 'camera'

export const PERCEPTION_SAMPLING_DEFAULTS: Readonly<Record<PerceptionSamplingSource, PerceptionSamplingRate>> = {
  screen: 2,
  camera: 10,
}

/** Maximum cloud admission rate remains governed by the existing provider gates. */
export const PERCEPTION_CLOUD_MAX_EFFECTIVE_RATE: Readonly<Record<PerceptionSamplingSource, 1>> = {
  screen: 1,
  camera: 1,
}

const PERCEPTION_SAMPLING_RATE_PATTERN = /^(?:[125]|10|30)$/u

export function parsePerceptionSamplingRate(value: unknown): PerceptionSamplingRate | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !PERCEPTION_SAMPLING_RATES.includes(value as PerceptionSamplingRate))
      return undefined
    return value as PerceptionSamplingRate
  }

  if (typeof value !== 'string' || !PERCEPTION_SAMPLING_RATE_PATTERN.test(value))
    return undefined
  return Number(value) as PerceptionSamplingRate
}

export function defaultPerceptionSamplingRate(source: PerceptionSamplingSource): PerceptionSamplingRate {
  return PERCEPTION_SAMPLING_DEFAULTS[source]
}

export function perceptionSamplingIntervalMs(rate: PerceptionSamplingRate): number {
  return Math.ceil(1_000 / rate)
}
