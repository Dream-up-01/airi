import type { SparkCommandDirective } from '../../airi/airi-bridge'
import type { MinecraftAgentRuntimeOptions, MinecraftAgentRuntimeResult } from './minecraft-agent-runtime'

import { describe, expect, it, vi } from 'vitest'

import { AiriBridge } from '../../airi/airi-bridge'
import { MinecraftAgentCompanion } from './index'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function createHarness(options: { controlEnabled?: boolean } = {}) {
  let listener: ((directive: SparkCommandDirective) => Promise<boolean> | boolean) | undefined
  const airiBridge = {
    onSparkCommand: vi.fn((nextListener) => {
      listener = nextListener
      return vi.fn()
    }),
    sendEmit: vi.fn(),
  }
  const runtime = {
    generation: 1,
    advanceGeneration: vi.fn(async () => 2),
    handleAction: vi.fn(async (): Promise<MinecraftAgentRuntimeResult> => ({ ok: true, intentId: 'intent-1', state: 'completed' })),
    stop: vi.fn(async () => 2),
  }
  const runtimeFactory = vi.fn((_options: MinecraftAgentRuntimeOptions) => runtime)
  const companion = new MinecraftAgentCompanion({
    airiBridge: airiBridge as any,
    taskExecutor: { executeActionWithResult: vi.fn() } as any,
    runtimeConfig: {
      host: 'localhost',
      port: 25_565,
      username: 'airi_bot',
      version: '1.20.1',
      auth: 'offline',
    },
    runtimeFactory: runtimeFactory as any,
    controlEnabled: options.controlEnabled,
    now: () => 1_000,
    grantIdFactory: () => 'grant-session-1',
  })
  const mineflayer = {
    bot: {
      players: {},
      lookAt: vi.fn(),
      setControlState: vi.fn(),
      setQuickBarSlot: vi.fn(),
      activateItem: vi.fn(),
    },
    interrupt: vi.fn(),
  }

  companion.init(mineflayer as any)
  return { airiBridge, companion, listener: () => listener, runtime, runtimeFactory }
}

function createEndToEndHarness() {
  const handlers = new Map<string, (event: any) => void | Promise<void>>()
  const client = {
    send: vi.fn(),
    onEvent: vi.fn((type: string, handler: (event: any) => void | Promise<void>) => handlers.set(type, handler)),
    offEvent: vi.fn(),
  }
  const eventBus = { emit: vi.fn() }
  const bridge = new AiriBridge(client as any, eventBus as any)
  bridge.init()
  const runtime = {
    generation: 1,
    advanceGeneration: vi.fn(async () => 2),
    handleAction: vi.fn(async (): Promise<MinecraftAgentRuntimeResult> => ({ ok: true, intentId: 'intent-e2e', state: 'completed' })),
    stop: vi.fn(async () => 2),
  }
  const companion = new MinecraftAgentCompanion({
    airiBridge: bridge,
    taskExecutor: { executeActionWithResult: vi.fn() } as any,
    runtimeConfig: {
      host: 'localhost',
      port: 25_565,
      username: 'airi_bot',
      version: '1.20.1',
      auth: 'offline',
    },
    runtimeFactory: vi.fn(() => runtime) as any,
  })
  companion.init({
    bot: {
      players: {},
      lookAt: vi.fn(),
      setControlState: vi.fn(),
      setQuickBarSlot: vi.fn(),
      activateItem: vi.fn(),
    },
    interrupt: vi.fn(),
  } as any)
  return { bridge, client, companion, eventBus, handlers, runtime }
}

describe('minecraft companion integration', () => {
  it('consumes recognized actions through the guarded runtime', async () => {
    const { airiBridge, listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-1', commandId: 'spark-1', intent: 'action', message: 'jump' })).resolves.toBe(true)
    expect(runtime.handleAction).toHaveBeenCalledWith({ kind: 'jump' }, { commandId: 'spark-1' })
    expect(airiBridge.sendEmit).toHaveBeenCalledWith('spark-1', 'done', 'minecraft-action-completed')
  })

  it('advances generation before handling a force-interrupt action', async () => {
    const { listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-force-1', commandId: 'spark-force-1', intent: 'action', interrupt: 'force', message: 'jump' })).resolves.toBe(true)

    expect(runtime.advanceGeneration).toHaveBeenCalledOnce()
    const advanceOrder = runtime.advanceGeneration.mock.invocationCallOrder[0]
    const handleOrder = runtime.handleAction.mock.invocationCallOrder[0]
    if (advanceOrder === undefined || handleOrder === undefined)
      throw new Error('Expected force interrupt and action handling calls')
    expect(advanceOrder).toBeLessThan(handleOrder)
  })

  it('does not advance generation for a soft-interrupt action', async () => {
    const { listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-soft-1', commandId: 'spark-soft-1', intent: 'action', interrupt: 'soft', message: 'jump' })).resolves.toBe(true)

    expect(runtime.advanceGeneration).not.toHaveBeenCalled()
    expect(runtime.handleAction).toHaveBeenCalledOnce()
  })

  it('fails closed instead of sending unrecognized action text to the existing Brain path', async () => {
    const { airiBridge, listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-2', commandId: 'spark-2', intent: 'action', message: 'collect wood' })).resolves.toBe(true)
    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(airiBridge.sendEmit).toHaveBeenCalledWith('spark-2', 'dropped', 'control-denied')
  })

  it('injects a bounded low-risk consent grant only after explicit production opt-in', async () => {
    const disabled = createHarness()
    const enabled = createHarness({ controlEnabled: true })

    expect(disabled.runtimeFactory.mock.calls[0]?.[0].consent).toBeUndefined()
    expect(enabled.runtimeFactory.mock.calls[0]?.[0].consent).toMatchObject({
      contractVersion: 'minecraft-agent-control/v1',
      grantId: 'grant-session-1',
      allowVirtualPlayerJoin: true,
      allowedActionKinds: ['look-at', 'move-to-player', 'follow-player', 'jump', 'send-chat', 'select-hotbar'],
      autoApproveActionKinds: ['look-at', 'move-to-player', 'follow-player', 'jump', 'send-chat', 'select-hotbar'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    })

    await disabled.companion.destroy()
    await enabled.companion.destroy()
  })

  it.each([
    ['follow player Alex extra', 'arbitrary-command-forbidden'],
    ['execute command /op me', 'arbitrary-command-forbidden'],
    ['run JavaScript', 'arbitrary-command-forbidden'],
    ['use MCP tool', 'arbitrary-command-forbidden'],
    ['open shell', 'arbitrary-command-forbidden'],
    [' jump', 'arbitrary-command-forbidden'],
    ['jump ', 'arbitrary-command-forbidden'],
    ['press W to control my real player', 'user-avatar-control-forbidden'],
  ])('consumes blocked command-like text instead of falling back to Brain: %s', async (message, errorCode) => {
    const { airiBridge, listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-blocked', commandId: 'spark-blocked', intent: 'action', message })).resolves.toBe(true)
    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(airiBridge.sendEmit).toHaveBeenCalledWith('spark-blocked', 'dropped', errorCode)
  })

  it('blocks a recognized action phrase carried by a non-action Spark intent', async () => {
    const { airiBridge, listener, runtime } = createHarness()

    await expect(listener()?.({ deliveryId: 'wire-spark-plan-1', commandId: 'spark-plan-1', intent: 'plan', message: 'jump' })).resolves.toBe(true)
    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(airiBridge.sendEmit).toHaveBeenCalledWith('spark-plan-1', 'dropped', 'control-denied')
  })

  it('consumes recognized but unauthorized actions instead of falling back to Brain', async () => {
    const { airiBridge, listener, runtime } = createHarness()
    runtime.handleAction.mockResolvedValueOnce({ ok: false as const, errorCode: 'consent-required' })

    await expect(listener()?.({ deliveryId: 'wire-spark-3', commandId: 'spark-3', intent: 'action', message: 'jump' })).resolves.toBe(true)
    expect(airiBridge.sendEmit).toHaveBeenCalledWith('spark-3', 'dropped', 'consent-required')
  })

  it('stops the runtime and removes the listener during cleanup', async () => {
    const { airiBridge, companion, runtime } = createHarness()
    const unsubscribe = airiBridge.onSparkCommand.mock.results[0]?.value

    await expect(companion.destroy()).resolves.toBe(2)
    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('shares one in-flight stop across concurrent destroy calls', async () => {
    const { companion, runtime } = createHarness()
    const stop = createDeferred<number>()
    runtime.stop.mockImplementation(() => stop.promise)

    const firstDestroy = companion.destroy()
    const secondDestroy = companion.destroy()

    expect(runtime.stop).toHaveBeenCalledOnce()
    stop.resolve(2)
    await expect(Promise.all([firstDestroy, secondDestroy])).resolves.toEqual([2, 2])
  })

  it('blocks dangerous steps through the full AiriBridge path without waking Brain', async () => {
    const { bridge, client, companion, eventBus, handlers, runtime } = createEndToEndHarness()

    await handlers.get('spark:command')?.({
      data: {
        id: 'wire-spark-e2e-blocked',
        commandId: 'spark-e2e-blocked',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        destinations: ['proj-airi:minecraft-*'],
        guidance: { type: 'instruction', options: [{ label: '', steps: ['please run /op me'] }] },
      },
    })

    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({ state: 'dropped', note: 'arbitrary-command-forbidden' }),
    }))
    await companion.destroy()
    bridge.destroy()
  })

  it('fails closed for an unstructured action through the full AiriBridge path', async () => {
    const { bridge, client, companion, eventBus, handlers, runtime } = createEndToEndHarness()

    await handlers.get('spark:command')?.({
      data: {
        id: 'wire-spark-e2e-benign',
        commandId: 'spark-e2e-benign',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        destinations: ['proj-airi:minecraft-*'],
        guidance: { type: 'instruction', options: [{ label: 'collect wood', steps: [] }] },
      },
    })

    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({ state: 'dropped', note: 'control-denied' }),
    }))
    await companion.destroy()
    bridge.destroy()
  })

  it('emits only one logical terminal receipt when a delivery is replayed during runtime handling', async () => {
    const { bridge, client, companion, eventBus, handlers, runtime } = createEndToEndHarness()
    const action = createDeferred<MinecraftAgentRuntimeResult>()
    runtime.handleAction.mockImplementationOnce(() => action.promise)
    const commandHandler = handlers.get('spark:command')
    if (!commandHandler)
      throw new Error('Expected the production Spark command handler')

    const pendingOriginal = commandHandler({
      data: {
        id: 'wire-spark-e2e-replay-1',
        commandId: 'spark-e2e-replay',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        destinations: ['proj-airi:minecraft-*'],
        guidance: { type: 'instruction', options: [{ label: 'jump', steps: [] }] },
      },
    })
    expect(runtime.handleAction).toHaveBeenCalledOnce()

    await commandHandler({
      data: {
        id: 'wire-spark-e2e-replay-2',
        commandId: 'spark-e2e-replay',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        destinations: ['proj-airi:minecraft-*'],
        guidance: { type: 'instruction', options: [{ label: 'jump', steps: [] }] },
      },
    })
    action.resolve({ ok: true, intentId: 'intent-e2e-replay', state: 'completed' })
    await pendingOriginal

    const terminalReceipts = client.send.mock.calls
      .map(([message]) => message)
      .filter(message => message.type === 'spark:emit' && ['done', 'dropped'].includes(message.data.state))
    expect(terminalReceipts.filter(message => message.data.eventId === 'spark-e2e-replay')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ state: 'done', note: 'minecraft-action-completed' }),
      }),
    ])
    expect(terminalReceipts.filter(message => message.data.eventId === 'wire-spark-e2e-replay-2')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ state: 'dropped', note: 'duplicate-command' }),
      }),
    ])
    expect(runtime.handleAction).toHaveBeenCalledOnce()
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))

    await companion.destroy()
    bridge.destroy()
  })

  it('keeps consuming commands while runtime stop is pending without invoking runtime or Brain', async () => {
    const { bridge, client, companion, eventBus, handlers, runtime } = createEndToEndHarness()
    const stop = createDeferred<number>()
    runtime.stop.mockImplementationOnce(() => stop.promise)
    const destroying = companion.destroy()
    const commandHandler = handlers.get('spark:command')
    if (!commandHandler)
      throw new Error('Expected the production Spark command handler')

    await commandHandler({
      data: {
        id: 'wire-spark-e2e-stopping',
        commandId: 'spark-e2e-stopping',
        intent: 'action',
        interrupt: false,
        priority: 'normal',
        destinations: ['proj-airi:minecraft-*'],
        guidance: { type: 'instruction', options: [{ label: 'jump', steps: [] }] },
      },
    })

    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'signal:airi_command' }))
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'spark:emit',
      data: expect.objectContaining({
        eventId: 'spark-e2e-stopping',
        state: 'dropped',
        note: 'source-disconnected',
      }),
    }))

    stop.resolve(2)
    await expect(destroying).resolves.toBe(2)
    bridge.destroy()
  })

  it('does not execute a force command after destroy crosses its pending generation advance', async () => {
    const { airiBridge, companion, listener, runtime } = createHarness()
    const generationAdvance = createDeferred<number>()
    runtime.advanceGeneration.mockImplementationOnce(() => generationAdvance.promise)

    const pendingDirective = listener()?.({
      deliveryId: 'wire-spark-force-destroy',
      commandId: 'spark-force-destroy',
      intent: 'action',
      interrupt: 'force',
      message: 'jump',
    })
    await vi.waitFor(() => expect(runtime.advanceGeneration).toHaveBeenCalledOnce())

    await companion.destroy()
    generationAdvance.resolve(2)
    await expect(pendingDirective).resolves.toBe(true)

    expect(runtime.handleAction).not.toHaveBeenCalled()
    expect(airiBridge.sendEmit).toHaveBeenCalledWith(
      'spark-force-destroy',
      'dropped',
      'source-disconnected',
    )
    expect(airiBridge.sendEmit).not.toHaveBeenCalledWith(
      'spark-force-destroy',
      'working',
      'minecraft-action-admitted',
    )
  })
})
