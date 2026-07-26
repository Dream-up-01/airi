import type { EphemeralScreenFrame } from './screen-latest-frame'

import { describe, expect, it, vi } from 'vitest'

import { ScreenChangeGate } from '../../domains/perception/screen'
import { ScreenLatestFrameScheduler } from './screen-latest-frame'

const TRACE_DURATION_MS = 10 * 60 * 1_000
const SIGNAL_INTERVAL_MS = 500

function traceSignal(monotonicTimestamp: number, perceptualHash: string) {
  return {
    sourceId: 'window:performance-trace',
    generation: 1,
    capturedAt: monotonicTimestamp,
    monotonicTimestamp,
    perceptualHash,
    surfaceState: 'visible' as const,
    ownedByCurrentApp: false,
    sensitiveSurface: false,
  }
}

function runTenMinuteGateTrace(hashAt: (monotonicTimestamp: number) => string) {
  const gate = new ScreenChangeGate()
  gate.reset('window:performance-trace', 1)
  const acceptedAt: number[] = []

  for (let timestamp = 0; timestamp < TRACE_DURATION_MS; timestamp += SIGNAL_INTERVAL_MS) {
    if (gate.evaluate(traceSignal(timestamp, hashAt(timestamp))).accepted)
      acceptedAt.push(timestamp)
  }

  return {
    acceptedAt,
    acceptedFps: acceptedAt.length / (TRACE_DURATION_MS / 1_000),
  }
}

describe('production screen performance policy', () => {
  it('keeps a ten-minute stable trace below the normal 0.2 FPS ceiling', () => {
    const trace = runTenMinuteGateTrace(() => '0000000000000000')

    expect(trace.acceptedAt).toEqual([0])
    expect(trace.acceptedFps).toBeCloseTo(1 / 600, 8)
    expect(trace.acceptedFps).toBeLessThanOrEqual(0.2)
  })

  it('keeps a ten-minute continuously changing trace at the active 1 FPS ceiling', () => {
    const trace = runTenMinuteGateTrace(timestamp =>
      Math.floor(timestamp / 1_000) % 2 === 0 ? '0000000000000000' : 'ffffffffffffffff')

    expect(trace.acceptedAt).toHaveLength(600)
    expect(trace.acceptedFps).toBe(1)
    expect(trace.acceptedAt.every((timestamp, index) => index === 0 || timestamp - trace.acceptedAt[index - 1]! >= 1_000)).toBe(true)
  })

  it('keeps one in-flight analysis and one replaceable latest slot under a 60-frame burst', async () => {
    const resolvers: Array<() => void> = []
    const processed: string[] = []
    let concurrent = 0
    let maxConcurrent = 0
    const scheduler = new ScreenLatestFrameScheduler({
      generation: 1,
      process: async (frame) => {
        processed.push(frame.frameId)
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise<void>(resolve => resolvers.push(resolve))
        concurrent -= 1
      },
    })

    for (let second = 0; second < 60; second += 1) {
      scheduler.offer({
        frameId: `frame:${second}`,
        generation: 1,
        capturedAt: second * 1_000,
        byteLength: 190 * 1_024,
        release: () => undefined,
      } satisfies EphemeralScreenFrame)
    }

    expect(scheduler.stats()).toMatchObject({
      inFlight: true,
      hasLatestFrame: true,
      acceptedFrames: 60,
      replacedFrames: 58,
    })
    expect(processed).toEqual(['frame:0'])
    expect(maxConcurrent).toBe(1)

    resolvers.shift()?.()
    await vi.waitFor(() => expect(processed).toEqual(['frame:0', 'frame:59']))
    expect(maxConcurrent).toBe(1)
    resolvers.shift()?.()
    await vi.waitFor(() => expect(scheduler.stats().inFlight).toBe(false))
    expect(scheduler.stats().hasLatestFrame).toBe(false)
  })
})
