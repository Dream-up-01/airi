import type { BrowserWindow } from 'electron'

/**
 * Applies animation coordinates without allowing a stale frame to crash the
 * Electron main process while its native window is being destroyed.
 */
export function trySetWindowPosition(window: BrowserWindow, x: number, y: number): boolean {
  if (window.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y))
    return false

  const roundedX = Math.round(x)
  const roundedY = Math.round(y)
  if (!Number.isFinite(roundedX) || !Number.isFinite(roundedY))
    return false

  try {
    window.setPosition(roundedX, roundedY)
    return true
  }
  catch {
    // The native window can be destroyed between isDestroyed() and this call.
    return false
  }
}
