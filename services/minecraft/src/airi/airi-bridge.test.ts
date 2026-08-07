import type { WebSocketEvents } from '@proj-airi/server-sdk'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { AiriBridge } from './airi-bridge'

const logger = vi.hoisted(() => ({
  errorWithError: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({
    useGlobalConfig: () => logger,
  }),
}))

function createBridgeHarness(options?: ConstructorParameters<typeof AiriBridge>[2]) {
  const handlers = new Map<string, (event: any) => void | Promise<void>>()
  const client = {
    send: vi.fn(),
    onEvent: vi.fn((type: string, handler: (event: any) => void | Promise<void>) => {
      handlers.set(type, handler)
    }),
    offEvent: vi.fn(),
  }
  const eventBus = {
    emit: vi.fn(),
  }
  const bridge = new AiriBridge(client as any, eventBus as any, options)
  bridge.init()

  return { bridge, client, eventBus, handlers }
}

function createCanonicalSparkCommand(commandId: string): WebSocketEvents['spark:command'] {
  return {
    id: `wire-${commandId}`,
    eventId: `event-${commandId}`,
    commandId,
    intent: 'action',
    interrupt: 'soft',
    priority: 'high',
    guidance: {
      type: 'instruction',
      options: [{
        label: 'collect wood',
        steps: ['find a tree', 'chop it'],
        rationale: 'Wood is needed for tools.',
        risk: 'low',
        fallback: ['move to another tree'],
      }],
    },
    destinations: ['proj-airi:minecraft-*'],
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('airiBridge spark command routing', () => {
  it('accepts the canonical sender-shaped Spark command contract', async () => {
    const { bridge, client, handlers } = createBridgeHarness()
    const listener = vi.fn(async () => true)
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({
      data: createCanonicalSparkCommand('spark-canonical'),
    })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 'wire-spark-canonical',
      commandId: 'spark-canonical',
      intent: 'action',
      interrupt: 'soft',
      message: 'collect wood',
      priority: 'high',
    }))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'spark-canonical',
        state: 'queued',
      }),
    }))
    bridge.destroy()
  })

  it('accepts the full nanoid alphabet used by the canonical sender', async () => {
    const { bridge, handlers } = createBridgeHarness()
    const listener = vi.fn(async () => true)
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({
      data: {
        ...createCanonicalSparkCommand('_spark-command'),
        id: '_wire-id',
        eventId: '-event-id',
      },
    })

    expect(listener).toHaveBeenCalledOnce()
    bridge.destroy()
  })

  it('routes unconsumed spark commands as AIRI commands instead of chat messages', async () => {
    const { bridge, eventBus, handlers } = createBridgeHarness()
    const commandHandler = handlers.get('spark:command')

    expect(commandHandler).toBeDefined()

    await commandHandler?.({
      data: {
        ...createCanonicalSparkCommand('spark-1'),
        interrupt: false,
        priority: 'normal',
        guidance: {
          type: 'instruction',
          options: [
            {
              label: 'collect wood',
              steps: ['find a tree', 'chop it'],
            },
          ],
        },
      },
    })

    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'signal:airi_command',
      payload: expect.objectContaining({
        type: 'airi_command',
        description: 'Directive from AIRI: "collect wood"',
        sourceId: 'airi',
        metadata: expect.objectContaining({
          message: 'collect wood',
          sparkCommandId: 'spark-1',
          sparkIntent: 'action',
        }),
      }),
    }))
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'signal:chat_message',
    }))

    bridge.destroy()
  })

  it('lets a strict command listener consume a directive before the Brain fallback', async () => {
    const { bridge, eventBus, handlers } = createBridgeHarness()
    const listener = vi.fn(async () => true)
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({
      data: {
        ...createCanonicalSparkCommand('spark-2'),
        interrupt: false,
        priority: 'normal',
        guidance: {
          type: 'instruction',
          options: [{ label: 'jump', steps: [] }],
        },
      },
    })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'spark-2',
      message: 'jump',
      intent: 'action',
    }))
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
    bridge.destroy()
  })

  it('does not execute a replayed commandId twice', async () => {
    const { bridge, client, eventBus, handlers } = createBridgeHarness()
    const listener = vi.fn(async () => true)
    const command = createCanonicalSparkCommand('spark-replayed')
    const replay = { ...command, id: 'wire-spark-replayed-delivery-2' }
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({ data: command })
    await handlers.get('spark:command')?.({ data: replay })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(client.send).toHaveBeenCalledTimes(2)
    expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'wire-spark-replayed-delivery-2',
        state: 'dropped',
        note: 'duplicate-command',
      }),
    }))
    bridge.destroy()
  })

  it('rejects a reused commandId when the executable directive changes', async () => {
    const { bridge, client, handlers } = createBridgeHarness()
    const listener = vi.fn(async () => true)
    const first = createCanonicalSparkCommand('spark-collision')
    const changed = createCanonicalSparkCommand('spark-collision')
    changed.id = 'wire-spark-collision-delivery-2'
    changed.guidance!.options[0]!.label = 'jump'
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({ data: first })
    await handlers.get('spark:command')?.({ data: changed })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'wire-spark-collision-delivery-2',
        state: 'dropped',
        note: 'invalid-contract',
      }),
    }))
    bridge.destroy()
  })

  it('expires replay entries after the bounded replay window', async () => {
    let now = 1_000
    const { bridge, handlers } = createBridgeHarness({ now: () => now, replayTtlMs: 100 })
    const listener = vi.fn(async () => true)
    const command = createCanonicalSparkCommand('spark-expiring')
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({ data: command })
    now = 1_101
    await handlers.get('spark:command')?.({ data: command })

    expect(listener).toHaveBeenCalledTimes(2)
    bridge.destroy()
  })

  it('evicts the oldest replay entry when the registry reaches capacity', async () => {
    const { bridge, handlers } = createBridgeHarness({ replayCapacity: 2 })
    const listener = vi.fn(async () => true)
    bridge.onSparkCommand(listener)

    await handlers.get('spark:command')?.({ data: createCanonicalSparkCommand('spark-capacity-1') })
    await handlers.get('spark:command')?.({ data: createCanonicalSparkCommand('spark-capacity-2') })
    await handlers.get('spark:command')?.({ data: createCanonicalSparkCommand('spark-capacity-3') })
    await handlers.get('spark:command')?.({ data: createCanonicalSparkCommand('spark-capacity-1') })

    expect(listener).toHaveBeenCalledTimes(4)
    bridge.destroy()
  })

  it('does not expire or evict a logical command while its listener is still running', async () => {
    let now = 1_000
    const { bridge, client, handlers } = createBridgeHarness({
      now: () => now,
      replayCapacity: 1,
      replayTtlMs: 100,
    })
    const pending = createDeferred<boolean>()
    const listener = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(true)
    bridge.onSparkCommand(listener)
    const original = createCanonicalSparkCommand('spark-active')

    const activeDelivery = handlers.get('spark:command')?.({ data: original })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    now = 1_101
    await handlers.get('spark:command')?.({
      data: { ...createCanonicalSparkCommand('spark-capacity-pressure'), id: 'wire-capacity-pressure' },
    })
    await handlers.get('spark:command')?.({
      data: { ...original, id: 'wire-spark-active-replay' },
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'wire-spark-active-replay',
        state: 'dropped',
        note: 'duplicate-command',
      }),
    }))

    pending.resolve(true)
    await activeDelivery
    bridge.destroy()
  })

  it('keeps a reinitialized lifecycle active when an old handler settles late', async () => {
    let now = 1_000
    const { bridge, handlers } = createBridgeHarness({
      now: () => now,
      replayCapacity: 1,
      replayTtlMs: 100,
    })
    const oldPending = createDeferred<boolean>()
    const oldListener = vi.fn(() => oldPending.promise)
    bridge.onSparkCommand(oldListener)
    const command = createCanonicalSparkCommand('spark-lifecycle')
    const oldHandler = handlers.get('spark:command')
    const oldDelivery = oldHandler?.({ data: command })
    await vi.waitFor(() => expect(oldListener).toHaveBeenCalledOnce())

    bridge.destroy()
    bridge.init()
    const newPending = createDeferred<boolean>()
    const newListener = vi.fn()
      .mockImplementationOnce(() => newPending.promise)
      .mockResolvedValue(true)
    bridge.onSparkCommand(newListener)
    const newHandler = handlers.get('spark:command')
    const newDelivery = newHandler?.({ data: { ...command, id: 'wire-spark-lifecycle-new' } })
    await vi.waitFor(() => expect(newListener).toHaveBeenCalledOnce())

    oldPending.resolve(true)
    await oldDelivery
    now = 1_101
    await newHandler?.({ data: { ...command, id: 'wire-spark-lifecycle-replay' } })

    expect(newListener).toHaveBeenCalledOnce()

    newPending.resolve(true)
    await newDelivery
    bridge.destroy()
  })

  it('fails closed when a Spark command safety listener throws', async () => {
    const { bridge, client, eventBus, handlers } = createBridgeHarness()
    bridge.onSparkCommand(() => {
      throw new Error('listener failed')
    })

    await handlers.get('spark:command')?.({
      data: {
        ...createCanonicalSparkCommand('spark-listener-error'),
        interrupt: false,
        priority: 'normal',
        guidance: { type: 'instruction', options: [{ label: 'jump', steps: [] }] },
      },
    })

    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'spark-listener-error',
        state: 'dropped',
        note: 'unknown',
      }),
    }))
    bridge.destroy()
  })

  it.each([
    { ...createCanonicalSparkCommand('spark-invalid-id'), commandId: '../bad' },
    { ...createCanonicalSparkCommand('spark-bad-label'), guidance: { type: 'instruction', options: [{ label: 123, steps: [] }] } },
    { ...createCanonicalSparkCommand('spark-too-long'), guidance: { type: 'instruction', options: [{ label: 'x'.repeat(513), steps: [] }] } },
    { ...createCanonicalSparkCommand('spark-extra-root'), rawInstruction: 'not part of the protocol' },
    {
      ...createCanonicalSparkCommand('spark-extra-guidance'),
      guidance: { ...createCanonicalSparkCommand('unused').guidance, rawInstruction: 'not part of the protocol' },
    },
    {
      ...createCanonicalSparkCommand('spark-extra-option'),
      guidance: {
        type: 'instruction',
        options: [{ label: 'jump', steps: [], rawInstruction: 'not part of the protocol' }],
      },
    },
  ])('rejects malformed Spark wire data before acknowledgement or Brain fallback', async (data) => {
    const { bridge, client, eventBus, handlers } = createBridgeHarness()

    await handlers.get('spark:command')?.({ data })

    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({ eventId: data.id, state: 'dropped', note: 'invalid-contract' }),
    }))
    bridge.destroy()
  })

  it('fails closed without logging raw text from an invalid payload', async () => {
    const { bridge, client, eventBus, handlers } = createBridgeHarness()
    const rawText = 'private chat text must not appear in logs'
    logger.log.mockClear()
    logger.errorWithError.mockClear()

    await handlers.get('spark:command')?.({
      data: {
        ...createCanonicalSparkCommand('spark-private-invalid'),
        rawInstruction: rawText,
      },
    })

    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({ state: 'dropped', note: 'invalid-contract' }),
    }))
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(rawText)
    expect(JSON.stringify(logger.errorWithError.mock.calls)).not.toContain(rawText)
    bridge.destroy()
  })

  it('preserves structured content without logging or rewriting it as text', () => {
    const { bridge, client } = createBridgeHarness()
    const content = {
      schemaVersion: 1,
      eventId: 'event-1',
      sequence: 1,
      observedAt: 1,
      ttlMs: 15_000,
      eventType: 'nearby-threat',
      phase: 'observed',
      value: 'high',
      confidence: 0.9,
    }

    bridge.sendContextUpdate({
      id: 'context-update-1',
      contextId: 'minecraft:perception:nearby-threat',
      lane: 'minecraft:perception:v1',
      text: 'Structured Minecraft perception event.',
      content,
      strategy: ContextUpdateStrategy.ReplaceSelf,
    })

    expect(client.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'context:update',
      data: expect.objectContaining({ content }),
    }))
    bridge.destroy()
  })
})
