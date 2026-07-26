import type { QwenCloudGrantRegisterRequest } from '../../../../shared/eventa/perception-cloud'

import {
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it } from 'vitest'

import { QWEN_CLOUD_GRANT_VERSION } from '../../../../shared/eventa/perception-cloud'
import { QwenCloudGrantRegistry } from './qwen-cloud-grant-registry'

function request(grantId: string, modality: 'camera-frames' | 'microphone-audio'): QwenCloudGrantRegisterRequest {
  return {
    contractVersion: QWEN_CLOUD_GRANT_VERSION,
    sessionId: 'session:camera',
    generation: 1,
    grant: {
      contractVersion: 'perception/v0.3' as const,
      grantId,
      sourceKind: 'camera' as const,
      sourceId: 'camera:default',
      processingMode: 'mixed' as const,
      allowedModalities: [modality],
      allowedFactCategories: ['person.presence'],
      cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
      cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
      regionId: QWEN_CLOUD_REGION_ID,
      costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
      grantedAt: 1_000,
      showPersistentIndicator: true,
    },
  }
}

describe('qwenCloudGrantRegistry', () => {
  it('requires independent frame and audio grants for one exact generation', () => {
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    registry.register(request('grant:frame', 'camera-frames'))
    expect(registry.authorize({
      sessionId: 'session:camera',
      generation: 1,
      sourceKind: 'camera-cloud',
      sourceId: 'camera:default',
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      frameGrantId: 'grant:frame',
      audioGrantId: 'grant:audio',
    })).toBe(false)

    registry.register(request('grant:audio', 'microphone-audio'))
    expect(registry.authorize({
      sessionId: 'session:camera',
      generation: 1,
      sourceKind: 'camera-cloud',
      sourceId: 'camera:default',
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      frameGrantId: 'grant:frame',
      audioGrantId: 'grant:audio',
    })).toBe(true)
  })

  it('revocation immediately removes authorization', () => {
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    registry.register(request('grant:frame', 'camera-frames'))
    registry.register(request('grant:audio', 'microphone-audio'))
    registry.revoke({
      contractVersion: QWEN_CLOUD_GRANT_VERSION,
      sessionId: 'session:camera',
      generation: 1,
      grantId: 'grant:audio',
      reason: 'permission-revoked',
    })
    expect(registry.authorize({
      sessionId: 'session:camera',
      generation: 1,
      sourceKind: 'camera-cloud',
      sourceId: 'camera:default',
      modelId: QWEN_FLASH_REALTIME_MODEL_ID,
      frameGrantId: 'grant:frame',
      audioGrantId: 'grant:audio',
    })).toBe(false)
  })

  it('isolates grants for concurrent screen and camera sessions under one renderer owner', () => {
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    registry.register(request('grant:camera-frame', 'camera-frames'))
    const screen = request('grant:screen-frame', 'camera-frames')
    screen.sessionId = 'session:screen'
    screen.grant.sourceKind = 'screen'
    screen.grant.sourceId = 'screen:1'
    screen.grant.allowedModalities = ['screen-frames']
    registry.register(screen)
    expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual(['grant:camera-frame'])
    expect(registry.snapshot('session:screen', 1).activeGrantIds).toEqual(['grant:screen-frame'])
  })

  it('clears only grants owned by the renderer that closed', () => {
    const registry = new QwenCloudGrantRegistry({ now: () => 1_000 })
    registry.register(request('grant:main', 'camera-frames'), 'renderer:main')
    const settings = request('grant:settings', 'microphone-audio')
    settings.sessionId = 'session:settings'
    registry.register(settings, 'renderer:settings')

    expect(registry.clearOwner('renderer:settings')).toEqual(['grant:settings'])
    expect(registry.snapshot('session:camera', 1).activeGrantIds).toEqual(['grant:main'])
    expect(registry.snapshot('session:settings', 1).activeGrantIds).toEqual([])
  })
})
