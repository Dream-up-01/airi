import type { ExtractInvokeRequestOptions } from '@moeru/eventa'
import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import type { ElectronMainInvokeCallerOptions } from './windowScopedInvoke'

import { createContext, defineInvoke, defineInvokeEventa, defineStreamInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import { defineWindowScopedInvokeHandler, defineWindowScopedStreamInvokeHandler } from './windowScopedInvoke'

type ElectronMainContext = ReturnType<typeof createElectronContext>['context']

/** `webContents.id` of the window each registration under test belongs to. */
const OWNING_WEB_CONTENTS_ID = 11

/**
 * In-memory stand-in for the context eventa's electron main adapter builds.
 *
 * NOTICE:
 * The two contexts are runtime-compatible — the adapter's `createContext` returns the very
 * same core context object, only narrowed with electron-specific option types — so the cast
 * buys the declared option types without an electron main process.
 * Source: `node_modules/@moeru/eventa/dist/adapters/electron/main.mjs` calls the core
 * `createContext()` and returns it as `{ context, dispose }`.
 * Removal condition: drop once `@moeru/eventa` ships a test double for its electron context.
 */
function createTestContext(): ElectronMainContext {
  return createContext() as unknown as ElectronMainContext
}

/**
 * Builds the invoke options an `ipcMain`-originated call would carry.
 *
 * NOTICE:
 * Only `raw.ipcMainEvent.sender.id` is read by the guard, so the double supplies that field
 * alone.
 * Root cause of the cast: `raw.ipcMainEvent` is declared as electron's full `IpcMainEvent`
 * (whose `sender` is a `WebContents`), which cannot be constructed outside a real electron
 * main process.
 * Source: `node_modules/@moeru/eventa/dist/adapters/electron/main.d.mts` `createContext`
 * return type; the value is attached at `adapters/electron/main.mjs:48`.
 * Removal condition: drop once `@moeru/eventa` ships a test double for its electron context.
 */
function fromWindow(webContentsId: number): ExtractInvokeRequestOptions<ElectronMainContext> {
  return { raw: { ipcMainEvent: { sender: { id: webContentsId } } } } as unknown as ExtractInvokeRequestOptions<ElectronMainContext>
}

function doubler() {
  return vi.fn((
    payload: { value: number },
    _options?: { abortController?: AbortController } & ElectronMainInvokeCallerOptions,
  ) => ({ doubled: payload.value * 2 }))
}

describe('defineWindowScopedInvokeHandler', () => {
  /**
   * @example
   * ```ts
   * await expect(invoke({ value: 21 }, fromWindow(11))).resolves.toEqual({ doubled: 42 })
   * ```
   */
  it('runs the handler and passes the response through for its own window', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<{ doubled: number }, { value: number }>()
    const handler = doubler()
    defineWindowScopedInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, handler)
    const invoke = defineInvoke(context, event)

    await expect(invoke({ value: 21 }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toEqual({ doubled: 42 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ value: 21 })
  })

  /**
   * @example
   * ```ts
   * await expect(invoke({ value: 21 }, fromWindow(12))).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * expect(handler).toHaveBeenCalledTimes(0)
   * ```
   */
  it('never runs the handler for an invoke sent by another window', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<{ doubled: number }, { value: number }>()
    const handler = doubler()
    defineWindowScopedInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, handler)
    const invoke = defineInvoke(context, event)

    await expect(invoke({ value: 21 }, fromWindow(OWNING_WEB_CONTENTS_ID + 1))).rejects.toMatchObject({
      name: 'CrossWindowInvocationError',
      message: 'cross-window-invocation-rejected',
    })
    expect(handler).toHaveBeenCalledTimes(0)
  })

  /**
   * @example
   * ```ts
   * await expect(invoke({ value: 21 })).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
   * ```
   */
  it('fails closed when the invoke carries no ipcMain sender', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<{ doubled: number }, { value: number }>()
    const handler = doubler()
    defineWindowScopedInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, handler)
    const invoke = defineInvoke(context, event)

    await expect(invoke({ value: 21 })).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
    expect(handler).toHaveBeenCalledTimes(0)
  })

  /**
   * @example
   * ```ts
   * expect(handler.mock.calls[0][1]?.abortController).toBeInstanceOf(AbortController)
   * ```
   */
  it('forwards the invoke options, including the abort controller, to the handler', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<{ doubled: number }, { value: number }>()
    const handler = doubler()
    defineWindowScopedInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, handler)
    const invoke = defineInvoke(context, event)

    await expect(invoke({ value: 1 }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toEqual({ doubled: 2 })
    expect(handler.mock.calls[0][1]?.abortController).toBeInstanceOf(AbortController)
    expect(handler.mock.calls[0][1]?.raw?.ipcMainEvent?.sender?.id).toBe(OWNING_WEB_CONTENTS_ID)
  })

  /**
   * @example
   * ```ts
   * cleanup()
   * expect(handler).toHaveBeenCalledTimes(1)
   * ```
   */
  it('returns a cleanup function that unregisters the handler', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<{ doubled: number }, { value: number }>()
    const handler = doubler()
    const cleanup = defineWindowScopedInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, handler)
    const invoke = defineInvoke(context, event)

    await expect(invoke({ value: 1 }, fromWindow(OWNING_WEB_CONTENTS_ID))).resolves.toEqual({ doubled: 2 })
    cleanup()
    context.abort(new Error('cleanup-test-teardown'))
    await expect(invoke({ value: 2 }, fromWindow(OWNING_WEB_CONTENTS_ID))).rejects.toBeDefined()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('defineWindowScopedStreamInvokeHandler', () => {
  /**
   * @example
   * ```ts
   * expect(received).toEqual([2, 4])
   * ```
   */
  it('streams responses for its own window', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<number, { value: number }>()
    const fn = vi.fn(async function* ({ value }: { value: number }) {
      yield value
      yield value * 2
    })
    defineWindowScopedStreamInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, fn)
    const stream = defineStreamInvoke(context, event)

    const received: number[] = []
    for await (const chunk of stream({ value: 2 }, fromWindow(OWNING_WEB_CONTENTS_ID)))
      received.push(chunk)

    expect(received).toEqual([2, 4])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  /**
   * @example
   * ```ts
   * expect(fn).toHaveBeenCalledTimes(0)
   * ```
   */
  it('never starts the generator for an invoke sent by another window', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<number, { value: number }>()
    const fn = vi.fn(async function* ({ value }: { value: number }) {
      yield value
    })
    defineWindowScopedStreamInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, fn)
    const stream = defineStreamInvoke(context, event)

    await expect(async () => {
      for await (const chunk of stream({ value: 2 }, fromWindow(OWNING_WEB_CONTENTS_ID + 1)))
        void chunk
    }).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
    expect(fn).toHaveBeenCalledTimes(0)
  })

  /**
   * @example
   * ```ts
   * expect(fn).toHaveBeenCalledTimes(0)
   * ```
   */
  it('fails closed when the streamed invoke carries no ipcMain sender', async () => {
    const context = createTestContext()
    const event = defineInvokeEventa<number, { value: number }>()
    const fn = vi.fn(async function* ({ value }: { value: number }) {
      yield value
    })
    defineWindowScopedStreamInvokeHandler(context, event, OWNING_WEB_CONTENTS_ID, fn)
    const stream = defineStreamInvoke(context, event)

    await expect(async () => {
      for await (const chunk of stream({ value: 2 }))
        void chunk
    }).rejects.toMatchObject({ message: 'cross-window-invocation-rejected' })
    expect(fn).toHaveBeenCalledTimes(0)
  })
})
