import type { ChildProcess } from 'node:child_process'

import type {
  LocalVoiceServiceStartResult,
  LocalVoiceServiceStopResult,
} from '@proj-airi/stage-ui/domains/localVoiceServices'

import process from 'node:process'

import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createLocalVoiceServiceManager, setupLocalVoiceServiceManager } from './index'

function fakeChild(exitCode: number | null = null) {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    exitCode,
    killed: false,
    pid: 42,
    kill: vi.fn(),
  })
  return child
}

function healthResponse(payload: unknown, ok = true) {
  return new Response(JSON.stringify(payload), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('local voice service manager', () => {
  it('reuses an already-ready service without spawning a process', async () => {
    const spawnProcess = vi.fn()
    const manager = createLocalVoiceServiceManager({
      fetchImpl: vi.fn(async () => healthResponse({ local: true, ok: true })) as typeof fetch,
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('gpt-sovits')).resolves.toEqual({
      ok: true,
      serviceId: 'gpt-sovits',
      alreadyRunning: true,
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent starts and waits for the expected health contract', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValue(healthResponse({ ok: true, streaming: true }))
    const manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    const first = manager.start('qwen3-asr')
    const second = manager.start('qwen3-asr')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, serviceId: 'qwen3-asr', alreadyRunning: false },
      { ok: true, serviceId: 'qwen3-asr', alreadyRunning: false },
    ])
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('does not spawn when the allowlisted launcher is missing', async () => {
    const spawnProcess = vi.fn()
    const manager = createLocalVoiceServiceManager({
      fetchImpl: vi.fn(async () => healthResponse({ ok: false }, false)) as typeof fetch,
      fileExists: () => false,
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('gpt-sovits')).resolves.toEqual({
      ok: false,
      serviceId: 'gpt-sovits',
      errorCode: 'launcher_missing',
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('terminates a service that never becomes healthy', async () => {
    const child = fakeChild()
    const terminateProcess = vi.fn(async () => {})
    const manager = createLocalVoiceServiceManager({
      fetchImpl: vi.fn(async () => healthResponse({ ok: false }, false)) as typeof fetch,
      fileExists: () => true,
      projectRoot: 'D:/project',
      spawnProcess: vi.fn(() => child) as unknown as typeof import('node:child_process').spawn,
      startupTimeoutMs: 0,
      terminateProcess,
    })

    await expect(manager.start('gpt-sovits')).resolves.toEqual({
      ok: false,
      serviceId: 'gpt-sovits',
      errorCode: 'startup_timeout',
    })
    expect(terminateProcess).toHaveBeenCalledWith(child)
  })

  it('starts SenseVoice with its declared health contract', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValue(healthResponse({ ok: true, model: 'SenseVoiceSmall' }))
    const manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      alreadyRunning: false,
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  it('starts the managed SenseVoice fallback during desktop setup', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValue(healthResponse({ ok: true, model: 'SenseVoiceSmall' }))
    const manager = setupLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      alreadyRunning: false,
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // candidateProjectRoots added process.cwd() and up to 6 ancestor directories
  // as trusted launcher roots. If the app was launched from an untrusted
  // directory whose ancestor happened to contain a third-party file at the
  // same relative path (services/stt/SenseVoice-Small/start-stt.bat), startup
  // spawned it with user privileges.
  //
  // We fixed this by removing the cwd/ancestor walk entirely: only the
  // explicit projectRoot option, the AIRI_PROJECT_ROOT environment variable,
  // and appPath ancestors carrying the pnpm-workspace.yaml monorepo marker
  // are trusted.
  it('does not execute launchers found under cwd ancestors', async () => {
    const cwdAncestorLauncher = resolve(process.cwd(), '..', 'services/stt/SenseVoice-Small/start-stt.bat')
    const spawnProcess = vi.fn()
    const manager = createLocalVoiceServiceManager({
      fetchImpl: vi.fn(async () => healthResponse({ ok: false }, false)) as typeof fetch,
      fileExists: path => resolve(path) === cwdAncestorLauncher,
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'launcher_missing',
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // Trusted roots previously came from cwd traversal, so a dev checkout only
  // resolved launchers by accident of where the app was launched from. The
  // fix derives dev-checkout roots from the injected Electron appPath: each
  // appPath ancestor (up to 4 levels) is accepted only when it contains the
  // pnpm-workspace.yaml marker identifying the AIRI monorepo root.
  it('resolves launchers from appPath ancestors carrying the workspace marker', async () => {
    const workspaceRoot = resolve('/', 'trusted', 'airi')
    const appPath = resolve(workspaceRoot, 'apps', 'stage-tamagotchi')
    const marker = resolve(workspaceRoot, 'pnpm-workspace.yaml')
    const launcher = resolve(workspaceRoot, 'services/stt/SenseVoice-Small/start-stt.bat')
    const child = fakeChild()
    const spawnProcess = vi.fn((_command: string, _args: readonly string[]) => child)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValue(healthResponse({ ok: true }))
    const manager = createLocalVoiceServiceManager({
      appPath,
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: path => path === marker || path === launcher,
      pollIntervalMs: 0,
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      alreadyRunning: false,
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(spawnProcess.mock.calls[0]?.[1]).toContain(launcher)
  })

  it('skips appPath ancestors without the workspace marker', async () => {
    const workspaceRoot = resolve('/', 'untrusted', 'installDir')
    const appPath = resolve(workspaceRoot, 'apps', 'stage-tamagotchi')
    const launcher = resolve(workspaceRoot, 'services/stt/SenseVoice-Small/start-stt.bat')
    const spawnProcess = vi.fn()
    const manager = createLocalVoiceServiceManager({
      appPath,
      fetchImpl: vi.fn(async () => healthResponse({ ok: false }, false)) as typeof fetch,
      fileExists: path => path === launcher,
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'launcher_missing',
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  // Found by code review 2026-07-26 (M2 voice review)
  // ROOT CAUSE:
  //
  // startOnce only attached child.once('exit'). Node delivers asynchronous
  // spawn failures (e.g. ENOENT) through the 'error' event; emitting 'error'
  // on an EventEmitter with no listener throws an uncaught exception, and the
  // Electron main process has no uncaughtException handler, so the app
  // crashed. Even without the crash, the poll loop would have waited the full
  // startupTimeoutMs (240s) for a child that never started.
  //
  // We fixed this by attaching child.once('error') synchronously after spawn:
  // it records the failure, removes the child from the processes map, and the
  // poll loop returns { ok: false, errorCode: 'launch_failed' } immediately.
  it('fails fast with launch_failed when the spawned child emits an async error', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => child)
    const manager = createLocalVoiceServiceManager({
      fetchImpl: vi.fn(async () => healthResponse({ ok: false }, false)) as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
    })

    const startPromise = manager.start('sensevoice')
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))
    // Node emits spawn failures asynchronously; without an attached 'error'
    // listener this emit would throw right here instead of being handled.
    child.emit('error', new Error('spawn cmd.exe ENOENT'))

    await expect(startPromise).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'launch_failed',
    })
    // The processes map must not retain the dead child.
    await expect(manager.stop('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      stopped: false,
    })
  })

  it('stops only the selected service process managed by AIRI', async () => {
    const qwenChild = fakeChild()
    const senseVoiceChild = fakeChild()
    const terminateProcess = vi.fn(async () => {})
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(qwenChild)
      .mockReturnValueOnce(senseVoiceChild)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValueOnce(healthResponse({ ok: true, streaming: true }))
      .mockResolvedValueOnce(healthResponse({ ok: false }, false))
      .mockResolvedValue(healthResponse({ ok: true, model: 'SenseVoiceSmall' }))
    const manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      terminateProcess,
    })

    await manager.start('qwen3-asr')
    await manager.start('sensevoice')

    await expect(manager.stop('qwen3-asr')).resolves.toEqual({
      ok: true,
      serviceId: 'qwen3-asr',
      stopped: true,
    })
    expect(terminateProcess).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledWith(qwenChild)
    await expect(manager.stop('qwen3-asr')).resolves.toEqual({
      ok: true,
      serviceId: 'qwen3-asr',
      stopped: false,
    })
  })

  // Found by code review 2026-07-26 (M2 voice review)
  //
  // ROOT CAUSE:
  //
  // startOnce() awaits isReady() before spawning. stopAll() sets `stopping`,
  // snapshots `processes`, clears the map and terminates only that snapshot.
  // When the app quits during the readiness probe the snapshot is still empty,
  // so the child spawned moments later was registered into `processes` with no
  // remaining code path that would ever terminate it:
  //
  //   if (await isReady(serviceId)) ...      // <- stopAll() runs here
  //   child = spawnProcess(...)              // <- spawned after the snapshot
  //   processes.set(serviceId, child)        // <- orphan, nobody kills it
  //
  // The launcher kept holding its port, so the next app run saw isReady() ===
  // true and returned `alreadyRunning` with no handle, making stop() answer
  // `stopped: false` forever.
  //
  // We fixed this by re-checking `stopping` right after the child is
  // registered and terminating it there, since stopAll() has already run.
  it('terminates a service spawned after stopAll() snapshotted the process map', async () => {
    const child = fakeChild()
    const terminateProcess = vi.fn(async () => {})
    const spawnProcess = vi.fn(() => child)
    let manager: ReturnType<typeof createLocalVoiceServiceManager>
    // Quitting the app mid-probe is the only way to hit the race: the health
    // check is the await that lets stopAll() interleave before the spawn.
    const fetchImpl = vi.fn(async () => {
      await manager.stopAll()
      return healthResponse({ ok: false }, false)
    })
    manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      terminateProcess,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'app_stopping',
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledWith(child)
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // stop(serviceId) read `processes.get(serviceId)` right away. startOnce()
  // awaits isReady() before it spawns, so a stop issued during that probe found
  // no entry, answered `{ ok: true, stopped: false }` and returned; the child
  // was spawned and registered only afterwards:
  //
  //   if (await isReady(serviceId)) ...   // <- stop() looks at `processes` here
  //   child = spawnProcess(...)           // <- spawned after stop() answered
  //   processes.set(serviceId, child)     // <- the user asked to stop this one
  //
  // Nothing owned that process any more: it kept holding its port
  // (8765/8001/9888), so every later start() saw isReady() === true and
  // returned `alreadyRunning` with no handle, and stop() answered
  // `stopped: false` for the rest of the process lifetime.
  //
  // We fixed this by counting stop() requests per service: a start captures the
  // count before its first await, terminates its own child when the count moved
  // by the time the child is registered and reports `start_cancelled`, while
  // stop() waits for that in-flight attempt before reading `processes`.
  it('terminates a service spawned after stop(serviceId) found no process', async () => {
    const child = fakeChild()
    const terminateProcess = vi.fn(async () => {})
    const spawnProcess = vi.fn(() => child)
    let manager: ReturnType<typeof createLocalVoiceServiceManager>
    let stopPromise: Promise<LocalVoiceServiceStopResult> | undefined
    // Stopping mid-probe is the only way to hit the race: the health check is
    // the await that lets stop() interleave before the spawn.
    const fetchImpl = vi.fn(async () => {
      // NOTICE:
      // The stop has to be issued one microtask later than the probe call.
      // Root cause: `start()` registers its attempt in the dedup map only after
      // `startOnce()` reaches its first await, which is this very fetch, so a
      // stop issued synchronously from here would observe a state no IPC-
      // delivered stop can ever see.
      // Source: `index.ts` `start()` — `starts.set(serviceId, operation)` runs
      // after `startOnce(serviceId)` returns its pending promise.
      // Removal condition: drop when the manager exposes an injectable
      // scheduler that lets a test interleave without touching the event loop.
      await Promise.resolve()
      stopPromise ??= manager.stop('sensevoice')
      return healthResponse({ ok: false }, false)
    })
    manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      terminateProcess,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'start_cancelled',
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledTimes(1)
    expect(terminateProcess).toHaveBeenCalledWith(child)
    expect(await stopPromise).toEqual({ ok: true, serviceId: 'sensevoice', stopped: true })
    // The cancelled attempt must not leave the child behind in `processes`.
    await expect(manager.stop('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      stopped: false,
    })
  })

  // Found by code review 2026-07-26 (M2/M3 follow-up review)
  //
  // ROOT CAUSE:
  //
  // Same defect as above, seen from the dedup cache. `starts` hands every
  // caller the in-flight attempt for that service, and the entry only
  // disappeared in `.finally()`. Because stop() could not cancel that attempt,
  // a stop followed by a restart resolved to the very attempt the user had just
  // asked to stop: one spawn for two opposite intents, and the stop reported
  // `stopped: false`.
  //
  // The cancellation fix alone would only change which stale answer is served
  // (the restart would inherit `start_cancelled` and never launch anything), so
  // stop() drops the attempt it cancels from `starts` right away, and the
  // `.finally()` cleanup got an identity check so the cancelled attempt cannot
  // delete the newer entry that replaced it.
  it('serves a start issued after the stop from a fresh attempt', async () => {
    // Which attempt reaches the spawn first depends on how the two health
    // probes interleave, so the assertions below identify the children by what
    // the manager does with them, never by spawn order.
    const firstSpawnedChild = fakeChild()
    const secondSpawnedChild = fakeChild()
    const terminateProcess = vi.fn(async (_child: ChildProcess) => {})
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(firstSpawnedChild)
      .mockReturnValue(secondSpawnedChild)
    let manager: ReturnType<typeof createLocalVoiceServiceManager>
    let stopPromise: Promise<LocalVoiceServiceStopResult> | undefined
    let restart: Promise<LocalVoiceServiceStartResult> | undefined
    let probes = 0
    const fetchImpl = vi.fn(async () => {
      probes += 1
      if (probes === 1) {
        // NOTICE:
        // The stop has to be issued one microtask later than the probe call.
        // Root cause: `start()` registers its attempt in the dedup map only
        // after `startOnce()` reaches its first await, which is this very
        // fetch, so a stop issued synchronously from here would observe a state
        // no IPC-delivered stop can ever see.
        // Source: `index.ts` `start()` — `starts.set(serviceId, operation)`
        // runs after `startOnce(serviceId)` returns its pending promise.
        // Removal condition: drop when the manager exposes an injectable
        // scheduler that lets a test interleave without touching the event loop.
        await Promise.resolve()
        // Both are issued while the first attempt is still parked in this probe.
        stopPromise = manager.stop('sensevoice')
        restart = manager.start('sensevoice')
      }
      // Probe 1 and 2 are the pre-spawn checks of the two attempts; from probe 3
      // on the restarted service reports itself healthy.
      return probes <= 2
        ? healthResponse({ ok: false }, false)
        : healthResponse({ ok: true, model: 'SenseVoiceSmall' })
    })
    manager = createLocalVoiceServiceManager({
      fetchImpl: fetchImpl as typeof fetch,
      fileExists: () => true,
      pollIntervalMs: 0,
      projectRoot: 'D:/project',
      spawnProcess: spawnProcess as unknown as typeof import('node:child_process').spawn,
      terminateProcess,
    })

    await expect(manager.start('sensevoice')).resolves.toEqual({
      ok: false,
      serviceId: 'sensevoice',
      errorCode: 'start_cancelled',
    })
    expect(await restart).toEqual({ ok: true, serviceId: 'sensevoice', alreadyRunning: false })
    expect(await stopPromise).toEqual({ ok: true, serviceId: 'sensevoice', stopped: true })
    expect(spawnProcess).toHaveBeenCalledTimes(2)
    // Only the cancelled attempt cleaned up after itself so far; the restarted
    // one stays registered and stoppable.
    expect(terminateProcess).toHaveBeenCalledTimes(1)
    await expect(manager.stop('sensevoice')).resolves.toEqual({
      ok: true,
      serviceId: 'sensevoice',
      stopped: true,
    })
    const terminated = terminateProcess.mock.calls.map(([target]) => target)
    expect(terminated).toHaveLength(2)
    // Both spawned processes were terminated exactly once: the cancelled
    // attempt's child by itself, the surviving one by the final stop.
    expect(terminated[0]).not.toBe(terminated[1])
    expect(terminated).toContain(firstSpawnedChild)
    expect(terminated).toContain(secondSpawnedChild)
  })
})
