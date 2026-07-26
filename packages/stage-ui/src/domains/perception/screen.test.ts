import { describe, expect, it } from 'vitest'

import {
  screenActivityKinds,
  ScreenAnalyzerSelectionController,
  ScreenChangeGate,
} from './screen'

function signal(overrides: Partial<Parameters<ScreenChangeGate['evaluate']>[0]> = {}) {
  return {
    sourceId: 'window:external',
    generation: 1,
    capturedAt: 1_000,
    monotonicTimestamp: 1_000,
    perceptualHash: '0000000000000000',
    surfaceState: 'visible' as const,
    ownedByCurrentApp: false,
    sensitiveSurface: false,
    ...overrides,
  }
}

describe('screen change gate', () => {
  it('uses the frozen coarse activity vocabulary', () => {
    expect(screenActivityKinds).toEqual([
      'video',
      'game',
      'document',
      'code',
      'browser',
      'chat',
      'meeting',
      'idle',
      'unknown',
    ])
  })

  it('accepts an initial frame and runs at active cadence during significant changes', () => {
    const gate = new ScreenChangeGate()
    gate.reset('window:external', 1)

    expect(gate.evaluate(signal())).toMatchObject({
      accepted: true,
      reason: 'initial-frame',
      cadence: 'active',
    })
    expect(gate.evaluate(signal({
      monotonicTimestamp: 1_500,
      capturedAt: 1_500,
      perceptualHash: 'ffffffffffffffff',
    }))).toMatchObject({ accepted: false, reason: 'cadence-limited' })
    expect(gate.evaluate(signal({
      monotonicTimestamp: 2_000,
      capturedAt: 2_000,
      perceptualHash: 'ffffffffffffffff',
    }))).toMatchObject({
      accepted: true,
      reason: 'significant-change',
      cadence: 'active',
      changeRatio: 1,
    })
  })

  it('uses zero sampling for a fully static signal and ignores minor hash noise', () => {
    const gate = new ScreenChangeGate()
    gate.reset('window:external', 1)
    gate.evaluate(signal())

    expect(gate.evaluate(signal({ monotonicTimestamp: 60_000, capturedAt: 60_000 }))).toMatchObject({
      accepted: false,
      reason: 'unchanged',
      cadence: 'still',
      changeRatio: 0,
    })
    expect(gate.evaluate(signal({
      monotonicTimestamp: 61_000,
      capturedAt: 61_000,
      perceptualHash: '0000000000000001',
    }))).toMatchObject({ accepted: false, reason: 'unchanged' })
  })

  it('allows an explicit local-only periodic refresh without changing the default static cloud behavior', () => {
    const gate = new ScreenChangeGate({ unchangedRefreshIntervalMs: 5_000 })
    gate.reset('window:external', 1)
    gate.evaluate(signal())

    expect(gate.evaluate(signal({ monotonicTimestamp: 5_999, capturedAt: 5_999 }))).toMatchObject({
      accepted: false,
      reason: 'unchanged',
    })
    expect(gate.evaluate(signal({ monotonicTimestamp: 6_000, capturedAt: 6_000 }))).toMatchObject({
      accepted: true,
      reason: 'periodic-refresh',
      cadence: 'normal',
    })
  })

  it('returns to the normal cadence after the active window', () => {
    const gate = new ScreenChangeGate()
    gate.reset('window:external', 1)
    gate.evaluate(signal())

    expect(gate.evaluate(signal({
      monotonicTimestamp: 20_000,
      capturedAt: 20_000,
      perceptualHash: 'ffffffffffffffff',
    }))).toMatchObject({ accepted: true, cadence: 'normal' })
  })

  it.each([
    ['self-capture', { ownedByCurrentApp: true }],
    ['sensitive-surface', { sensitiveSurface: true }],
    ['surface-not-visible', { surfaceState: 'minimized' as const }],
    ['surface-not-visible', { surfaceState: 'source-ended' as const }],
    ['stale-generation', { generation: 2 }],
    ['source-mismatch', { sourceId: 'window:other' }],
  ])('suppresses %s before creating an observation', (reason, overrides) => {
    const gate = new ScreenChangeGate()
    gate.reset('window:external', 1)
    expect(gate.evaluate(signal(overrides))).toMatchObject({ accepted: false, reason })
  })

  it('forgets prior hashes when the source generation changes or capture stops', () => {
    const gate = new ScreenChangeGate()
    gate.reset('window:first', 1)
    gate.evaluate(signal({ sourceId: 'window:first' }))
    gate.reset('screen:second', 2)

    expect(gate.evaluate(signal({
      sourceId: 'screen:second',
      generation: 2,
      monotonicTimestamp: 2_000,
    }))).toMatchObject({ accepted: true, reason: 'initial-frame' })

    gate.stop()
    expect(gate.evaluate(signal({ sourceId: 'screen:second', generation: 2 }))).toMatchObject({
      accepted: false,
      reason: 'stale-generation',
    })
  })
})

describe('screen analyzer selection', () => {
  it('keeps modes mutually exclusive and increments generation only on switch', () => {
    const selection = new ScreenAnalyzerSelectionController()

    expect(selection.select('off')).toMatchObject({ changed: false })
    expect(selection.select('local-qwen3-vl')).toEqual({
      changed: true,
      previous: { mode: 'off', generation: 1 },
      current: { mode: 'local-qwen3-vl', generation: 2 },
    })
    expect(selection.select('cloud-qwen-omni').current).toEqual({
      mode: 'cloud-qwen-omni',
      generation: 3,
    })
  })
})
