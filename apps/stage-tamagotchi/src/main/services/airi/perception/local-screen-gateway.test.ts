import type { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import type { ObjectivePerceptionEvent } from '@proj-airi/stage-ui/domains/perception'

import { createContext, defineInvoke } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  electronLocalScreenAnalyze,
  electronLocalScreenValidate,
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  LOCAL_SCREEN_MODEL_REVISION,
  LOCAL_SCREEN_PROFILE_ID,
  LOCAL_SCREEN_QUANTIZATION_ID,
} from '../../../../shared/eventa/perception-local-screen'
import {
  electronLocalScreenConsentRegister,
  LOCAL_SCREEN_CONSENT_VERSION,
} from '../../../../shared/eventa/perception-local-screen-consent'
import { createLocalScreenConsentRegistry } from './local-screen-consent-registry'
import { createLocalScreenConsentService } from './local-screen-consent-service'
import { createLocalScreenGateway } from './local-screen-gateway'
import { LocalScreenGatewayError } from './local-transformers-screen'

const correlation = {
  contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
  sessionId: 'session:local-screen',
  generation: 2,
  observationId: 'observation:1',
} as const

function jpeg(): Uint8Array {
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])
}

function event(): ObjectivePerceptionEvent {
  return {
    contractVersion: 'perception/v0.3',
    eventId: 'observation:1:e0',
    observationId: correlation.observationId,
    sessionId: correlation.sessionId,
    generation: correlation.generation,
    sourceKind: 'screen-local',
    sourceId: 'screen:1',
    analyzers: ['qwen3-vl:screen-objective'],
    eventType: 'screen.activity.observed',
    phase: 'observed',
    subject: 'environment',
    value: { kind: 'enum', value: 'code' },
    confidence: 0.9,
    observedAt: 1_000,
    expiresAt: 31_000,
    verification: 'multi-frame-inferred',
    sensitivity: 'personal',
    provenance: {
      analyzerId: 'qwen3-vl:screen-objective',
      processing: 'local',
      providerId: 'transformers-service',
      modelId: LOCAL_SCREEN_MODEL_ID,
      adapterId: 'screen:transformers-local',
    },
  }
}

function status() {
  return {
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId: correlation.sessionId,
    generation: correlation.generation,
    profileId: LOCAL_SCREEN_PROFILE_ID,
    state: 'ready' as const,
    modelId: LOCAL_SCREEN_MODEL_ID,
    revision: LOCAL_SCREEN_MODEL_REVISION,
    quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
    capabilities: ['single-image'],
  }
}

function stream(frameCount = 1) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({
        ...correlation,
        type: 'open',
        consentGrantId: 'grant:screen-local',
        sourceId: 'screen:1',
        observedAt: 1_000,
      })
      for (let index = 0; index < frameCount; index++) {
        controller.enqueue({
          ...correlation,
          type: 'frame',
          sequence: index,
          capturedAt: 1_000 + index,
          width: 1280,
          height: 720,
          jpeg: jpeg(),
        })
      }
      controller.enqueue({ ...correlation, type: 'complete', endedAt: 1_100 })
      controller.close()
    },
  })
}

describe('local screen main Eventa gateway', () => {
  it('requires an active grant before lazy validation', async () => {
    const context = createContext()
    const manager = {
      validate: vi.fn(async () => status()),
      analyze: vi.fn(),
      stop: vi.fn(),
      status: vi.fn(),
      stopAll: vi.fn(),
    }
    createLocalScreenGateway({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      manager,
      consent: { isActive: () => false },
    })
    const validate = defineInvoke(context, electronLocalScreenValidate)
    await expect(validate({
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: correlation.sessionId,
      generation: correlation.generation,
      consentGrantId: 'grant:screen-local',
      profileId: LOCAL_SCREEN_PROFILE_ID,
    })).rejects.toMatchObject({ message: 'consent-missing' })
    expect(manager.validate).not.toHaveBeenCalled()
  })

  it('stays fail-closed until the strict consent service registers the matching generation', async () => {
    const context = createContext()
    const registry = createLocalScreenConsentRegistry({ now: () => 1_000 })
    const manager = {
      validate: vi.fn(async () => status()),
      analyze: vi.fn(),
      stop: vi.fn(),
      status: vi.fn(),
      stopAll: vi.fn(),
    }
    const electronContext = context as unknown as ReturnType<typeof createElectronContext>['context']
    createLocalScreenConsentService({ context: electronContext, registry })
    createLocalScreenGateway({ context: electronContext, manager, consent: registry })

    const validate = defineInvoke(context, electronLocalScreenValidate)
    const request = {
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: correlation.sessionId,
      generation: correlation.generation,
      consentGrantId: 'grant:screen-local',
      profileId: LOCAL_SCREEN_PROFILE_ID,
    } as const
    await expect(validate(request)).rejects.toMatchObject({ message: 'consent-missing' })

    const register = defineInvoke(context, electronLocalScreenConsentRegister)
    await register({
      contractVersion: LOCAL_SCREEN_CONSENT_VERSION,
      sessionId: correlation.sessionId,
      generation: correlation.generation,
      grant: {
        contractVersion: 'perception/v0.3',
        grantId: 'grant:screen-local',
        sourceKind: 'screen',
        sourceId: 'screen:1',
        processingMode: 'local-only',
        allowedModalities: ['screen-frames'],
        allowedFactCategories: ['screen.activity', 'screen.health'],
        grantedAt: 1_000,
        showPersistentIndicator: true,
      },
    })

    await expect(validate(request)).resolves.toMatchObject({ state: 'ready' })
    expect(manager.validate).toHaveBeenCalledOnce()
  })

  it('collects a bounded directed stream and releases the transient frame array', async () => {
    const context = createContext()
    let transientFrames: Uint8Array[] | undefined
    const manager = {
      validate: vi.fn(async () => status()),
      analyze: vi.fn(async (request) => {
        transientFrames = request.jpegFrames
        return {
          ...correlation,
          events: [event()],
          totalDurationMs: 4_000,
          outputTokenCount: 24,
        }
      }),
      stop: vi.fn(),
      status: vi.fn(),
      stopAll: vi.fn(),
    }
    createLocalScreenGateway({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      manager,
      consent: { isActive: () => true },
    })
    const analyze = defineInvoke(context, electronLocalScreenAnalyze)
    await expect(analyze(stream())).resolves.toMatchObject({ events: [{ eventType: 'screen.activity.observed' }] })
    expect(manager.analyze).toHaveBeenCalledTimes(1)
    expect(transientFrames).toHaveLength(0)
  })

  it('rejects more than four frames before calling the runtime', async () => {
    const context = createContext()
    const manager = {
      validate: vi.fn(async () => status()),
      analyze: vi.fn(),
      stop: vi.fn(),
      status: vi.fn(),
      stopAll: vi.fn(),
    }
    createLocalScreenGateway({
      context: context as unknown as ReturnType<typeof createElectronContext>['context'],
      manager,
      consent: { isActive: () => true },
    })
    const analyze = defineInvoke(context, electronLocalScreenAnalyze)
    await expect(analyze(stream(5))).rejects.toBeInstanceOf(LocalScreenGatewayError)
    expect(manager.analyze).not.toHaveBeenCalled()
  })
})
