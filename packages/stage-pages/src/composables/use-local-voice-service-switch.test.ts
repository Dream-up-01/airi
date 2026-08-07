import type { LocalVoiceServiceStopResult } from '@proj-airi/stage-ui/domains/localVoiceServices'

import { describe, expect, it, vi } from 'vitest'

import {
  isManagedLocalVoiceServiceEndpoint,
  quiesceVoiceRuntimeForSwitch,
  stopAndDisposePreviousVoiceService,
} from './use-local-voice-service-switch'

describe('isManagedLocalVoiceServiceEndpoint', () => {
  it('recognizes AIRI-owned default loopback endpoints', () => {
    expect(isManagedLocalVoiceServiceEndpoint('qwen3-asr', 'http://127.0.0.1:8001')).toBe(true)
    expect(isManagedLocalVoiceServiceEndpoint('sensevoice', 'http://127.0.0.1:8765/v1/')).toBe(true)
    expect(isManagedLocalVoiceServiceEndpoint('gpt-sovits', 'http://localhost:9888/v1')).toBe(true)
  })

  it('does not claim custom loopback endpoints', () => {
    expect(isManagedLocalVoiceServiceEndpoint('qwen3-asr', 'http://127.0.0.1:8002')).toBe(false)
    expect(isManagedLocalVoiceServiceEndpoint('sensevoice', 'http://127.0.0.1:8766/v1/')).toBe(false)
    expect(isManagedLocalVoiceServiceEndpoint('gpt-sovits', 'http://127.0.0.1:9889/v1/')).toBe(false)
  })
})

describe('stopAndDisposePreviousVoiceService', () => {
  it('stops and disposes the old provider before the caller starts the new one', async () => {
    const calls: string[] = []
    const stopService = vi.fn(async () => {
      calls.push('stop')
      return { ok: true, serviceId: 'sensevoice', stopped: true } satisfies LocalVoiceServiceStopResult
    })
    const disposeProvider = vi.fn(async () => {
      calls.push('dispose')
    })

    const result = await stopAndDisposePreviousVoiceService({
      previousProviderId: 'sensevoice-local',
      nextProviderId: 'qwen3-asr-local',
      serviceIdForProvider: providerId => providerId === 'sensevoice-local' ? 'sensevoice' : undefined,
      stopService,
      disposeProvider,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(['stop', 'dispose'])
    expect(stopService).toHaveBeenCalledWith('sensevoice')
    expect(disposeProvider).toHaveBeenCalledWith('sensevoice-local')
  })

  it('blocks promotion when a managed service cannot be stopped', async () => {
    const disposeProvider = vi.fn(async () => {})
    const result = await stopAndDisposePreviousVoiceService({
      previousProviderId: 'gpt-sovits-local',
      nextProviderId: 'minimax-speech',
      serviceIdForProvider: providerId => providerId === 'gpt-sovits-local' ? 'gpt-sovits' : undefined,
      stopService: vi.fn(async () => ({
        ok: false,
        serviceId: 'gpt-sovits',
        errorCode: 'stop_failed',
      } satisfies LocalVoiceServiceStopResult)),
      disposeProvider,
    })

    expect(result).toEqual({ ok: false, noticeCode: 'previous-service-stop-failed' })
    expect(disposeProvider).not.toHaveBeenCalled()
  })

  it('disposes a previous cloud provider without trying to stop a local service', async () => {
    const stopService = vi.fn()
    const disposeProvider = vi.fn(async () => {})
    const result = await stopAndDisposePreviousVoiceService({
      previousProviderId: 'openai-audio-speech',
      nextProviderId: 'minimax-speech',
      serviceIdForProvider: () => undefined,
      stopService,
      disposeProvider,
    })

    expect(result).toEqual({ ok: true })
    expect(stopService).not.toHaveBeenCalled()
    expect(disposeProvider).toHaveBeenCalledWith('openai-audio-speech')
  })
})

describe('quiesceVoiceRuntimeForSwitch', () => {
  it('accepts a completed Stage acknowledgement', async () => {
    const requestQuiesce = vi.fn(async () => ({
      correlationId: 'voice-quiesce:test',
      status: 'quiesced' as const,
    }))

    await expect(quiesceVoiceRuntimeForSwitch({
      reason: 'model-switch',
      requestQuiesce,
    })).resolves.toEqual({ ok: true, timedOut: false })
    expect(requestQuiesce).toHaveBeenCalledWith('model-switch')
  })

  it('blocks publication when no Stage owner responds', async () => {
    const requestQuiesce = vi.fn(async () => ({
      correlationId: 'voice-quiesce:test',
      status: 'timed-out' as const,
    }))

    await expect(quiesceVoiceRuntimeForSwitch({
      reason: 'provider-switch',
      requestQuiesce,
    })).resolves.toEqual({ ok: false, timedOut: true })
  })

  it('blocks publication after an explicit Stage failure', async () => {
    const requestQuiesce = vi.fn(async () => ({
      correlationId: 'voice-quiesce:test',
      status: 'failed' as const,
    }))

    await expect(quiesceVoiceRuntimeForSwitch({
      reason: 'voice-switch',
      requestQuiesce,
    })).resolves.toEqual({ ok: false, timedOut: false })
  })
})
