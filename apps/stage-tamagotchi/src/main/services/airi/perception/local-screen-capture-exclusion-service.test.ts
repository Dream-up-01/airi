import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  electronLocalScreenCaptureExclusion,
  LOCAL_SCREEN_CONSENT_VERSION,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenCaptureExclusionService } from './local-screen-capture-exclusion-service'
import { createLocalScreenConsentRegistry } from './local-screen-consent-registry'

function register(registry: ReturnType<typeof createLocalScreenConsentRegistry>) {
  registry.register({
    contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
    sessionId: 'session:screen',
    generation: 1,
    grant: {
      contractVersion: 'perception/v0.3',
      grantId: 'grant:screen',
      sourceKind: 'screen',
      sourceId: 'screen:1',
      processingMode: 'local-only',
      allowedModalities: ['screen-frames'],
      allowedFactCategories: ['screen.activity'],
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  })
}

describe('local screen capture exclusion service', () => {
  it('requires consent and restores capturability during cleanup', async () => {
    const context = createContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    const setContentProtection = vi.fn()
    const cleanup = createLocalScreenCaptureExclusionService({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      registry,
      window: { setContentProtection },
    })
    const setExclusion = defineInvoke(context, electronLocalScreenCaptureExclusion)
    const request = {
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen',
      enabled: true,
    } as const

    await expect(setExclusion(request)).rejects.toMatchObject({ message: 'consent-missing' })
    expect(setContentProtection).not.toHaveBeenCalled()

    register(registry)
    await expect(setExclusion(request)).resolves.toMatchObject({ enabled: true })
    expect(setContentProtection).toHaveBeenLastCalledWith(true)

    cleanup()
    expect(setContentProtection).toHaveBeenLastCalledWith(false)
  })
})
