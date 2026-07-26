import type { EphemeralScreenFrame, ScreenFrameReleaseReason } from './screen-latest-frame'

import { describe, expect, it, vi } from 'vitest'

import { ScreenLatestFrameScheduler } from './screen-latest-frame'

function frame(frameId: string, generation: number) {
  const reasons: ScreenFrameReleaseReason[] = []
  return {
    value: {
      frameId,
      generation,
      capturedAt: 1_000,
      byteLength: 128,
      release: (reason: ScreenFrameReleaseReason) => reasons.push(reason),
    } satisfies EphemeralScreenFrame,
    reasons,
  }
}

describe('screen latest-frame scheduler', () => {
  it('keeps one in-flight frame and replaces only the pending latest frame', async () => {
    let finishFirst!: () => void
    const processed: string[] = []
    const scheduler = new ScreenLatestFrameScheduler({
      generation: 1,
      async process(value) {
        processed.push(value.frameId)
        if (value.frameId === 'frame:1') {
          await new Promise<void>((resolve) => {
            finishFirst = resolve
          })
        }
      },
    })
    const first = frame('frame:1', 1)
    const replaced = frame('frame:2', 1)
    const latest = frame('frame:3', 1)

    expect(scheduler.offer(first.value)).toBe('processing')
    expect(scheduler.offer(replaced.value)).toBe('queued-latest')
    expect(scheduler.offer(latest.value)).toBe('queued-latest')
    expect(replaced.reasons).toEqual(['replaced-by-latest'])
    expect(scheduler.stats()).toMatchObject({ inFlight: true, hasLatestFrame: true, replacedFrames: 1 })

    finishFirst()
    await vi.waitFor(() => expect(processed).toEqual(['frame:1', 'frame:3']))
    await vi.waitFor(() => expect(scheduler.stats().inFlight).toBe(false))

    expect(first.reasons).toEqual(['processed'])
    expect(latest.reasons).toEqual(['processed'])
  })

  it('aborts and releases the old generation before accepting a new frame', async () => {
    let finishOld!: () => void
    let oldSignal!: AbortSignal
    const processed: string[] = []
    const scheduler = new ScreenLatestFrameScheduler({
      generation: 1,
      async process(value, signal) {
        processed.push(value.frameId)
        if (value.frameId === 'frame:old') {
          oldSignal = signal
          await new Promise<void>((resolve) => {
            finishOld = resolve
          })
        }
      },
    })
    const old = frame('frame:old', 1)
    const stale = frame('frame:stale', 1)
    const current = frame('frame:current', 2)

    scheduler.offer(old.value)
    scheduler.switchGeneration(2)
    expect(oldSignal.aborted).toBe(true)
    expect(old.reasons).toEqual(['generation-switched'])
    expect(scheduler.offer(stale.value)).toBe('rejected')
    expect(stale.reasons).toEqual(['stale-generation'])
    expect(scheduler.offer(current.value)).toBe('queued-latest')

    finishOld()
    await vi.waitFor(() => expect(processed).toEqual(['frame:old', 'frame:current']))
    await vi.waitFor(() => expect(scheduler.stats().inFlight).toBe(false))
    expect(current.reasons).toEqual(['processed'])
  })

  it('globally stops current and queued frames idempotently', () => {
    const scheduler = new ScreenLatestFrameScheduler({
      generation: 1,
      process: () => new Promise<void>(() => undefined),
    })
    const current = frame('frame:current', 1)
    const latest = frame('frame:latest', 1)
    const afterStop = frame('frame:after-stop', 1)

    scheduler.offer(current.value)
    scheduler.offer(latest.value)
    scheduler.stop()
    scheduler.stop()

    expect(current.reasons).toEqual(['scheduler-stopped'])
    expect(latest.reasons).toEqual(['scheduler-stopped'])
    expect(scheduler.offer(afterStop.value)).toBe('rejected')
    expect(afterStop.reasons).toEqual(['scheduler-stopped'])
    expect(scheduler.stats()).toMatchObject({ stopped: true, hasLatestFrame: false })
  })

  it('reports only a stable processing error code', async () => {
    const onError = vi.fn()
    const scheduler = new ScreenLatestFrameScheduler({
      generation: 1,
      process: async () => {
        throw new Error('raw provider or frame details')
      },
      onError,
    })
    const failed = frame('frame:failed', 1)

    scheduler.offer(failed.value)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('screen-frame-processing-failed'))
    expect(scheduler.stats().failedFrames).toBe(1)
    expect(failed.reasons).toEqual(['processed'])
  })
})
