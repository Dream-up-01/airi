import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type { LocalTransformersScreenValidationResult } from '@proj-airi/stage-ui/services/perception'

import process from 'node:process'

import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'

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

  // Found by code review 2026-07-26 (M2 voice review, sibling-module sweep)
  //
  // ROOT CAUSE:
  //
  // candidateProjectRoots() walked process.cwd() plus six ancestor
  // directories and resolveServicePath() handed the first matching
  // `services/perception-qwen3-vl-transformers/server.py` straight to the WSL
  // python interpreter:
  //
  //   let current = resolve(process.cwd())
  //   for (let depth = 0; depth < 6; depth += 1) { roots.add(current) ... }
  //
  // Launching AIRI from an untrusted directory (e.g. a portable build under
  // Downloads) whose ancestor happened to carry that relative path therefore
  // executed a third-party script with the user's privileges.
  //
  // We fixed this by never trusting cwd: only options.projectRoot, the
  // AIRI_PROJECT_ROOT env var, and appPath ancestors that carry the
  // pnpm-workspace.yaml monorepo marker are candidate roots.
  it('does not resolve the service script from cwd ancestors', async () => {
    const spawnProcess = vi.fn(() => fakeChild())
    const cwdAncestorScript = resolve(process.cwd(), '..', 'services/perception-qwen3-vl-transformers/server.py')
    const manager = createLocalTransformersScreenManager({
      fetchImpl: vi.fn(async () => healthResponse()) as typeof fetch,
      // Only the untrusted cwd-ancestor script exists; no trusted root does.
      fileExists: (path: string) => path === cwdAncestorScript,
      gracefulStopTimeoutMs: 0,
      randomToken: () => 'd'.repeat(43),
      runtimeFactory: () => fakeRuntime(),
      spawnProcess,
    })

    await expect(manager.validate(request())).rejects.toEqual(new LocalScreenGatewayError('runtime-unavailable'))
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('resolves the service script from appPath ancestors carrying the workspace marker', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const workspaceRoot = resolve('D:/Projects/airi')
    const appPath = resolve(workspaceRoot, 'apps/stage-tamagotchi')
    const manager = createLocalTransformersScreenManager({
      appPath,
      fetchImpl: vi.fn(async () => healthResponse()) as typeof fetch,
      fileExists: (path: string) => path === resolve(workspaceRoot, 'pnpm-workspace.yaml')
        || path === resolve(workspaceRoot, 'services/perception-qwen3-vl-transformers/server.py'),
      gracefulStopTimeoutMs: 0,
      randomToken: () => 'e'.repeat(43),
      runtimeFactory: () => fakeRuntime(),
      spawnProcess,
    })

    await expect(manager.validate(request())).resolves.toMatchObject({ state: 'ready' })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  // Found by code review 2026-07-26 (M2 voice review, sibling-module sweep)
  //
  // ROOT CAUSE:
  //
  // The spawned `wsl.exe` child only had an 'exit' listener:
  //
  //   child.once('exit', () => { ... })
  //
  // Node delivers asynchronous spawn failures via 'error', and an
  // EventEmitter 'error' with no listener throws an uncaught exception. Since
  // `wsl.exe` is absent on every machine without WSL installed, validating the
  // local screen runtime there crashed the Electron main process instead of
  // reporting a runtime error.
  //
  // We fixed this by attaching an 'error' listener synchronously alongside the
  // 'exit' listener, marking the runtime unavailable.
  it('reports runtime-unavailable instead of crashing when the spawned process emits an async error', async () => {
    const child = fakeChild()
    const manager = createLocalTransformersScreenManager({
      // Never becomes healthy: the spawn failure is the only outcome.
      fetchImpl: vi.fn(async () => {
        throw new Error('connection refused')
      }) as unknown as typeof fetch,
      fileExists: () => true,
      gracefulStopTimeoutMs: 0,
      pollIntervalMs: 0,
      projectRoot: 'D:/Projects/airi',
      randomToken: () => 'f'.repeat(43),
      runtimeFactory: () => fakeRuntime(),
      spawnProcess: vi.fn(() => {
        // Mirrors Node's asynchronous ENOENT delivery for a missing wsl.exe.
        queueMicrotask(() => child.emit('error', new Error('spawn wsl.exe ENOENT')))
        return child
      }),
      startupTimeoutMs: 0,
      terminateProcess: vi.fn(async () => undefined),
    })

    await expect(manager.validate(request())).rejects.toBeInstanceOf(LocalScreenGatewayError)
    expect(manager.status({
      contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
      sessionId: 'session:local-screen',
      generation: 1,
    })).toMatchObject({ state: 'failed' })
  })
})
