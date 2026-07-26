import type { I18n } from '../../../libs/i18n'
import type { SettingsWindowManager } from '../../../windows/settings'
import type { MinecraftPairingNotifier } from './minecraft-pairing'

import { Notification } from 'electron'

import { createMinecraftPairingNotifier } from './minecraftPairingNotifier'

/**
 * Binds the pairing notification port to Electron's `Notification` and to the
 * settings window.
 *
 * Use when:
 * - Composing the main process, after the settings window manager exists
 *
 * Expects:
 * - To be called from the Electron main process; importing this module pulls in
 *   `electron`, which is why the notifier logic itself lives in the sibling
 *   `minecraftPairingNotifier.ts`
 *
 * Returns:
 * - A notifier ready to hand to `attachMinecraftPairingNotifier`
 */
export function createElectronMinecraftPairingNotifier(params: {
  i18n: I18n
  settingsWindow: SettingsWindowManager
}): MinecraftPairingNotifier {
  return createMinecraftPairingNotifier({
    i18n: params.i18n,
    createNotification: (options) => {
      const notification = new Notification(options)

      return {
        show: () => notification.show(),
        close: () => notification.close(),
        once: (event, listener) => {
          // `Electron.Notification` declares one `once` overload per literal event
          // name and hides the `EventEmitter` `string` overload it inherits, so the
          // union has to be narrowed here instead of forwarded as-is.
          // Source: `node_modules/electron/electron.d.ts:10175,10193,10218`.
          if (event === 'click') {
            notification.once('click', listener)
            return
          }
          if (event === 'close') {
            notification.once('close', listener)
            return
          }

          notification.once('failed', listener)
        },
      }
    },
    showPairingSurface: async (route) => {
      // `openWindow` creates the window when needed and already restores, shows
      // and focuses it through `toggleWindowShow`; `moveTop` additionally lifts
      // it above always-on-top surfaces such as the stage overlay.
      await params.settingsWindow.openWindow(route)
      const window = await params.settingsWindow.getWindow()
      window.moveTop()
    },
  })
}
