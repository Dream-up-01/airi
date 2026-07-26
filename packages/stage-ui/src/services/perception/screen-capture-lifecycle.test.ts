import type { PerceptionConsentGrant } from '../../domains/perception'
import type { ProductionScreenCaptureHandle } from './screen-capture-lifecycle'

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryPerceptionOwnerProvider, PerceptionSessionController } from '../../domains/perception'
import { createConsentGrant } from '../../domains/perception/test-fixtures'
import { ProductionScreenCaptureLifecycle } from './screen-capture-lifecycle'

function grant(overrides: Partial<PerceptionConsentGrant> = {}) {
  return createConsentGrant({
    grantId: 'grant:screen',
    sourceKind: 'screen',
    sourceId: 'window:external',
    allowedModalities: ['screen-frames'],
    allowedFactCategories: ['screen.activity', 'screen.health'],
    ...overrides,
  })
}

function createHarness(open?: (sourceId: string, signal: AbortSignal) => Promise<ProductionScreenCaptureHandle>) {
  const order: string[] = []
  const stop = vi.fn(async () => {
    order.push('handle-stop')
  })
  let ended: (() => void) | undefined
  const defaultHandle: ProductionScreenCaptureHandle = {
    sourceId: 'window:external',
    stop,
    onEnded(listener) {
      ended = listener
      return () => {
        ended = undefined
      }
    },
  }
  const adapter = {
    open: vi.fn(open ?? (async () => {
      order.push('open')
      return defaultHandle
    })),
  }
  const session = new PerceptionSessionController({
    sessionId: 'session:screen',
    processingMode: 'local-only',
    ownerId: 'renderer:main',
    ownerProvider: createInMemoryPerceptionOwnerProvider(),
    now: () => 1_000,
  })
  const lifecycle = new ProductionScreenCaptureLifecycle(session, adapter)
  return { adapter, lifecycle, order, stop, end: () => ended?.() }
}

describe('production screen capture lifecycle', () => {
  it('enforces consent before owner activation and platform capture', async () => {
    const { adapter, lifecycle, order } = createHarness()

    const result = await lifecycle.start({
      sourceId: 'window:external',
      async requestConsentGrant() {
        order.push(`consent:${lifecycle.session.state}`)
        return grant()
      },
    })

    expect(result.ok).toBe(true)
    expect(order).toEqual(['consent:requesting-permission', 'open'])
    expect(adapter.open).toHaveBeenCalledOnce()
    expect(lifecycle.session).toMatchObject({ state: 'running', activeSourceIds: ['window:external'], generation: 1 })
  })

  it('never opens capture after denial or an invalid/mismatched grant', async () => {
    const denied = createHarness()
    expect(await denied.lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => undefined,
    })).toMatchObject({ ok: false, code: 'permission-denied' })
    expect(denied.adapter.open).not.toHaveBeenCalled()

    const mismatched = createHarness()
    expect(await mismatched.lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant({ sourceId: 'window:other' }),
    })).toMatchObject({ ok: false, code: 'consent-invalid' })
    expect(mismatched.adapter.open).not.toHaveBeenCalled()
    expect(mismatched.lifecycle.session.state).toBe('failed')
  })

  it('does not let a second start replace an active capture', async () => {
    const harness = createHarness()
    await harness.lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })

    expect(await harness.lifecycle.start({
      sourceId: 'window:other',
      requestConsentGrant: async () => grant({ sourceId: 'window:other' }),
    })).toMatchObject({ ok: false, code: 'capture-busy' })
    expect(harness.adapter.open).toHaveBeenCalledOnce()
  })

  it('fails closed for a second renderer and releases ownership on pause', async () => {
    const ownerProvider = createInMemoryPerceptionOwnerProvider()
    const firstSession = new PerceptionSessionController({
      sessionId: 'session:screen:first',
      processingMode: 'local-only',
      ownerId: 'renderer:first',
      ownerProvider,
      now: () => 1_000,
    })
    const secondSession = new PerceptionSessionController({
      sessionId: 'session:screen:second',
      processingMode: 'local-only',
      ownerId: 'renderer:second',
      ownerProvider,
      now: () => 1_000,
    })
    const createAdapter = () => ({
      open: vi.fn(async (sourceId: string) => ({
        sourceId,
        stop: vi.fn(),
        onEnded: () => () => undefined,
      })),
    })
    const firstAdapter = createAdapter()
    const secondAdapter = createAdapter()
    const first = new ProductionScreenCaptureLifecycle(firstSession, firstAdapter)
    const second = new ProductionScreenCaptureLifecycle(secondSession, secondAdapter)

    expect(await first.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })).toMatchObject({ ok: true })
    expect(await second.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })).toMatchObject({ ok: false, code: 'owner-unavailable' })
    expect(secondAdapter.open).not.toHaveBeenCalled()

    await first.pause()
    expect(await second.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })).toMatchObject({ ok: true })
    expect(secondAdapter.open).toHaveBeenCalledOnce()
  })

  it('stops a late platform stream when pause cancels startup', async () => {
    let resolveOpen!: (handle: ProductionScreenCaptureHandle) => void
    let openSignal!: AbortSignal
    const lateStop = vi.fn()
    const harness = createHarness((_sourceId, signal) => new Promise((resolve) => {
      openSignal = signal
      resolveOpen = resolve
    }))
    const starting = harness.lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })
    await vi.waitFor(() => expect(resolveOpen).toBeTypeOf('function'))

    await harness.lifecycle.pause()
    expect(openSignal.aborted).toBe(true)
    resolveOpen({
      sourceId: 'window:external',
      stop: lateStop,
      onEnded: () => () => undefined,
    })

    await expect(starting).resolves.toMatchObject({ ok: false, code: 'capture-start-cancelled' })
    expect(lateStop).toHaveBeenCalledOnce()
    expect(harness.lifecycle.session.state).toBe('paused')
  })

  it('turns a physical source end into failed health and idempotent cleanup', async () => {
    const { lifecycle, stop, end } = createHarness()
    await lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })

    end()
    await vi.waitFor(() => expect(lifecycle.session.state).toBe('failed'))
    expect(lifecycle.session.lastErrorCode).toBe('source-ended')
    expect(stop).toHaveBeenCalledOnce()

    await lifecycle.stop()
    await lifecycle.stop()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('rejects a platform handle for a different selected source', async () => {
    const wrongStop = vi.fn()
    const harness = createHarness(async () => ({
      sourceId: 'window:other',
      stop: wrongStop,
      onEnded: () => () => undefined,
    }))

    expect(await harness.lifecycle.start({
      sourceId: 'window:external',
      requestConsentGrant: async () => grant(),
    })).toMatchObject({ ok: false, code: 'capture-start-failed' })
    expect(wrongStop).toHaveBeenCalledOnce()
    expect(harness.lifecycle.session.state).toBe('failed')
  })
})
