import type { BrowserWindow } from 'electron'

import { describe, expect, it, vi } from 'vitest'

import { trySetWindowPosition } from './window-position'

function createWindow(options?: { destroyed?: boolean, setPositionError?: Error }) {
  const setPosition = options?.setPositionError
    ? vi.fn(() => { throw options.setPositionError })
    : vi.fn()

  return {
    isDestroyed: vi.fn(() => options?.destroyed ?? false),
    setPosition,
  } as unknown as BrowserWindow
}

describe('trySetWindowPosition', () => {
  it('rounds finite animation coordinates before applying them', () => {
    const window = createWindow()

    expect(trySetWindowPosition(window, 120.6, -40.4)).toBe(true)
    expect(window.setPosition).toHaveBeenCalledWith(121, -40)
  })

  it.each([
    [Number.NaN, 10],
    [10, Number.NaN],
    [Number.POSITIVE_INFINITY, 10],
    [10, Number.NEGATIVE_INFINITY],
  ])('rejects non-finite coordinates (%s, %s)', (x, y) => {
    const window = createWindow()

    expect(trySetWindowPosition(window, x, y)).toBe(false)
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('does not call Electron after the window is destroyed', () => {
    const window = createWindow({ destroyed: true })

    expect(trySetWindowPosition(window, 10, 20)).toBe(false)
    expect(window.setPosition).not.toHaveBeenCalled()
  })

  it('contains a native destruction race instead of crashing the main process', () => {
    const window = createWindow({ setPositionError: new TypeError('conversion failure') })

    expect(trySetWindowPosition(window, 10, 20)).toBe(false)
    expect(window.setPosition).toHaveBeenCalledWith(10, 20)
  })
})
