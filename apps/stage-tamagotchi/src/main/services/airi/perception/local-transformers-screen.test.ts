import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type { LocalTransformersScreenValidationResult } from '@proj-airi/stage-ui/services/perception'

import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  LOCAL_SCREEN_MODEL_REVISION,
  LOCAL_SCREEN_PROFILE_ID,
  LOCAL_SCREEN_QUANTIZATION_ID,
} from '../../../../shared/eventa/perception-local-screen'
import { createLocalTransformersScreenManager, LocalScreenGatewayError } from './local-transformers-screen'

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    exitCode: null,
    killed: false,
    pid: 42,
    kill: vi.fn(),
  })
  return child
}

function healthResponse() {
  return new Response(JSON.stringify({
    serviceVersion: 'airi-local-screen-transformers/v0.1',
    state: 'stopped',
    modelId: LOCAL_SCREEN_MODEL_ID,
    revision: LOCAL_SCREEN_MODEL_REVISION,
    quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function request(generation = 1) {
  return {
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId: 'session:local-screen',
    generation,
    consentGrantId: 'grant:screen-local',
    profileId: LOCAL_SCREEN_PROFILE_ID,
  } as const
}

function fakeRuntime() {
  const validation: LocalTransformersScreenValidationResult = {
    runtimeVersion: 'airi-local-screen-transformers/v0.1',
    revision: LOCAL_SCREEN_MODEL_REVISION,
    quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
    loadDurationMs: 12_000,
    profile: {
      contractVersion: 'perception/v0.3',
      profileId: LOCAL_SCREEN_PROFILE_ID,
      adapterId: 'screen:transformers-local',
      generation: 1,
      modelId: LOCAL_SCREEN_MODEL_ID,
      runtimeKind: 'transformers-service',
      revision: LOCAL_SCREEN_MODEL_REVISION,
      quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
      targetResolution: '1280x720',
      normalFpsMax: 0.2,
      activeFpsMax: 1,
      state: 'ready',
      capabilities: ['single-image', 'multi-image', 'strict-json-schema', 'abort', 'process-exit-unload'],
    },
  }
  return {
    validate: vi.fn(async () => validation),
    analyze: vi.fn(),
    stop: vi.fn(async () => undefined),
  }
}

describe('local Transformers screen manager', () => {
  it('stays cold until validation and keeps the memory token out of command arguments and status', async () => {
    const child = fakeChild()
    const runtime = fakeRuntime()
    const spawnProcess = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => child)
    const terminateProcess = vi.fn(async () => undefined)
    const manager = createLocalTransformersScreenManager({
      fetchImpl: vi.fn(async () => healthResponse()) as typeof fetch,
      fileExists: () => true,
      gracefulStopTimeoutMs: 0,
      projectRoot: 'D:/Projects/airi',
      randomToken: () => 'a'.repeat(43),
      runtimeFactory: () => runtime,
      spawnProcess,
      terminateProcess,
    })

    expect(spawnProcess).not.toHaveBeenCalled()
    const result = await manager.validate(request())
    expect(result).toMatchObject({ state: 'ready', loadDurationMs: 12_000 })
    expect(JSON.stringify(result)).not.toContain('a'.repeat(43))

    const [command, args, options] = spawnProcess.mock.calls[0]!
    expect(command).toBe('wsl.exe')
    expect(JSON.stringify(args)).not.toContain('a'.repeat(43))
    expect(options.env?.AIRI_PERCEPTION_TOKEN).toBe('a'.repeat(43))
    expect(options.env?.WSLENV).toContain('AIRI_PERCEPTION_TOKEN/u')
    expect(options.windowsHide).toBe(true)

    await manager.stop({
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: 'session:local-screen',
      generation: 1,
      reason: 'user-stop',
    })
    expect(runtime.stop).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledWith(child)
  })

  it('stops the old generation before validating a replacement', async () => {
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const firstRuntime = fakeRuntime()
    const secondRuntime = fakeRuntime()
    const terminateProcess = vi.fn(async () => undefined)
    const manager = createLocalTransformersScreenManager({
      fetchImpl: vi.fn(async () => healthResponse()) as typeof fetch,
      fileExists: () => true,
      gracefulStopTimeoutMs: 0,
      projectRoot: 'D:/Projects/airi',
      randomToken: () => 'b'.repeat(43),
      runtimeFactory: vi.fn()
        .mockReturnValueOnce(firstRuntime)
        .mockReturnValueOnce(secondRuntime),
      spawnProcess: vi.fn()
        .mockReturnValueOnce(firstChild)
        .mockReturnValueOnce(secondChild),
      terminateProcess,
    })

    await manager.validate(request(1))
    await manager.validate(request(2))
    expect(firstRuntime.stop).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledWith(firstChild)
    expect(manager.status({
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: 'session:local-screen',
      generation: 2,
    }).state).toBe('ready')
  })

  it('cancels startup and terminates the owned process when the caller aborts', async () => {
    const child = fakeChild()
    const terminateProcess = vi.fn(async () => undefined)
    const controller = new AbortController()
    controller.abort()
    const manager = createLocalTransformersScreenManager({
      fetchImpl: vi.fn(async () => healthResponse()) as typeof fetch,
      fileExists: () => true,
      gracefulStopTimeoutMs: 0,
      projectRoot: 'D:/Projects/airi',
      randomToken: () => 'c'.repeat(43),
      runtimeFactory: () => fakeRuntime(),
      spawnProcess: vi.fn(() => child),
      terminateProcess,
    })

    await expect(manager.validate(request(), controller.signal)).rejects.toEqual(new LocalScreenGatewayError('runtime-cancelled'))
    expect(terminateProcess).toHaveBeenCalledWith(child)
    expect(manager.status({
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: 'session:local-screen',
      generation: 1,
    })).toMatchObject({ state: 'failed', errorCode: 'runtime-cancelled' })
  })
})
