import type { Handler, InvokeEventa, InvokeHandlerEventa } from '@moeru/eventa'
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler, defineStreamInvokeHandler } from '@moeru/eventa'

/** Event context produced by eventa's electron main adapter (`createContext(ipcMain, window)`). */
type ElectronMainEventContext = ReturnType<typeof createContext>['context']

/**
 * The subset of eventa's electron raw invoke options this module depends on.
 *
 * Every field is optional on purpose: the shape is only present when the invoke
 * actually arrived through `ipcMain`, so a handler must treat it as untrusted
 * and possibly absent.
 *
 * NOTICE:
 * We describe the shape locally instead of importing it because the electron main
 * adapter only exposes it inline inside the `createContext` return type and never
 * exports a named type for it.
 * Source: `node_modules/@moeru/eventa/dist/adapters/electron/main.d.mts` — the
 * `context: EventContext<{ invokeRequest?: { raw?: { ipcMainEvent: IpcMainEvent, event } } }, { raw: { ipcMainEvent: IpcMainEvent, event } }>`
 * member of `createContext`'s return type.
 * The value reaches handlers because `defineInvokeHandler` spreads the emit options
 * into the handler's second argument (`const handlerOptions = options ? { ...options, abortController } : { abortController }`,
 * `node_modules/@moeru/eventa/dist/index.mjs:404`, stream variant at `:1009`).
 * Removal condition: drop this local interface once `@moeru/eventa` exports the
 * electron raw invoke options as a public named type.
 */
export interface ElectronMainInvokeCallerOptions {
  /** Raw transport payload; only populated for invokes that came from a renderer over `ipcMain`. */
  raw?: {
    /** The originating `ipcMain` event. `sender.id` is the calling renderer's `webContents.id`. */
    ipcMainEvent?: { sender?: { id?: number } }
    /** The raw wire event body; unused here. */
    event?: unknown
  }
}

/**
 * Raised when an invoke reaches a handler that belongs to a different window.
 *
 * Use when:
 * - Asserting in tests that a cross-window invoke was refused before any side effect ran
 *
 * Expects:
 * - `expectedWebContentsId` is the `webContents.id` the handler was registered for
 * - `callerWebContentsId` is the observed caller id, or `undefined` when the invoke
 *   carried no `ipcMain` provenance at all
 *
 * Returns:
 * - An `Error` whose `message` is the stable identifier `cross-window-invocation-rejected`,
 *   so renderer-side and test-side matching never depends on the ids embedded in the fields
 */
export class CrossWindowInvocationError extends Error {
  constructor(
    readonly expectedWebContentsId: number,
    readonly callerWebContentsId: number | undefined,
  ) {
    super('cross-window-invocation-rejected')
    this.name = 'CrossWindowInvocationError'
  }
}

/**
 * Refuses to run a handler unless the invoke came from the window it was registered for.
 *
 * NOTICE:
 * Rejecting (instead of silently returning or leaving the invoke pending) is deliberate.
 * `withRemoval` registers listeners with `ipcMain.on(...)`
 * (`node_modules/@moeru/eventa/dist/adapters/electron/main.mjs:5`), so the listener is
 * process-global: an invoke sent by any renderer is emitted into *every* window context
 * that registered the same service, and every handler runs its side effects. The response
 * path then does `window.webContents.send(...)` (`:26`) toward the context's *bound* window
 * rather than the caller, and `onlySameWindow` defaults to `false` (`:12`) while only
 * filtering response delivery (`:25`) — it never prevents the handler from running.
 * Because of that, a cross-window response can never reach the real caller; the only thing
 * this guard can meaningfully protect is that the side effect does not happen. Throwing
 * keeps `defineInvokeHandler`'s `finally` block reachable so the per-invoke
 * `abortControllers`/`abortReasons` entries are released instead of leaking; the resulting
 * error response is misrouted to the bound window, where no pending invoke matches that
 * `invokeId` and it is dropped without side effects.
 * Prior art: `packages/electron-screen-capture/src/main/index.ts:231` already compares
 * `window.webContents.id` against `eventaOptions?.raw.ipcMainEvent.sender.id` inline, with a
 * FIXME noting that `onlySameWindow` does not filter handler execution. That call site returns
 * early rather than throwing, which still emits a success response toward the bound window; we
 * throw so the misdelivered response is an error and the guard reads the same everywhere.
 * Removal condition: delete this guard once `@moeru/eventa` supports window-namespaced
 * contexts so listeners are no longer process-global (see the `ipcMain.setMaxListeners(0)`
 * TODO in the window rpc setups).
 */
function assertSameWindowCaller(expectedWebContentsId: number, options: ElectronMainInvokeCallerOptions | undefined): void {
  const callerWebContentsId = options?.raw?.ipcMainEvent?.sender?.id
  // Fail closed: a missing sender id means we cannot prove the caller, so we refuse.
  if (callerWebContentsId !== expectedWebContentsId)
    throw new CrossWindowInvocationError(expectedWebContentsId, callerWebContentsId)
}

/**
 * Defines an invoke handler that only runs for invokes sent by one specific window.
 *
 * Use when:
 * - A service is registered once per window on the shared, process-global `ipcMain`
 *   listeners created by eventa's electron main adapter, and its handler mutates state
 *   (consent registries, capture sessions, sockets, content protection)
 * - Two or more windows register the same invoke event and must not observe each other's calls
 *
 * Expects:
 * - `expectedWebContentsId` is `window.webContents.id` of the window whose renderer is
 *   allowed to reach this handler, read at registration time (window rpc setup runs once
 *   per window instance, so the id is never stale)
 * - The invoke carries `ipcMain` provenance. Calls without a resolvable
 *   `raw.ipcMainEvent.sender.id` — a context emit that never crossed `ipcMain`, e.g. a unit
 *   test emitting directly into the context — are **rejected**. The check fails closed so it
 *   cannot be bypassed by omitting provenance.
 *
 * Returns:
 * - The cleanup function returned by `defineInvokeHandler`, unchanged, so existing
 *   `cleanups` arrays keep working
 * - On a caller mismatch: `handler` is never called and the invoke rejects with
 *   {@link CrossWindowInvocationError}
 */
export function defineWindowScopedInvokeHandler<Res, Req = undefined, ResErr = Error, ReqErr = Error, M = undefined, IM = undefined>(
  context: ElectronMainEventContext,
  event: InvokeHandlerEventa<Res, Req, ResErr, ReqErr, M, IM>,
  expectedWebContentsId: number,
  handler: Handler<Res, Req, ElectronMainEventContext, ElectronMainInvokeCallerOptions>,
): () => void {
  return defineInvokeHandler(context, event, (payload, options) => {
    assertSameWindowCaller(expectedWebContentsId, options)
    return handler(payload, options)
  })
}

/**
 * Stream-response counterpart of {@link defineWindowScopedInvokeHandler}.
 *
 * Use when:
 * - The invoke answers with a stream (`defineStreamInvokeHandler`) and its handler owns
 *   an external side effect such as an upstream socket or a media transport session
 *
 * Expects:
 * - Same caller rules as {@link defineWindowScopedInvokeHandler}, including fail-closed
 *   rejection when the invoke carries no `ipcMain` provenance
 * - For streamed requests eventa calls the handler once with the first chunk's options,
 *   so the caller is resolved from the first chunk and the generator body never starts
 *   for a foreign window
 *
 * Returns:
 * - `void`, matching `defineStreamInvokeHandler`, which registers listeners without
 *   handing back a removal function
 * - On a caller mismatch: `fn` is never called and the stream errors with
 *   {@link CrossWindowInvocationError}
 */
export function defineWindowScopedStreamInvokeHandler<Res, Req = undefined, ResErr = Error, ReqErr = Error>(
  context: ElectronMainEventContext,
  event: InvokeEventa<Res, Req, ResErr, ReqErr>,
  expectedWebContentsId: number,
  fn: (payload: Req, options?: { abortController?: AbortController } & ElectronMainInvokeCallerOptions) => AsyncGenerator<Res, void, unknown>,
): void {
  defineStreamInvokeHandler(context, event, async function* (payload, options) {
    assertSameWindowCaller(expectedWebContentsId, options)
    yield* fn(payload, options)
  })
}
