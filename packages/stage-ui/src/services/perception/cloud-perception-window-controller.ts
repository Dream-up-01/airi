export type CloudPerceptionWindowCancelReason
  = | 'user-stop'
    | 'permission-revoked'
    | 'generation-stale'
    | 'echo-blocked'
    | 'source-ended'
    | 'timeout'
    | 'unmount'
    | 'app-exit'

export interface CloudPerceptionMediaLease {
  refId: string
  release: (reason: CloudPerceptionWindowCancelReason | 'completed') => void
}

export interface CloudPerceptionWindowStart {
  windowId: string
  sessionId: string
  generation: number
  audioLeases: CloudPerceptionMediaLease[]
  imageLeases: CloudPerceptionMediaLease[]
}

export interface CloudPerceptionWindowStatus {
  windowId?: string
  sessionId?: string
  generation: number
  state: 'idle' | 'active' | 'completed' | 'cancelled'
  audioRefCount: number
  imageRefCount: number
  cancelReason?: CloudPerceptionWindowCancelReason
}

interface ActiveWindow extends CloudPerceptionWindowStart {
  controller: AbortController
  released: boolean
}

/** Owns only lifecycle/cancellation for one bounded cloud perception window. */
export class CloudPerceptionWindowController {
  #active?: ActiveWindow
  #status: CloudPerceptionWindowStatus = {
    generation: 0,
    state: 'idle',
    audioRefCount: 0,
    imageRefCount: 0,
  }

  get status(): CloudPerceptionWindowStatus {
    return { ...this.#status }
  }

  get signal(): AbortSignal | undefined {
    return this.#active?.controller.signal
  }

  start(input: CloudPerceptionWindowStart): AbortSignal {
    if (!input.windowId || !input.sessionId || !Number.isInteger(input.generation) || input.generation < 1)
      throw new Error('cloud_perception_window_invalid')
    if (input.audioLeases.length > 2_000 || input.imageLeases.length > 24)
      throw new Error('cloud_perception_window_too_large')
    if (this.#active)
      this.cancel('generation-stale')

    const active: ActiveWindow = { ...input, controller: new AbortController(), released: false }
    this.#active = active
    this.#status = {
      windowId: input.windowId,
      sessionId: input.sessionId,
      generation: input.generation,
      state: 'active',
      audioRefCount: input.audioLeases.length,
      imageRefCount: input.imageLeases.length,
    }
    return active.controller.signal
  }

  complete(windowId: string, generation: number): boolean {
    const active = this.#active
    if (!active || active.windowId !== windowId || active.generation !== generation)
      return false
    this.#active = undefined
    this.#release(active, 'completed')
    this.#status = { ...this.#status, state: 'completed', audioRefCount: 0, imageRefCount: 0 }
    return true
  }

  cancel(reason: CloudPerceptionWindowCancelReason): boolean {
    const active = this.#active
    if (!active)
      return false
    this.#active = undefined
    active.controller.abort(reason)
    this.#release(active, reason)
    this.#status = { ...this.#status, state: 'cancelled', audioRefCount: 0, imageRefCount: 0, cancelReason: reason }
    return true
  }

  cancelForEcho(): boolean {
    return this.cancel('echo-blocked')
  }

  #release(active: ActiveWindow, reason: CloudPerceptionWindowCancelReason | 'completed'): void {
    if (active.released)
      return
    active.released = true
    for (const lease of [...active.audioLeases, ...active.imageLeases])
      lease.release(reason)
  }
}
