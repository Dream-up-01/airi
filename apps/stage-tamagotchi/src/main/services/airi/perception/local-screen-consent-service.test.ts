import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'

import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it } from 'vitest'

import {
  electronLocalScreenConsentRegister,
  electronLocalScreenConsentRevoke,
  electronLocalScreenConsentStatus,
  LOCAL_SCREEN_CONSENT_VERSION,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenConsentRegistry } from './local-screen-consent-registry'
import { createLocalScreenConsentService } from './local-screen-consent-service'

function grant() {
  return {
    contractVersion: 'perception/v0.3' as const,
    grantId: 'grant:screen-local',
    sourceKind: 'screen' as const,
    sourceId: 'screen:primary',
    processingMode: 'local-only' as const,
    allowedModalities: ['screen-frames' as const],
    allowedFactCategories: ['screen.activity', 'screen.health'],
    grantedAt: 1_000,
    showPersistentIndicator: true,
  }
}

describe('local screen consent Eventa service', () => {
  it('registers, reports and revokes the same strict memory-only grant', async () => {
    const context = createContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    createLocalScreenConsentService({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      registry,
    })
    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    const status = defineInvoke(context, electronLocalScreenConsentStatus)
    const revoke = defineInvoke(context, electronLocalScreenConsentRevoke)

    await expect(register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: grant(),
    })).resolves.toMatchObject({ activeGrantIds: ['grant:screen-local'] })
    await expect(status({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
    })).resolves.toMatchObject({ activeSourceIds: ['screen:primary'] })
    await expect(revoke({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grantId: 'grant:screen-local',
      reason: 'user-stop',
    })).resolves.toMatchObject({ activeGrantIds: [] })
  })

  it('rejects a cloud-expanded grant at the main inbound boundary', async () => {
    const context = createContext()
    createLocalScreenConsentService({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      registry: createLocalScreenConsentRegistry(),
    })
    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    await expect(register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: 'session:screen',
      generation: 1,
      grant: {
        ...grant(),
        processingMode: 'cloud-approved',
        cloudProviderId: 'aliyun',
        cloudModelId: 'qwen3.5-omni-flash-realtime',
        regionId: 'cn-beijing',
        costBoundaryId: 'budget:1',
      },
    })).rejects.toMatchObject({ message: 'consent-policy-violation' })
  })
})
