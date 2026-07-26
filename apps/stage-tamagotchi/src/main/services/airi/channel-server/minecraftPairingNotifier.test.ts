// Found by code review 2026-07-26 (M3 perception review); no tracker issue exists.
//
// `minecraft-pairing.test.ts` covers the manager side of the
// `MinecraftPairingNotifier` contract (which requests get announced, and when).
// This file covers the port itself: the notification it builds from the locale
// bundle, the strong reference it must hold so Electron cannot collect a pending
// toast, and the deep link it opens when the user clicks that toast.

import type { Mock } from 'vitest'

import type { I18n } from '../../../libs/i18n'
import type { MinecraftPairingNotice } from './minecraft-pairing'
import type {
  PairingNotificationEvent,
  PairingNotificationHandle,
  PairingNotificationOptions,
} from './minecraftPairingNotifier'

import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { perceptionSettingsRoute } from '../../../../shared/perceptionDeepLink'
import { createMinecraftPairingNotifier } from './minecraftPairingNotifier'

/**
 * Locale keys the notification copy must be resolved through.
 *
 * Defined in `packages/i18n/src/locales/*\/tamagotchi/stage.yaml`; the body
 * message interpolates `{device}` and `{code}`.
 */
const notificationTitleKey = 'tamagotchi.stage.perception-minecraft.pairing.notification.title'
const notificationBodyKey = 'tamagotchi.stage.perception-minecraft.pairing.notification.body'

/** One translation call observed on the injected {@link I18n} double. */
interface RecordedTranslation {
  key: string
  /** First argument as received, which is the named-interpolation bag when present. */
  named: unknown
}

/** One notification handle the notifier asked the platform factory to build. */
interface RecordedNotification {
  /** Options the notifier handed to the factory, captured by reference. */
  options: PairingNotificationOptions
  show: Mock<() => void>
  close: Mock<() => void>
  /** Fires (and consumes) the one-shot listeners registered for `event`. */
  emit: (event: PairingNotificationEvent) => void
}

/**
 * i18n double that echoes the requested key together with its interpolation
 * values, so assertions can prove the notification copy is resolved through
 * `packages/i18n` instead of being spelled out inside the notifier.
 *
 * @example
 * const { i18n, translations } = createRecordingI18n()
 * i18n.t('a.key', { device: 'Steve' }) // => 'a.key[device=Steve]'
 * // translations => [{ key: 'a.key', named: { device: 'Steve' } }]
 */
function createRecordingI18n(): { i18n: I18n, translations: RecordedTranslation[] } {
  const translations: RecordedTranslation[] = []

  const t: I18n['t'] = (key: string, ...args: unknown[]) => {
    const named = args[0]
    translations.push({ key, named })

    if (named == null || typeof named !== 'object')
      return key

    const values = Object.entries(named).map(([name, value]) => `${name}=${String(value)}`).join(' ')
    return `${key}[${values}]`
  }

  return { i18n: { t, locale: () => 'en' }, translations }
}

/**
 * Platform notification double that records every handle the notifier creates.
 *
 * `once` is modelled as one-shot, matching `Electron.Notification`, so the same
 * lifecycle event cannot release a notification twice.
 *
 * @example
 * const { created, createNotification } = createNotificationRecorder()
 * // after `onRequested`: created[0].emit('click')
 */
function createNotificationRecorder(behaviour: { showError?: Error } = {}): {
  created: RecordedNotification[]
  createNotification: (options: PairingNotificationOptions) => PairingNotificationHandle
} {
  const created: RecordedNotification[] = []

  return {
    created,
    createNotification: (options) => {
      const listeners = new Map<PairingNotificationEvent, Array<() => void>>()

      const show = vi.fn<() => void>(() => {
        if (behaviour.showError)
          throw behaviour.showError
      })
      const close = vi.fn<() => void>()

      created.push({
        options,
        show,
        close,
        emit: (event) => {
          const pending = listeners.get(event) ?? []
          listeners.delete(event)
          pending.forEach(listener => listener())
        },
      })

      return {
        show,
        close,
        once: (event, listener) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener])
        },
      }
    },
  }
}

/**
 * Wires the notifier under test to the doubles above.
 *
 * @example
 * const { notifier, created } = createNotifierHarness({ showError: new Error('boom') })
 * // created is empty until `notifier.onRequested(...)` runs
 */
function createNotifierHarness(behaviour: { showError?: Error, surfaceError?: Error } = {}): {
  notifier: ReturnType<typeof createMinecraftPairingNotifier>
  created: RecordedNotification[]
  translations: RecordedTranslation[]
  showPairingSurface: Mock<(route: string) => Promise<void>>
} {
  const { i18n, translations } = createRecordingI18n()
  const { created, createNotification } = createNotificationRecorder({ showError: behaviour.showError })
  const showPairingSurface = vi.fn((_route: string) => behaviour.surfaceError
    ? Promise.reject(behaviour.surfaceError)
    : Promise.resolve())

  const notifier = createMinecraftPairingNotifier({ i18n, createNotification, showPairingSurface })

  return { notifier, created, translations, showPairingSurface }
}

/**
 * Builds the non-sensitive notice `MinecraftPairingManager` hands to the port.
 *
 * @example
 * pairingNotice({ requestId: 'req-2' })
 * // => { requestId: 'req-2', displayName: 'Fabric on Steve', verificationCode: '482913', expiresAt: ... }
 */
function pairingNotice(overrides: Partial<MinecraftPairingNotice> = {}): MinecraftPairingNotice {
  return {
    requestId: 'req-1',
    displayName: 'Fabric on Steve',
    verificationCode: '482913',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe('minecraft pairing notifier', () => {
  it('shows one notification whose title and body are resolved through i18n', () => {
    const { notifier, created, translations } = createNotifierHarness()

    notifier.onRequested(pairingNotice({ displayName: 'Fabric on Steve', verificationCode: '482913' }))

    expect(created).toHaveLength(1)
    expect(created[0].show).toHaveBeenCalledTimes(1)
    expect(created[0].close).not.toHaveBeenCalled()
    expect(created[0].options.title).toBe(notificationTitleKey)
    // The verification code has to survive into the visible copy: it is what the
    // user compares against the code the game shows.
    expect(created[0].options.body).toBe(`${notificationBodyKey}[device=Fabric on Steve code=482913]`)
    expect(translations).toEqual([
      { key: notificationTitleKey, named: undefined },
      { key: notificationBodyKey, named: { device: 'Fabric on Steve', code: '482913' } },
    ])
  })

  it('withdraws only the still-live notification belonging to the resolved request', () => {
    const { notifier, created } = createNotifierHarness()
    expect(typeof notifier.onResolved).toBe('function')

    notifier.onRequested(pairingNotice({ requestId: 'req-1' }))
    notifier.onRequested(pairingNotice({ requestId: 'req-2' }))
    expect(created).toHaveLength(2)

    notifier.onResolved?.('req-1')
    expect(created[0].close).toHaveBeenCalledTimes(1)
    expect(created[1].close).not.toHaveBeenCalled()

    // Approval followed by the expiry timer resolves the same request twice; the
    // entry is gone, so the already withdrawn notification is not closed again.
    notifier.onResolved?.('req-1')
    expect(created[0].close).toHaveBeenCalledTimes(1)

    notifier.onResolved?.('unknown-request')
    expect(created[1].close).not.toHaveBeenCalled()
  })

  it('drops the strong reference once the notification closes, fails or is clicked', () => {
    const { notifier, created } = createNotifierHarness()
    expect(typeof notifier.onResolved).toBe('function')

    const lifecycleEvents: PairingNotificationEvent[] = ['close', 'failed', 'click']
    lifecycleEvents.forEach((event, index) => {
      const requestId = `req-${event}`
      notifier.onRequested(pairingNotice({ requestId }))
      created[index].emit(event)

      // The preceding test is the positive control: while the handle is still
      // held, `onResolved` closes it. Nothing being closed here means the entry
      // was released, so the map does not leak one handle per notification for
      // the lifetime of the main process.
      notifier.onResolved?.(requestId)
      expect(created[index].close).not.toHaveBeenCalled()
    })

    expect(created).toHaveLength(3)
  })

  it('opens the perception pairing panel on the deep-link route when clicked', () => {
    const { notifier, created, showPairingSurface } = createNotifierHarness()

    notifier.onRequested(pairingNotice({ requestId: 'req-click' }))
    expect(showPairingSurface).not.toHaveBeenCalled()

    created[0].emit('click')

    expect(showPairingSurface).toHaveBeenCalledTimes(1)
    expect(showPairingSurface).toHaveBeenCalledWith(perceptionSettingsRoute('minecraft', 'req-click'))
  })

  it('swallows a failing pairing surface instead of rejecting into the main process', async () => {
    const unhandled: unknown[] = []
    const captureUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }

    // The click listener voids `openPairingSurface`, so a missing catch would not
    // throw out of `emit` — it would surface as a process-level unhandled
    // rejection, which crashes the Electron main process.
    process.on('unhandledRejection', captureUnhandledRejection)
    try {
      const surfaceError = new Error('settings window unavailable')
      const { notifier, created, showPairingSurface } = createNotifierHarness({ surfaceError })

      notifier.onRequested(pairingNotice({ requestId: 'req-surface-fails' }))

      expect(() => created[0].emit('click')).not.toThrow()
      expect(showPairingSurface).toHaveBeenCalledTimes(1)

      // Let the voided promise settle, then give Node a full turn of the event
      // loop to report an unhandled rejection before asserting none was reported.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    }
    finally {
      process.off('unhandledRejection', captureUnhandledRejection)
    }
  })

  it('releases the strong reference when the platform refuses to show the notification', () => {
    const showError = new Error('notification centre unavailable')
    const { notifier, created } = createNotifierHarness({ showError })
    expect(typeof notifier.onResolved).toBe('function')

    // Rethrowing is the current contract: `MinecraftPairingManager` treats the
    // notifier as untrusted infrastructure and swallows the failure
    // (`minecraft-pairing.ts:228-243`, covered by `minecraft-pairing.test.ts`).
    // What must not happen is the handle staying in the live map, since a
    // notification that never reached the OS can never emit `close`.
    expect(() => notifier.onRequested(pairingNotice({ requestId: 'req-show-fails' }))).toThrow('notification centre unavailable')
    expect(created).toHaveLength(1)
    expect(created[0].show).toHaveBeenCalledTimes(1)

    notifier.onResolved?.('req-show-fails')
    expect(created[0].close).not.toHaveBeenCalled()
  })

  it('keeps the toast in the action centre on platforms that auto-dismiss it', () => {
    const { notifier, created } = createNotifierHarness()

    notifier.onRequested(pairingNotice())

    // NOTICE:
    // Only the branch matching the current runner is observable here.
    // Root cause: the notifier reads `isMacOS` from `std-env`, a module-level
    // constant evaluated when the module is first imported, so neither branch can
    // be selected from a test without mocking `std-env` or rewriting
    // `process.platform` on the global object (forbidden by AGENTS.md).
    // Source: `minecraftPairingNotifier.ts:96`; std-env@4.1.0 computes it once at
    // import time as `/^darwin/i.test(process.platform)`
    // (`node_modules/.pnpm/std-env@4.1.0/node_modules/std-env/dist/index.mjs:1`).
    // The expectation is derived from `process.platform` rather than from the
    // same constant the implementation reads, so an inverted mapping still fails.
    // Removal condition: `isMacOS` becomes an injectable option on
    // `PairingNotifierOptions`, after which both branches can be asserted here.
    if (process.platform === 'darwin')
      expect(created[0].options).not.toHaveProperty('timeoutType')
    else
      expect(created[0].options.timeoutType).toBe('never')
  })
})
