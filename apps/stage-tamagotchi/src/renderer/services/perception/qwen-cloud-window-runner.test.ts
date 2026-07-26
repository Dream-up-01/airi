import type { PerceptionConsentGrant } from '@proj-airi/stage-ui/domains/perception'

import {
  QWEN_CLOUD_COST_BOUNDARY_ID,
  QWEN_CLOUD_PRICE_PROFILE_ID,
  QWEN_CLOUD_PROVIDER_ID,
  QWEN_CLOUD_REGION_ID,
  QWEN_FLASH_REALTIME_MODEL_ID,
} from '@proj-airi/stage-ui/domains/perception'
import { describe, expect, it, vi } from 'vitest'

import { QwenCloudWindowRunner } from './qwen-cloud-window-runner'

describe('qwenCloudWindowRunner', () => {
  it('builds one bounded window and ingests completed objective events through the state manager', async () => {
    const release = vi.fn()
    const projections: unknown[] = []
    let finish!: () => void
    const completed = new Promise<void>(resolve => finish = resolve)
    const client = {
      run: vi.fn(async (input: Parameters<import('./qwen-cloud-media-client').QwenCloudMediaClient['run']>[0]) => {
        const messages = []
        for await (const message of input.messages)
          messages.push(message)
        expect(messages.map(message => message.type)).toEqual(['open', 'audio-chunk', 'image-frame', 'complete'])
        expect(messages[0]).toMatchObject({ frameConsentGrantId: 'grant:frame', audioConsentGrantId: 'grant:audio' })
        finish()
        return {
          responseId: 'response:1',
          observationId: 'observation:1',
          sourceKind: 'screen-cloud' as const,
          modelId: QWEN_FLASH_REALTIME_MODEL_ID,
          completedText: JSON.stringify({ events: [{
            eventType: 'screen.app-class.observed',
            value: { kind: 'enum', value: 'code-editor' },
            confidence: 0.9,
          }] }),
          usage: { inputTextImageTokens: 10, inputAudioTokens: 10, outputTextTokens: 10, outputAudioTokens: 0 },
          amountMicros: 1,
          priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
        }
      }),
    }
    const runner = new QwenCloudWindowRunner({
      client,
      now: () => 2_000,
      id: prefix => `${prefix}:1`,
      onProjection: projection => projections.push(projection),
    })
    runner.start(startInput())
    runner.offerAudio({ sequence: 1, capturedAt: 1_900, monotonicTimestamp: 10, pcm: new Uint8Array([1, 0, 2, 0]) })
    runner.offerFrame({
      frameId: 'frame:1',
      observationId: 'observation:1',
      capturedAt: 1_950,
      monotonicTimestamp: 20,
      width: 1280,
      height: 720,
      jpeg: new Uint8Array([0xFF, 0xD8, 1, 2, 0xFF, 0xD9]),
      release,
    })

    await completed
    await vi.waitFor(() => expect(runner.status.uploadActive).toBe(false))
    expect(runner.status.lastErrorCode).toBeUndefined()
    await vi.waitFor(() => expect(runner.status).toMatchObject({ state: 'running', completedWindows: 1 }))
    expect(runner.status.acceptedFactCount).toBe(1)
    expect(projections.at(-1)).toMatchObject({ statements: expect.arrayContaining([expect.stringContaining('code-editor')]) })
    expect(release).toHaveBeenCalledWith('completed')
  })

  it('does not submit a frame without real audio and clears queued audio on echo block', async () => {
    const client = { run: vi.fn() }
    const release = vi.fn()
    const runner = new QwenCloudWindowRunner({ client, isAudioAllowed: () => false })
    runner.start(startInput())
    runner.offerAudio({ sequence: 1, capturedAt: 1_900, monotonicTimestamp: 10, pcm: new Uint8Array([1, 0]) })
    runner.offerFrame({
      frameId: 'frame:1',
      observationId: 'observation:1',
      capturedAt: 1_950,
      monotonicTimestamp: 20,
      width: 1280,
      height: 720,
      jpeg: new Uint8Array([0xFF, 0xD8, 1, 2, 0xFF, 0xD9]),
      release,
    })
    await vi.waitFor(() => expect(release).toHaveBeenCalledWith('invalid'))
    expect(client.run).not.toHaveBeenCalled()
  })

  it('opens one temporary Plus route for low-confidence Flash evidence and then returns to Flash', async () => {
    let call = 0
    const models: string[] = []
    const client = {
      run: vi.fn(async (input: Parameters<import('./qwen-cloud-media-client').QwenCloudMediaClient['run']>[0]) => {
        call += 1
        models.push(input.frameGrant.cloudModelId!)
        for await (const _message of input.messages) { /* consume bounded media */ }
        const confidence = call === 1 ? 0.6 : 0.9
        return {
          responseId: `response:${call}`,
          observationId: 'observation:1',
          sourceKind: 'screen-cloud' as const,
          modelId: input.frameGrant.cloudModelId!,
          completedText: JSON.stringify({ events: [{
            eventType: 'screen.app-class.observed',
            value: { kind: 'enum', value: 'code-editor' },
            confidence,
          }] }),
          usage: { inputTextImageTokens: 10, inputAudioTokens: 10, outputTextTokens: 10, outputAudioTokens: 0 },
          amountMicros: 1,
          priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
        }
      }),
    }
    const runner = new QwenCloudWindowRunner({ client, id: prefix => `${prefix}:${call + 1}` })
    runner.start(startInput())
    runner.offerAudio({ sequence: 1, capturedAt: 1_900, monotonicTimestamp: 10, pcm: new Uint8Array([1, 0]) })
    runner.offerFrame({
      frameId: 'frame:1',
      observationId: 'observation:1',
      capturedAt: 1_950,
      monotonicTimestamp: 20,
      width: 1280,
      height: 720,
      jpeg: new Uint8Array([0xFF, 0xD8, 1, 2, 0xFF, 0xD9]),
      release: vi.fn(),
    })

    await vi.waitFor(() => expect(client.run).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(runner.status.completedWindows).toBe(1))
    expect(models).toEqual([QWEN_FLASH_REALTIME_MODEL_ID, 'qwen3.5-omni-plus-realtime'])
    expect(runner.status.activeModelId).toBe(QWEN_FLASH_REALTIME_MODEL_ID)
    expect(runner.status.routeReason).toBeUndefined()
  })

  it('uses bounded sparse history for an evidence-backed process-analysis route', async () => {
    const imageCounts: number[] = []
    const snapshots: Array<{ acceptedFactIds: string[] }> = []
    let call = 0
    const client = {
      run: vi.fn(async (input: Parameters<import('./qwen-cloud-media-client').QwenCloudMediaClient['run']>[0]) => {
        call += 1
        let imageCount = 0
        for await (const message of input.messages) {
          if (message.type === 'image-frame')
            imageCount += 1
        }
        imageCounts.push(imageCount)
        return {
          responseId: `response:${call}`,
          observationId: `observation:${call}`,
          sourceKind: 'screen-cloud' as const,
          modelId: input.frameGrant.cloudModelId!,
          completedText: JSON.stringify({ events: [{
            eventType: 'screen.app-class.observed',
            value: { kind: 'enum', value: call === 1 ? 'code-editor' : 'document-editor' },
            confidence: 0.9,
          }] }),
          usage: { inputTextImageTokens: 10, inputAudioTokens: 10, outputTextTokens: 10, outputAudioTokens: 0 },
          amountMicros: 1,
          priceProfileId: QWEN_CLOUD_PRICE_PROFILE_ID,
        }
      }),
    }
    const runner = new QwenCloudWindowRunner({
      client,
      now: () => 3_000,
      id: prefix => `${prefix}:${call + 1}`,
      onSnapshot: snapshot => snapshots.push(snapshot),
    })
    runner.start(startInput())
    runner.offerAudio({ sequence: 1, capturedAt: 1_900, monotonicTimestamp: 10, pcm: new Uint8Array([1, 0]) })
    runner.offerFrame(frame('frame:1', 'observation:1', 1_950, 20))
    await vi.waitFor(() => expect(runner.status.completedWindows).toBe(1))

    const evidenceFactId = snapshots.at(-1)!.acceptedFactIds[0]!
    expect(() => runner.requestScreenEscalation('temporal-process-reasoning', ['fact:missing'])).toThrow('cloud-screen-route-evidence-invalid')
    runner.requestScreenEscalation('temporal-process-reasoning', [evidenceFactId])
    runner.offerAudio({ sequence: 2, capturedAt: 2_900, monotonicTimestamp: 30, pcm: new Uint8Array([2, 0]) })
    runner.offerFrame(frame('frame:2', 'observation:2', 2_950, 40))

    await vi.waitFor(() => expect(client.run).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(runner.status.completedWindows).toBe(2))
    expect(imageCounts).toEqual([1, 1, 2])
    await runner.stop()
  })
})

function frame(frameId: string, observationId: string, capturedAt: number, monotonicTimestamp: number) {
  return {
    frameId,
    observationId,
    capturedAt,
    monotonicTimestamp,
    width: 1280,
    height: 720,
    jpeg: new Uint8Array([0xFF, 0xD8, 1, 2, 0xFF, 0xD9]),
    release: vi.fn(),
  }
}

function startInput() {
  return {
    sessionId: 'session:1',
    generation: 1,
    sourceKind: 'screen-cloud' as const,
    sourceId: 'screen:1',
    modelId: QWEN_FLASH_REALTIME_MODEL_ID,
    frameGrant: grant('grant:frame', 'screen-frames'),
    audioGrant: grant('grant:audio', 'microphone-audio'),
  }
}

function grant(grantId: string, modality: 'screen-frames' | 'microphone-audio'): PerceptionConsentGrant {
  return {
    contractVersion: 'perception/v0.3',
    grantId,
    sourceKind: 'screen',
    sourceId: 'screen:1',
    processingMode: 'cloud-approved',
    allowedModalities: [modality],
    allowedFactCategories: ['screen.application'],
    cloudProviderId: QWEN_CLOUD_PROVIDER_ID,
    cloudModelId: QWEN_FLASH_REALTIME_MODEL_ID,
    regionId: QWEN_CLOUD_REGION_ID,
    costBoundaryId: QWEN_CLOUD_COST_BOUNDARY_ID,
    grantedAt: 1_000,
    showPersistentIndicator: true,
  }
}
