import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, watch } from 'vue'

import { createPerceptionSamplingSettings } from './use-perception-sampling-settings'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

describe('perception sampling settings', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it('keeps screen and camera rates independent and validates storage', () => {
    storage.setItem('settings/perception/sampling-rate/screen', '30')
    storage.setItem('settings/perception/sampling-rate/camera', 'bogus')

    const settings = createPerceptionSamplingSettings({ storage })

    expect(settings.screen.value).toBe(30)
    expect(settings.camera.value).toBe(10)
    settings.set('screen', 5)
    expect(settings.screen.value).toBe(5)
    expect(settings.camera.value).toBe(10)
  })

  it('notifies local and cloud consumers through the same source ref', async () => {
    const settings = createPerceptionSamplingSettings({ storage })
    const localConsumer: number[] = []
    const cloudConsumer: number[] = []
    const stopLocal = watch(settings.screen, rate => localConsumer.push(rate))
    const stopCloud = watch(settings.screen, rate => cloudConsumer.push(rate))

    settings.set('screen', 30)
    await nextTick()

    expect(localConsumer).toEqual([30])
    expect(cloudConsumer).toEqual([30])
    stopLocal()
    stopCloud()
  })
})
