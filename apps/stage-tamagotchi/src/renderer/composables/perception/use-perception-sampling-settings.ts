import type {
  PerceptionSamplingRate,
  PerceptionSamplingSource,
} from '@proj-airi/stage-ui/domains/perception'
import type { StorageLike } from '@vueuse/core'

import {
  defaultPerceptionSamplingRate,
  parsePerceptionSamplingRate,
} from '@proj-airi/stage-ui/domains/perception'
import { useStorage } from '@vueuse/core'

const STORAGE_KEYS: Readonly<Record<PerceptionSamplingSource, string>> = {
  screen: 'settings/perception/sampling-rate/screen',
  camera: 'settings/perception/sampling-rate/camera',
}

export interface PerceptionSamplingSettings {
  screen: ReturnType<typeof useStorage<PerceptionSamplingRate>>
  camera: ReturnType<typeof useStorage<PerceptionSamplingRate>>
  set: (source: PerceptionSamplingSource, rate: PerceptionSamplingRate) => void
}

export interface PerceptionSamplingSettingsOptions {
  storage?: StorageLike
}

export function createPerceptionSamplingSettings(options: PerceptionSamplingSettingsOptions = {}): PerceptionSamplingSettings {
  const screen = createRateStorage('screen', options.storage)
  const camera = createRateStorage('camera', options.storage)
  return {
    screen,
    camera,
    set(source, rate) {
      if (source === 'screen')
        screen.value = rate
      else
        camera.value = rate
    },
  }
}

function createRateStorage(source: PerceptionSamplingSource, storage?: StorageLike): ReturnType<typeof useStorage<PerceptionSamplingRate>> {
  const fallback = defaultPerceptionSamplingRate(source)
  return useStorage<PerceptionSamplingRate>(STORAGE_KEYS[source], fallback, storage, {
    serializer: {
      read: raw => parsePerceptionSamplingRate(raw) ?? fallback,
      write: value => String(value),
    },
  })
}
