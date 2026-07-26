export type ScreenFrameReleaseReason
  = | 'processed'
    | 'analyzer-not-ready'
    | 'invalid-frame-metadata'
    | 'replaced-by-latest'
    | 'stale-generation'
    | 'generation-switched'
    | 'scheduler-stopped'

export interface EphemeralScreenFrame {
  frameId: string
  generation: number
  capturedAt: number
  byteLength: number
  release: (reason: ScreenFrameReleaseReason) => void
}

export interface ScreenLatestFrameSchedulerStats {
  generation: number
  stopped: boolean
  inFlight: boolean
  hasLatestFrame: boolean
  acceptedFrames: number
  replacedFrames: number
  staleFrames: number
  failedFrames: number
}

export interface ScreenLatestFrameSchedulerOptions<TFrame extends EphemeralScreenFrame> {
  generation: number
  process: (frame: TFrame, signal: AbortSignal) => void | Promise<void>
  onError?: (code: 'screen-frame-processing-failed') => void
}

interface ScheduledFrame<TFrame extends EphemeralScreenFrame> {
  frame: TFrame
  released: boolean
}

/** Single in-flight processor with one replaceable latest-frame slot. */
export class ScreenLatestFrameScheduler<TFrame extends EphemeralScreenFrame = EphemeralScreenFrame> {
  readonly #process: ScreenLatestFrameSchedulerOptions<TFrame>['process']
  readonly #onError?: ScreenLatestFrameSchedulerOptions<TFrame>['onError']
  #generation: number
  #stopped = false
  #current?: ScheduledFrame<TFrame> & { controller: AbortController }
  #latest?: ScheduledFrame<TFrame>
  #acceptedFrames = 0
  #replacedFrames = 0
  #staleFrames = 0
  #failedFrames = 0

  constructor(options: ScreenLatestFrameSchedulerOptions<TFrame>) {
    if (!Number.isInteger(options.generation) || options.generation < 1)
      throw new Error('screen_frame_generation_invalid')
    this.#generation = options.generation
    this.#process = options.process
    this.#onError = options.onError
  }

  offer(frame: TFrame): 'processing' | 'queued-latest' | 'rejected' {
    const scheduled = { frame, released: false }
    if (this.#stopped) {
      this.#release(scheduled, 'scheduler-stopped')
      return 'rejected'
    }
    if (frame.generation !== this.#generation) {
      this.#staleFrames += 1
      this.#release(scheduled, 'stale-generation')
      return 'rejected'
    }
    if (!frame.frameId || !Number.isFinite(frame.capturedAt) || !Number.isInteger(frame.byteLength) || frame.byteLength < 0) {
      this.#staleFrames += 1
      this.#release(scheduled, 'stale-generation')
      return 'rejected'
    }

    this.#acceptedFrames += 1
    if (!this.#current) {
      this.#start(scheduled)
      return 'processing'
    }

    if (this.#latest) {
      this.#replacedFrames += 1
      this.#release(this.#latest, 'replaced-by-latest')
    }
    this.#latest = scheduled
    return 'queued-latest'
  }

  switchGeneration(generation: number): void {
    if (!Number.isInteger(generation) || generation <= this.#generation)
      throw new Error('screen_frame_generation_invalid')
    this.#generation = generation
    this.#current?.controller.abort('generation-switched')
    if (this.#current)
      this.#release(this.#current, 'generation-switched')
    if (this.#latest) {
      this.#release(this.#latest, 'generation-switched')
      this.#latest = undefined
    }
  }

  stop(): void {
    if (this.#stopped)
      return
    this.#stopped = true
    this.#current?.controller.abort('scheduler-stopped')
    if (this.#current)
      this.#release(this.#current, 'scheduler-stopped')
    if (this.#latest) {
      this.#release(this.#latest, 'scheduler-stopped')
      this.#latest = undefined
    }
  }

  stats(): ScreenLatestFrameSchedulerStats {
    return {
      generation: this.#generation,
      stopped: this.#stopped,
      inFlight: this.#current !== undefined,
      hasLatestFrame: this.#latest !== undefined,
      acceptedFrames: this.#acceptedFrames,
      replacedFrames: this.#replacedFrames,
      staleFrames: this.#staleFrames,
      failedFrames: this.#failedFrames,
    }
  }

  #start(scheduled: ScheduledFrame<TFrame>): void {
    const current = { ...scheduled, controller: new AbortController() }
    this.#current = current
    void Promise.resolve(this.#process(current.frame, current.controller.signal))
      .catch(() => {
        if (!current.controller.signal.aborted) {
          this.#failedFrames += 1
          this.#onError?.('screen-frame-processing-failed')
        }
      })
      .finally(() => {
        this.#release(current, 'processed')
        if (this.#current === current)
          this.#current = undefined

        const latest = this.#latest
        this.#latest = undefined
        if (!latest)
          return
        if (this.#stopped) {
          this.#release(latest, 'scheduler-stopped')
          return
        }
        if (latest.frame.generation !== this.#generation) {
          this.#staleFrames += 1
          this.#release(latest, 'stale-generation')
          return
        }
        this.#start(latest)
      })
  }

  #release(scheduled: ScheduledFrame<TFrame>, reason: ScreenFrameReleaseReason): void {
    if (scheduled.released)
      return
    scheduled.released = true
    scheduled.frame.release(reason)
  }
}
