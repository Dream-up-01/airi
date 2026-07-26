import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useVisionOrchestratorStore } from './orchestrator'
import { useVisionStore } from './store'

const runVisionInference = vi.fn()

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../../composables/vision', () => ({
  useVisionInference: () => ({
    runVisionInference,
  }),
}))

describe('vision orchestrator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runVisionInference.mockReset()
    runVisionInference.mockResolvedValue('Frame summary')

    const visionStore = useVisionStore()
    visionStore.activeProvider = 'mock-provider'
    visionStore.activeModel = 'mock-model'
  })

  it('keeps raw frames out of Pinia state and never reports a context publication', async () => {
    const store = useVisionOrchestratorStore()

    const result = await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,raw-screen-secret',
      workloadId: 'screen:interpret',
    })

    expect(result).toEqual({ contextUpdates: 0, text: 'Frame summary' })
    expect(JSON.stringify(store.$state)).not.toContain('raw-screen-secret')
    expect(JSON.stringify(store.$state)).not.toContain('imageDataUrl')
  })

  it('returns the provider result without retaining it in Pinia', async () => {
    const store = useVisionOrchestratorStore()

    const result = await store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,frame',
      workloadId: 'screen:understand',
    })

    expect(result.contextUpdates).toBe(0)
    expect(result.text).toBe('Frame summary')
    expect(JSON.stringify(store.$state)).not.toContain('Frame summary')
  })

  it('records inference failures on the store before rethrowing', async () => {
    const store = useVisionOrchestratorStore()
    runVisionInference.mockRejectedValueOnce(new Error('Vision inference failed'))

    await expect(store.processCapture({
      imageDataUrl: 'data:image/jpeg;base64,broken',
      workloadId: 'screen:interpret',
    })).rejects.toThrow('Vision inference failed')

    expect(store.lastError).toBe('Vision inference failed')
  })
})
