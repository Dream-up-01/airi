import type { PerceptionConsentGrant, PerceptionSourceKind } from './contracts'

import { describe, expect, it, vi } from 'vitest'

import { bindPerceptionLifecycleToStateManager } from './lifecycle-binding'
import { createInMemoryPerceptionOwnerProvider } from './owner'
import { PerceptionSessionController } from './session'
import { PerceptionStateManager } from './state-manager'
import { createConsentGrant } from './test-fixtures'

function createHarness() {
  let now = 1_000
  const generations: number[] = []
  const revoked: Array<[PerceptionSourceKind, string]> = []
  const controller = new PerceptionSessionController({
    sessionId: 'session:1',
    processingMode: 'local-only',
    ownerId: 'renderer:1',
    ownerProvider: createInMemoryPerceptionOwnerProvider(),
    now: () => now,
    hooks: {
      onGenerationChanged: (_sessionId, generation) => generations.push(generation),
      onSourceRevoked: (kind, id) => revoked.push([kind, id]),
    },
  })
  return {
    controller,
    generations,
    revoked,
    setNow: (value: number) => {
      now = value
    },
  }
}

function grantCamera(controller: PerceptionSessionController, grant: PerceptionConsentGrant = createConsentGrant()) {
  expect(controller.requestPermission('camera', 'camera:default').ok).toBe(true)
  expect(controller.session.state).toBe('requesting-permission')
  const result = controller.grantPermission(grant)
  expect(result.ok).toBe(true)
}

describe('perception session controller', () => {
  it('requires permission before ownership/capture and handles denial with a stable code', async () => {
    const { controller } = createHarness()
    const startWithoutGrant = await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop: vi.fn() })
    expect(startWithoutGrant.ok).toBe(false)
    if (!startWithoutGrant.ok)
      expect(startWithoutGrant.code).toBe('permission-required')

    controller.requestPermission('camera', 'camera:default')
    const denied = controller.denyPermission()
    expect(denied.ok).toBe(true)
    expect(controller.session.state).toBe('failed')
    expect(controller.session.lastErrorCode).toBe('permission-denied')
  })

  it('rejects a mismatched grant and an incomplete cloud grant', () => {
    const { controller } = createHarness()
    controller.requestPermission('camera', 'camera:default')
    const mismatched = controller.grantPermission(createConsentGrant({ sourceId: 'camera:other' }))
    expect(mismatched.ok).toBe(false)
    if (!mismatched.ok)
      expect(mismatched.code).toBe('permission-denied')

    const second = createHarness().controller
    second.requestPermission('camera', 'camera:default')
    const incompleteCloud = second.grantPermission(createConsentGrant({
      processingMode: 'cloud-approved',
      cloudProviderId: 'aliyun',
      cloudModelId: 'qwen3.5-omni-flash-realtime',
    }))
    expect(incompleteCloud.ok).toBe(false)
  })

  it('starts only after a matching grant and never auto-resumes after pause', async () => {
    const { controller, generations } = createHarness()
    const stop = vi.fn()
    grantCamera(controller)
    const started = await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop })
    expect(started.ok).toBe(true)
    expect(controller.session.state).toBe('running')
    expect(controller.session.activeSourceIds).toEqual(['camera:default'])

    await controller.pause()
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.session.state).toBe('paused')
    expect(controller.session.activeSourceIds).toEqual([])
    expect(generations).toEqual([1, 2])

    await Promise.resolve()
    expect(controller.session.state).toBe('paused')
    const restarted = await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop: vi.fn() })
    expect(restarted.ok).toBe(true)
    expect(controller.session.state).toBe('running')
    expect(controller.session.generation).toBe(3)
  })

  it.each([
    ['screen', 'screen:primary', ['screen-frames'], ['screen.health']],
    ['camera', 'camera:default', ['camera-frames'], ['camera.health']],
    ['minecraft', 'minecraft:bot', ['game-events'], ['minecraft.health']],
  ] as const)('enables %s only through its own grant', async (sourceKind, sourceId, modalities, categories) => {
    const controller = new PerceptionSessionController({
      sessionId: `session:${sourceKind}`,
      processingMode: 'local-only',
      ownerId: `renderer:${sourceKind}`,
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      now: () => 1_000,
    })
    controller.requestPermission(sourceKind, sourceId)
    const granted = controller.grantPermission(createConsentGrant({
      grantId: `grant:${sourceKind}`,
      sourceKind,
      sourceId,
      allowedModalities: [...modalities],
      allowedFactCategories: [...categories],
    }))
    expect(granted.ok).toBe(true)
    expect((await controller.activateSource({ sourceKind, sourceId, stop: vi.fn() })).ok).toBe(true)
    expect(controller.session.enabledSources).toEqual([sourceKind])
  })

  it('revokes accepted facts when pause changes the generation', async () => {
    const manager = new PerceptionStateManager({
      sessionId: 'session:bound',
      generation: 0,
      clock: { now: () => 1_000 },
    })
    const controller = new PerceptionSessionController({
      sessionId: 'session:bound',
      processingMode: 'local-only',
      ownerId: 'renderer:bound',
      ownerProvider: createInMemoryPerceptionOwnerProvider(),
      now: () => 1_000,
      hooks: bindPerceptionLifecycleToStateManager(manager),
    })
    grantCamera(controller)
    await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop: vi.fn() })
    const event = {
      contractVersion: 'perception/v0.3',
      eventId: 'event:bound',
      observationId: 'observation:bound',
      sessionId: 'session:bound',
      generation: controller.session.generation,
      sourceKind: 'camera-local',
      sourceId: 'camera:default',
      analyzers: ['mediapipe:pose'],
      eventType: 'person.presence.changed',
      phase: 'observed',
      subject: 'primary-user',
      value: { kind: 'boolean', value: true },
      confidence: 0.9,
      observedAt: 1_000,
      expiresAt: 4_000,
      verification: 'direct-signal',
      sensitivity: 'personal',
      provenance: { analyzerId: 'mediapipe:pose', processing: 'local' },
    }
    expect(manager.ingest(event, { consentGrant: createConsentGrant(), sourceHealthy: true }).ok).toBe(true)
    expect(manager.snapshot().acceptedFactIds).toHaveLength(1)

    await controller.pause()
    expect(manager.snapshot().acceptedFactIds).toEqual([])
  })

  it('revokes permission, releases the source and isolates the old generation', async () => {
    const { controller, revoked } = createHarness()
    const stop = vi.fn()
    grantCamera(controller)
    await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop })
    const generation = controller.session.generation

    const result = await controller.revokeSource('camera:default')
    expect(result.ok).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.session.generation).toBe(generation + 1)
    expect(controller.session.state).toBe('stopped')
    expect(controller.grants[0]?.revokedAt).toBeDefined()
    expect(revoked).toEqual([['camera', 'camera:default']])
  })

  it('cleans up idempotently on repeated stop/dispose', async () => {
    const { controller } = createHarness()
    const stop = vi.fn()
    grantCamera(controller)
    await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop })

    await Promise.all([controller.stop(), controller.stop(), controller.dispose()])
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.session.state).toBe('stopped')
    expect(controller.session.activeSourceIds).toEqual([])
    expect(controller.session.generation).toBe(2)
  })

  it('treats track ended as a terminal source failure and revokes downstream facts', async () => {
    const { controller, revoked } = createHarness()
    const stop = vi.fn()
    grantCamera(controller)
    await controller.activateSource({ sourceKind: 'camera', sourceId: 'camera:default', stop })

    await controller.sourceEnded('camera:default')
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.session.state).toBe('failed')
    expect(controller.session.lastErrorCode).toBe('source-ended')
    expect(revoked).toEqual([['camera', 'camera:default']])
  })

  it('returns from a stuck source cleanup within the configured sub-500ms deadline', async () => {
    vi.useFakeTimers()
    try {
      const controller = new PerceptionSessionController({
        sessionId: 'session:timeout',
        processingMode: 'local-only',
        ownerId: 'renderer:timeout',
        ownerProvider: createInMemoryPerceptionOwnerProvider(),
        now: () => 1_000,
        cleanupTimeoutMs: 400,
      })
      grantCamera(controller)
      await controller.activateSource({
        sourceKind: 'camera',
        sourceId: 'camera:default',
        stop: () => new Promise(() => undefined),
      })

      const stopping = controller.stop()
      await vi.advanceTimersByTimeAsync(399)
      expect(controller.session.state).toBe('stopping')
      await vi.advanceTimersByTimeAsync(1)
      await stopping
      expect(controller.session.state).toBe('stopped')
    }
    finally {
      vi.useRealTimers()
    }
  })
})
