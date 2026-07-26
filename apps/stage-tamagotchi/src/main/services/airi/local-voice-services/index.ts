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
  stop: (serviceId: LocalVoiceServiceId) => Promise<LocalVoiceServiceStopResult>
  stopAll: () => Promise<void>
}

interface LocalVoiceServiceManagerOptions {
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

function candidateProjectRoots(explicitRoot?: string) {
  const roots = new Set<string>()
  if (explicitRoot?.trim())
    roots.add(resolve(explicitRoot))
  if (process.env.AIRI_PROJECT_ROOT?.trim())
    roots.add(resolve(process.env.AIRI_PROJECT_ROOT))

  let current = resolve(process.cwd())
  for (let depth = 0; depth < 6; depth += 1) {
    roots.add(current)
    const parent = dirname(current)
    if (parent === current)
      break
    current = parent
  }
  return [...roots]
}

function resolveLauncher(
  serviceId: LocalVoiceServiceId,
  fileExists: (path: string) => boolean,
  explicitRoot?: string,
) {
  const relativePath = serviceSpecs[serviceId].launcherPath
  for (const root of candidateProjectRoots(explicitRoot)) {
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

    if (await isReady(serviceId))
      return { ok: true, serviceId, alreadyRunning: true }

    const launcher = resolveLauncher(serviceId, fileExists, options.projectRoot)
    if (!launcher)
      return { ok: false, serviceId, errorCode: 'launcher_missing' }

    let child: ChildProcess
    try {
      child = spawnProcess(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', launcher], {
        cwd: dirname(launcher),
        stdio: 'ignore',
        windowsHide: true,
      })
      processes.set(serviceId, child)
      child.once('exit', () => {
        if (processes.get(serviceId) === child)
          processes.delete(serviceId)
      })
    }
    catch {
      return { ok: false, serviceId, errorCode: 'launch_failed' }
    }

    const deadline = now() + startupTimeoutMs
    while (now() < deadline) {
      if (stopping)
        return { ok: false, serviceId, errorCode: 'app_stopping' }
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

    const operation = startOnce(serviceId).finally(() => starts.delete(serviceId))
    starts.set(serviceId, operation)
    return await operation
  }

  async function stop(serviceId: LocalVoiceServiceId): Promise<LocalVoiceServiceStopResult> {
    const child = processes.get(serviceId)
    if (!child)
      return { ok: true, serviceId, stopped: false }

    processes.delete(serviceId)
    try {
      await terminateProcess(child)
      return { ok: true, serviceId, stopped: true }
    }
    catch {
      return { ok: false, serviceId, errorCode: 'stop_failed' }
    }
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
