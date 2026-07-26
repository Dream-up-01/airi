import type { PerceptionSession, PerceptionSessionController, PerceptionSourceKind } from '../../domains/perception'

export interface ProductionScreenCaptureHandle {
  sourceId: string
  stop: () => void | Promise<void>
  onEnded: (listener: () => void) => () => void
}

export interface ProductionScreenCaptureAdapter {
  open: (sourceId: string, signal: AbortSignal) => Promise<ProductionScreenCaptureHandle>
}

export type ProductionScreenCaptureErrorCode
  = | 'capture-busy'
    | 'permission-denied'
    | 'consent-invalid'
    | 'owner-unavailable'
    | 'capture-start-failed'
    | 'capture-start-cancelled'
    | 'invalid-transition'

export type ProductionScreenCaptureStartResult
  = | { ok: true, session: PerceptionSession }
    | { ok: false, code: ProductionScreenCaptureErrorCode, session: PerceptionSession }

export interface ProductionScreenCaptureStartRequest {
  sourceId: string
  /** Must show/verify source-specific consent and return the resulting strict grant. */
  requestConsentGrant: () => Promise<unknown | undefined>
}

interface ActiveCapture {
  sourceId: string
  controller: AbortController
  handle?: ProductionScreenCaptureHandle
  removeEndedListener?: () => void
  stopped: boolean
}

/**
 * Enforces consent -> single-owner activation -> platform capture ordering.
 * It owns lifecycle only; raw frames and analyzer output never pass through it.
 */
export class ProductionScreenCaptureLifecycle {
  readonly #session: PerceptionSessionController
  readonly #adapter: ProductionScreenCaptureAdapter
  readonly #sourceKind: PerceptionSourceKind
  #active?: ActiveCapture
  #starting = false
  #epoch = 0

  constructor(session: PerceptionSessionController, adapter: ProductionScreenCaptureAdapter, sourceKind: PerceptionSourceKind = 'screen') {
    this.#session = session
    this.#adapter = adapter
    this.#sourceKind = sourceKind
  }

  get session(): PerceptionSession {
    return this.#session.session
  }

  async start(request: ProductionScreenCaptureStartRequest): Promise<ProductionScreenCaptureStartResult> {
    if (this.#starting || this.#active)
      return this.#failure('capture-busy')
    if (!request.sourceId)
      return this.#failure('consent-invalid')

    this.#starting = true
    const epoch = ++this.#epoch
    try {
      const permissionRequested = this.#session.requestPermission(this.#sourceKind, request.sourceId)
      if (!permissionRequested.ok)
        return this.#failure('invalid-transition')

      let grant: unknown | undefined
      try {
        grant = await request.requestConsentGrant()
      }
      catch {
        if (epoch === this.#epoch && this.#session.session.state === 'requesting-permission')
          this.#session.denyPermission()
        return this.#failure(epoch === this.#epoch ? 'permission-denied' : 'capture-start-cancelled')
      }
      if (epoch !== this.#epoch)
        return this.#failure('capture-start-cancelled')
      if (!grant) {
        this.#session.denyPermission()
        return this.#failure('permission-denied')
      }

      const granted = this.#session.grantPermission(grant)
      if (!granted.ok) {
        if (this.#session.session.state === 'requesting-permission')
          this.#session.denyPermission()
        return this.#failure('consent-invalid')
      }

      const active: ActiveCapture = {
        sourceId: request.sourceId,
        controller: new AbortController(),
        stopped: false,
      }
      const activated = await this.#session.activateSource({
        sourceKind: this.#sourceKind,
        sourceId: request.sourceId,
        stop: () => this.#stopCapture(active, 'session-cleanup'),
      })
      if (!activated.ok) {
        return this.#failure(activated.code === 'owner-unavailable' ? 'owner-unavailable' : 'invalid-transition')
      }
      this.#active = active

      let handle: ProductionScreenCaptureHandle
      try {
        handle = await this.#adapter.open(request.sourceId, active.controller.signal)
      }
      catch {
        if (epoch === this.#epoch)
          await this.#session.sourceEnded(request.sourceId)
        if (this.#active === active)
          this.#active = undefined
        return this.#failure(epoch === this.#epoch ? 'capture-start-failed' : 'capture-start-cancelled')
      }

      if (epoch !== this.#epoch || active.stopped || active.controller.signal.aborted) {
        await safeStopHandle(handle)
        return this.#failure('capture-start-cancelled')
      }
      if (handle.sourceId !== request.sourceId) {
        await safeStopHandle(handle)
        await this.#session.sourceEnded(request.sourceId)
        if (this.#active === active)
          this.#active = undefined
        return this.#failure('capture-start-failed')
      }

      active.handle = handle
      active.removeEndedListener = handle.onEnded(() => {
        void this.#handleSourceEnded(active)
      })
      return { ok: true, session: this.#session.session }
    }
    finally {
      this.#starting = false
    }
  }

  async pause(): Promise<void> {
    this.#epoch += 1
    if (this.#session.session.state === 'running')
      await this.#session.pause()
    else
      await this.#session.stop()
    this.#active = undefined
  }

  async stop(): Promise<void> {
    this.#epoch += 1
    await this.#session.stop()
    this.#active = undefined
  }

  async revoke(): Promise<void> {
    this.#epoch += 1
    const sourceId = this.#active?.sourceId
    if (sourceId)
      await this.#session.revokeSource(sourceId)
    else
      await this.#session.stop()
    this.#active = undefined
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  async #handleSourceEnded(active: ActiveCapture): Promise<void> {
    if (this.#active !== active || active.stopped)
      return
    this.#epoch += 1
    await this.#session.sourceEnded(active.sourceId)
    if (this.#active === active)
      this.#active = undefined
  }

  async #stopCapture(active: ActiveCapture, reason: string): Promise<void> {
    if (active.stopped)
      return
    active.stopped = true
    active.controller.abort(reason)
    active.removeEndedListener?.()
    active.removeEndedListener = undefined
    if (active.handle)
      await safeStopHandle(active.handle)
    active.handle = undefined
  }

  #failure(code: ProductionScreenCaptureErrorCode): ProductionScreenCaptureStartResult {
    return { ok: false, code, session: this.#session.session }
  }
}

async function safeStopHandle(handle: ProductionScreenCaptureHandle): Promise<void> {
  try {
    await handle.stop()
  }
  catch {
    // Cleanup remains best-effort and the public lifecycle exposes only stable codes.
  }
}
