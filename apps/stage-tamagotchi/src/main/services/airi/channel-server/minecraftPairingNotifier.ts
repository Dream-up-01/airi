import type { I18n } from '../../../libs/i18n'
import type { MinecraftPairingNotice, MinecraftPairingNotifier } from './minecraft-pairing'

import { useLogg } from '@guiiai/logg'
import { isMacOS } from 'std-env'

import { perceptionSettingsRoute } from '../../../../shared/perceptionDeepLink'

/** Lifecycle events the pairing notifier reacts to on a system notification. */
export type PairingNotificationEvent = 'click' | 'close' | 'failed'

/** Options handed to the platform notification factory. */
export interface PairingNotificationOptions {
  title: string
  body: string
  /**
   * `'never'` keeps the toast in the OS action centre until the user acts on it.
   * Windows and Linux only; macOS ignores it.
   */
  timeoutType?: 'default' | 'never'
}

/**
 * Narrow view of `Electron.Notification` used by the pairing notifier.
 *
 * Declared structurally so the notifier can be exercised without an Electron
 * runtime; `minecraftPairingNotifier.electron.ts` adapts the real class onto it.
 */
export interface PairingNotificationHandle {
  show: () => void
  /** Withdraws the notification from the OS action centre. */
  close: () => void
  /** Registers a one-shot lifecycle listener. */
  once: (event: PairingNotificationEvent, listener: () => void) => void
}

export interface PairingNotifierOptions {
  /** Supplies the notification title and body; the code must stay visible to the user. */
  i18n: I18n
  /** Creates a platform notification. Injected at the Electron boundary to keep this module testable. */
  createNotification: (options: PairingNotificationOptions) => PairingNotificationHandle
  /** Brings the perception settings surface forward on the given deep-link route. */
  showPairingSurface: (route: string) => Promise<void>
}

/**
 * Builds the out-of-band pairing approval surface backed by OS notifications.
 *
 * Use when:
 * - Wiring `MinecraftPairingManager` so pairing requests remain approvable while
 *   no perception panel is open
 *
 * Expects:
 * - `createNotification` to return an unshown handle; this function calls `show`
 * - `showPairingSurface` to resolve once the settings window is visible
 *
 * Returns:
 * - A notifier that shows one notification per request, deep-links to the
 *   Minecraft pairing panel on click, and withdraws the notification once the
 *   request is approved, rejected or expired
 */
export function createMinecraftPairingNotifier(options: PairingNotifierOptions): MinecraftPairingNotifier {
  const log = useLogg('minecraft-pairing-notifier').useGlobalConfig()

  // NOTICE:
  // Electron may GC a `Notification` once the constructor scope returns, which
  // silently drops its `click` handler before the user interacts. Hold a strong
  // reference until the notification is dismissed (`click` / `close`) or fails.
  // Keyed by request id so `onResolved` can also withdraw a notification whose
  // request is no longer actionable.
  // Source: same root cause and pattern as
  // `apps/stage-tamagotchi/src/main/windows/spotlight/index.ts:63-99`.
  // Removal condition: Electron guaranteeing that pending notifications are
  // retained by the platform layer.
  const liveNotifications = new Map<string, PairingNotificationHandle>()

  async function openPairingSurface(requestId: string): Promise<void> {
    try {
      await options.showPairingSurface(perceptionSettingsRoute('minecraft', requestId))
    }
    catch (error) {
      log.withError(error).warn(`Failed to open the Minecraft pairing panel for ${requestId}`)
    }
  }

  function onRequested(notice: MinecraftPairingNotice): void {
    const notification = options.createNotification({
      title: options.i18n.t('tamagotchi.stage.perception-minecraft.pairing.notification.title'),
      body: options.i18n.t('tamagotchi.stage.perception-minecraft.pairing.notification.body', {
        device: notice.displayName,
        code: notice.verificationCode,
      }),
      // Windows and Linux auto-dismiss toasts after a few seconds, which would
      // drop the only out-of-band entry point into the approval panel. macOS has
      // no equivalent knob, matching `windows/spotlight/index.ts:87`.
      ...(isMacOS ? {} : { timeoutType: 'never' as const }),
    })

    liveNotifications.set(notice.requestId, notification)
    const release = () => {
      liveNotifications.delete(notice.requestId)
    }

    notification.once('close', release)
    notification.once('failed', release)
    notification.once('click', () => {
      release()
      void openPairingSurface(notice.requestId)
    })

    try {
      notification.show()
    }
    catch (error) {
      // A notification that never reached the OS can never emit `close`, so drop
      // the strong reference here instead of retaining it for the process life.
      release()
      throw error
    }
  }

  function onResolved(requestId: string): void {
    const notification = liveNotifications.get(requestId)
    if (!notification)
      return

    liveNotifications.delete(requestId)
    notification.close()
  }

  return { onRequested, onResolved }
}
