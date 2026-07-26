/**
 * Deep-link contract between out-of-band main-process surfaces (OS
 * notifications, tray) and the renderer perception control surface.
 *
 * The main process can only reach the perception UI by asking the settings
 * window to navigate to a route, so the route shape and the query values are a
 * cross-process contract and live here instead of being spelled out on both
 * sides.
 */

/**
 * Perception source tabs a deep link may preselect.
 *
 * Mirrors the tab list rendered by
 * `renderer/components/perception/PerceptionControlSurface.vue`.
 */
export const perceptionSourceKinds = ['screen', 'camera', 'minecraft', 'cloud'] as const

/** One of the perception tabs a deep link may preselect. */
export type PerceptionSourceKind = (typeof perceptionSourceKinds)[number]

/** Query parameter carrying the perception tab a deep link wants selected. */
export const perceptionSourceQueryParam = 'source'

/**
 * Query parameter carrying the pairing request a notification deep link was
 * raised for.
 *
 * NOTICE:
 * It also keeps consecutive deep links textually distinct, which is required
 * for the tab to change when the settings window is already open.
 * Root cause: `renderer/App.vue` ignores a navigation whose target equals the
 * current `route.fullPath`, so two notifications resolving to the exact same
 * route would leave the surface on whatever tab the user last picked.
 * Source: `apps/stage-tamagotchi/src/renderer/App.vue:320-330`.
 * Removal condition: drop once the pairing panel is reachable through an event
 * that does not go through router navigation.
 */
export const pairingRequestQueryParam = 'pairingRequest'

/** Renderer route of the perception settings page (`pages/settings/modules/perception.vue`). */
const perceptionSettingsPath = '/settings/modules/perception'

/**
 * Resolves a router query value into a perception tab.
 *
 * Use when:
 * - Picking the initial perception tab while mounting the control surface
 * - Reacting to deep-link query changes while the surface stays mounted
 *
 * Expects:
 * - `value` straight out of `route.query[...]`, so `string`, `string[]`, `null`
 *   or `undefined` are all valid inputs
 *
 * Returns:
 * - The matching tab, or `undefined` when the value is absent or not a known
 *   tab, so callers can keep their own default instead of handling an error
 */
export function resolvePerceptionSourceKind(value: unknown): PerceptionSourceKind | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string')
    return undefined

  return perceptionSourceKinds.find(kind => kind === candidate)
}

/**
 * Builds the settings route that opens the perception page with one tab preselected.
 *
 * Use when:
 * - The main process needs to hand a route to `SettingsWindowManager.openWindow`
 *
 * Expects:
 * - `pairingRequestId` only for pairing notifications; omit it elsewhere
 *
 * Returns:
 * - A hash-router path with an encoded query string
 *
 * @example
 * perceptionSettingsRoute('minecraft', 'req-1')
 * // => '/settings/modules/perception?source=minecraft&pairingRequest=req-1'
 */
export function perceptionSettingsRoute(kind: PerceptionSourceKind, pairingRequestId?: string): string {
  const query = new URLSearchParams({ [perceptionSourceQueryParam]: kind })
  if (pairingRequestId)
    query.set(pairingRequestQueryParam, pairingRequestId)

  return `${perceptionSettingsPath}?${query.toString()}`
}
