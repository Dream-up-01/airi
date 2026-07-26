import type { ChildProcess } from 'node:child_process'

import type {
  LocalVoiceServiceId,
  LocalVoiceServiceStartResult,
  LocalVoiceServiceStopResult,
} from '@proj-airi/stage-ui/domains/localVoiceServices'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

interface LocalVoiceServiceSpec {
  healthUrl: string
  launcherPath: string
  isReady: (payload: unknown) => boolean
}

export interface LocalVoiceServiceManager {
  start: (serviceId: LocalVoiceServiceId) => Promise<LocalVoiceServiceStartResult>
  /**
   * Stops the service, waiting for an in-flight start of the same service to
   * settle first: that start may not have spawned its process yet, and only it
   * can terminate what it spawns. Resolves `stopped: true` when a process was
   * terminated (by this call or by the start it cancelled).
   */
  stop: (serviceId: LocalVoiceServiceId) => Promise<LocalVoiceServiceStopResult>
  stopAll: () => Promise<void>
}

interface LocalVoiceServiceManagerOptions {
  /**
   * Electron `app.getAppPath()`. Ancestors of this directory (up to 4 levels)
   * become trusted launcher roots only when they contain the
   * `pnpm-workspace.yaml` monorepo marker, so packaged installs (whose
   * ancestors are arbitrary directories) resolve nothing and degrade to
   * `launcher_missing`.
   */
  appPath?: string
  fetchImpl?: typeof fetch
  fileExists?: (path: string) => boolean
  now?: () => number
  pollIntervalMs?: number
  projectRoot?: string
  spawnProcess?: typeof spawn
  startupTimeoutMs?: number
  terminateProcess?: (child: ChildProcess) => Promise<void>
}

const serviceSpecs: Record<LocalVoiceServiceId, LocalVoiceServiceSpec> = {
  'gpt-sovits': {
    healthUrl: 'http://127.0.0.1:9888/health',
    launcherPath: 'services/tts/start-gpt-sovits-airi.bat',
    isReady: payload => isRecord(payload) && payload.ok === true && payload.local === true,
  },
  'qwen3-asr': {
    healthUrl: 'http://127.0.0.1:8001/health',
    launcherPath: 'services/stt/Qwen3-asr/start-qwen3-asr.cmd',
    isReady: payload => isRecord(payload) && payload.ok === true && payload.streaming === true,
  },
  'sensevoice': {
    healthUrl: 'http://127.0.0.1:8765/health',
    launcherPath: 'services/stt/SenseVoice-Small/start-stt.bat',
    isReady: payload => isRecord(payload) && payload.ok === true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Marker file identifying the AIRI monorepo root. appPath-derived candidate
 * roots are trusted only when this marker is present, so packaged installs
 * (whose ancestors are arbitrary directories) never resolve a launcher there.
 */
const workspaceRootMarker = 'pnpm-workspace.yaml'

// NOTICE:
// In dev the Electron appPath sits 2 levels below the monorepo root
// (apps/stage-tamagotchi); 4 levels leaves headroom for build output
// directories without scanning far up the filesystem.
// Removal condition: appPath-relative launcher resolution is replaced by an
// explicit configured root.
const appPathAncestorLevels = 4

/**
 * Collects directories trusted to contain local voice service launchers.
 *
 * Trust model:
 * - `explicitRoot` (options.projectRoot) and the `AIRI_PROJECT_ROOT`
 *   environment variable are deliberate user configuration, trusted as-is.
 * - `appPath` and up to {@link appPathAncestorLevels} ancestors are trusted
 *   only when they carry {@link workspaceRootMarker} (a dev checkout).
 * - `process.cwd()` is never trusted: walking cwd ancestors would execute a
 *   third-party `.bat` at the same relative path whenever the app is launched
 *   from an untrusted directory.
 */
function candidateProjectRoots(
  fileExists: (path: string) => boolean,
  explicitRoot?: string,
  appPath?: string,
) {
  const roots = new Set<string>()
  if (explicitRoot?.trim())
    roots.add(resolve(explicitRoot))
  if (process.env.AIRI_PROJECT_ROOT?.trim())
    roots.add(resolve(process.env.AIRI_PROJECT_ROOT))

  if (appPath?.trim()) {
    let current = resolve(appPath)
    for (let depth = 0; depth <= appPathAncestorLevels; depth += 1) {
      if (fileExists(resolve(current, workspaceRootMarker)))
        roots.add(current)
      const parent = dirname(current)
      if (parent === current)
        break
      current = parent
    }
  }
  return [...roots]
}

function resolveLauncher(
  serviceId: LocalVoiceServiceId,
  fileExists: (path: string) => boolean,
  explicitRoot?: string,
  appPath?: string,
) {
  const relativePath = serviceSpecs[serviceId].launcherPath
  for (const root of candidateProjectRoots(fileExists, explicitRoot, appPath)) {
    const launcher = resolve(root, relativePath)
    if (fileExists(launcher))
      return launcher
  }
}

async function defaultTerminateProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.killed)
    return

  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolveTaskkill) => {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolveTaskkill())
    })
    return
  }

  child.kill('SIGTERM')
}

export function createLocalVoiceServiceManager(
  options: LocalVoiceServiceManagerOptions = {},
): LocalVoiceServiceManager {
  const fetchImpl = options.fetchImpl ?? fetch
  const fileExists = options.fileExists ?? existsSync
  const now = options.now ?? Date.now
  const pollIntervalMs = options.pollIntervalMs ?? 500
  const spawnProcess = options.spawnProcess ?? spawn
  const startupTimeoutMs = options.startupTimeoutMs ?? 240_000
  const terminateProcess = options.terminateProcess ?? defaultTerminateProcess
  const processes = new Map<LocalVoiceServiceId, ChildProcess>()
  const starts = new Map<LocalVoiceServiceId, Promise<LocalVoiceServiceStartResult>>()
  // Counts stop() requests per service. A start captures the count before its
  // first await, so it can tell that its own attempt was cancelled. A counter
  // rather than a boolean flag: a flag would have to be reset by whoever
  // consumed it, and a start issued after the stop would race on that reset.
  const stopRequestCounts = new Map<LocalVoiceServiceId, number>()
  let stopping = false

  async function isReady(serviceId: LocalVoiceServiceId) {
    const spec = serviceSpecs[serviceId]
    try {
      const response = await fetchImpl(spec.healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok)
        return false
      return spec.isReady(await response.json().catch(() => undefined))
    }
    catch {
      return false
    }
  }

  async function delay() {
    await new Promise(resolveDelay => setTimeout(resolveDelay, pollIntervalMs))
  }

  async function startOnce(serviceId: LocalVoiceServiceId): Promise<LocalVoiceServiceStartResult> {
    if (stopping)
      return { ok: false, serviceId, errorCode: 'app_stopping' }

    const stopRequestsAtStart = stopRequestCounts.get(serviceId) ?? 0
    const stopRequested = () => (stopRequestCounts.get(serviceId) ?? 0) !== stopRequestsAtStart

    if (await isReady(serviceId))
      return { ok: true, serviceId, alreadyRunning: true }

    const launcher = resolveLauncher(serviceId, fileExists, options.projectRoot, options.appPath)
    if (!launcher)
      return { ok: false, serviceId, errorCode: 'launcher_missing' }

    let child: ChildProcess
    let launchFailed = false
    try {
      child = spawnProcess(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', launcher], {
        cwd: dirname(launcher),
        stdio: 'ignore',
        windowsHide: true,
      })
      // Node delivers asynchronous spawn failures (e.g. ENOENT) via 'error';
      // an EventEmitter 'error' without a listener throws an uncaught
      // exception and would crash the main process. Attach synchronously so
      // no delivery timing can leave the event unhandled.
      child.once('error', () => {
        launchFailed = true
        if (processes.get(serviceId) === child)
          processes.delete(serviceId)
      })
      child.once('exit', () => {
        if (processes.get(serviceId) === child)
          processes.delete(serviceId)
      })
    }
    catch {
      return { ok: false, serviceId, errorCode: 'launch_failed' }
    }

    // stopAll() or stop(serviceId) may have completed while the readiness probe
    // above was awaited. stopAll() snapshots `processes` and stop() reads it,
    // both before this child could exist there, so no other code path would
    // ever terminate this process — the launcher would keep holding its port
    // and the next run would resolve to `alreadyRunning` with no handle to
    // stop. Deciding this before registering also keeps a start that stop()
    // handed over to from having its `processes` entry clobbered by the
    // attempt being cancelled here.
    if (stopping || stopRequested()) {
      await terminateProcess(child)
      return { ok: false, serviceId, errorCode: stopping ? 'app_stopping' : 'start_cancelled' }
    }
    processes.set(serviceId, child)

    const deadline = now() + startupTimeoutMs
    while (now() < deadline) {
      if (stopping)
        return { ok: false, serviceId, errorCode: 'app_stopping' }
      if (stopRequested()) {
        // Whoever removed this child from `processes` owns its termination:
        // stop() takes the entry synchronously before it awaits this attempt,
        // so a child still registered here has no other owner.
        if (processes.get(serviceId) === child) {
          processes.delete(serviceId)
          await terminateProcess(child)
        }
        return { ok: false, serviceId, errorCode: 'start_cancelled' }
      }
      if (launchFailed)
        return { ok: false, serviceId, errorCode: 'launch_failed' }
      if (await isReady(serviceId))
        return { ok: true, serviceId, alreadyRunning: false }
      if (child.exitCode !== null)
        return { ok: false, serviceId, errorCode: 'launch_failed' }
      await delay()
    }

    if (stopping)
      return { ok: false, serviceId, errorCode: 'app_stopping' }

    await terminateProcess(child)
    if (processes.get(serviceId) === child)
      processes.delete(serviceId)
    return { ok: false, serviceId, errorCode: 'startup_timeout' }
  }

  async function start(serviceId: LocalVoiceServiceId) {
    const activeStart = starts.get(serviceId)
    if (activeStart)
      return await activeStart

    const operation = startOnce(serviceId).finally(() => {
      // stop() detaches a cancelled attempt from this map eagerly, so by the
      // time this settles the map may already hold a newer attempt that must
      // not be dropped.
      if (starts.get(serviceId) === operation)
        starts.delete(serviceId)
    })
    starts.set(serviceId, operation)
    return await operation
  }

  async function stop(serviceId: LocalVoiceServiceId): Promise<LocalVoiceServiceStopResult> {
    stopRequestCounts.set(serviceId, (stopRequestCounts.get(serviceId) ?? 0) + 1)

    // Take ownership of the registered process synchronously: only what is
    // running now, plus what the in-flight start is about to spawn, are in
    // scope for this stop. A start issued while this call awaits below belongs
    // to the user's next intent and must survive.
    const child = processes.get(serviceId)
    if (child)
      processes.delete(serviceId)

    // Terminate before awaiting the in-flight start below. Removing the child
    // from `processes` already hid it from `stopAll()`, which snapshots that
    // map; app quit awaits `stopAll()` via `emitAppBeforeQuit`, so a quit
    // landing inside that await would leave the launcher alive holding its
    // port — the orphan this class of fix exists to prevent. Terminating first
    // is safe: a registered child is never the one the awaited attempt will
    // spawn, because that attempt only spawns when nothing was registered.
    let terminateFailed = false
    if (child) {
      try {
        await terminateProcess(child)
      }
      catch {
        terminateFailed = true
      }
    }

    // A start may still be parked in its readiness probe, i.e. before it has
    // anything registered in `processes`, and only that start can terminate
    // what it spawns. Detach it from the dedup map first — a start() issued
    // after this stop must open a fresh attempt instead of inheriting the
    // cancelled one's failure — then wait for it to settle.
    const activeStart = starts.get(serviceId)
    let startCancelled = false
    if (activeStart) {
      starts.delete(serviceId)
      // A start rejects when terminating its own cancelled child throws; that
      // is this stop's outcome to report, not an error to propagate.
      const startResult = await activeStart.catch(() => undefined)
      startCancelled = startResult?.ok === false && startResult.errorCode === 'start_cancelled'
    }

    if (terminateFailed)
      return { ok: false, serviceId, errorCode: 'stop_failed' }

    return { ok: true, serviceId, stopped: child ? true : startCancelled }
  }

  async function stopAll() {
    if (stopping)
      return
    stopping = true
    const activeProcesses = [...processes.values()]
    processes.clear()
    await Promise.allSettled(activeProcesses.map(child => terminateProcess(child)))
  }

  return { start, stop, stopAll }
}

export function setupLocalVoiceServiceManager(options: LocalVoiceServiceManagerOptions = {}) {
  const manager = createLocalVoiceServiceManager(options)
  onAppBeforeQuit(() => manager.stopAll())
  // SenseVoice is the conservative cold-start fallback selected by the main
  // renderer. Starting it here keeps ownership in the Electron manager so a
  // later same-class ASR switch can close it without killing arbitrary
  // loopback processes. start() is deduplicated if settings opens meanwhile.
  void manager.start('sensevoice')
  return manager
}
