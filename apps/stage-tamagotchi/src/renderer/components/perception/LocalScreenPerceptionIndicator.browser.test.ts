import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import LocalScreenPerceptionIndicator from './LocalScreenPerceptionIndicator.vue'

describe('local screen perception indicator', () => {
  it('opens the bounded observation results from the persistent indicator', async () => {
    const onOpenDetails = vi.fn()
    const screen = render(LocalScreenPerceptionIndicator, {
      props: {
        status: {
          state: 'running',
          generation: 1,
          samplingRate: 2,
          modelId: 'Qwen/Qwen3-VL-4B-Instruct',
          acceptedFactCount: 1,
          captureAttemptCount: 1,
          acceptedFrameCount: 1,
          gateDroppedFrameCount: 0,
          analyzerReplacedFrameCount: 0,
          inferenceFactCount: 1,
          sensitiveSurfacePaused: false,
        },
        onOpenDetails,
      },
      global: {
        plugins: [createI18n({
          legacy: false,
          locale: 'en',
          messages: {
            en: {
              tamagotchi: {
                stage: {
                  'perception-screen': {
                    'state': { running: 'Desktop observation active' },
                    'local-only': 'Local only',
                    'indicator-description': 'Desktop observation is visible.',
                    'fact-count': '{count} fresh facts',
                    'view-results': 'View observation results',
                    'pause': 'Pause',
                    'enter-privacy-pause': 'Privacy pause',
                    'leave-privacy-pause': 'Leave privacy pause',
                    'stop': 'Stop and revoke',
                  },
                },
              },
            },
          },
        })],
      },
    })

    await screen.getByRole('button', { name: 'View observation results' }).click()

    expect(onOpenDetails).toHaveBeenCalledOnce()
  })
})
