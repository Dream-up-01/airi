import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type {
  LocalTransformersScreenAnalysisRequest,
  LocalTransformersScreenAnalysisResult,
  LocalTransformersScreenRuntimeOptions,
  LocalTransformersScreenValidationResult,
} from '@proj-airi/stage-ui/services/perception'

import type {
  LocalScreenAnalyzeResponse,
  LocalScreenGatewayStatus,
  LocalScreenGatewayStatusRequest,
  LocalScreenGatewayStopRequest,
  LocalScreenGatewayValidateRequest,
} from '../../../../shared/eventa/perception-local-screen'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  LOCAL_TRANSFORMERS_SERVICE_VERSION,
  LocalTransformersScreenError,
  LocalTransformersScreenRuntime,
} from '@proj-airi/stage-ui/services/perception'

import {
  LOCAL_SCREEN_GATEWAY_VERSION,
  LOCAL_SCREEN_MODEL_ID,
  LOCAL_SCREEN_MODEL_REVISION,
  LOCAL_SCREEN_PROFILE_ID,
  LOCAL_SCREEN_QUANTIZATION_ID,
} from '../../../../shared/eventa/perception-local-screen'
import { onAppBeforeQuit } from '../../../libs/bootkit/lifecycle'

export class LocalScreenGatewayError extends Error {
  readonly code

  constructor(code: import('../../../../shared/eventa/perception-local-screen').LocalScreenGatewayErrorCode) {
    super(code)
    this.name = 'LocalScreenGatewayError'
    this.code = code
  }
}

interface LocalScreenRuntimePort {
  validate: (signal?: AbortSignal) => Promise<LocalTransformersScreenValidationResult>
  analyze: (request: LocalTransformersScreenAnalysisRequest) => Promise<LocalTransformersScreenAnalysisResult>
  stop: () => Promise<void>
}

interface ActiveRuntime {
  sessionId: string
  generation: number
  child: ChildProcess
  runtime?: LocalScreenRuntimePort
  token: string
}

export interface LocalTransformersScreenManager {
  validate: (request: LocalScreenGatewayValidateRequest, signal?: AbortSignal) => Promise<LocalScreenGatewayStatus>
  analyze: (request: LocalTransformersScreenAnalysisRequest) => Promise<LocalScreenAnalyzeResponse>
  stop: (request: LocalScreenGatewayStopRequest) => Promise<LocalScreenGatewayStatus>
  status: (request: LocalScreenGatewayStatusRequest) => LocalScreenGatewayStatus
  stopAll: () => Promise<void>
}

interface LocalTransformersScreenManagerOptions {
  /**
   * Electron `app.getAppPath()`. Ancestors of this directory (up to
   * {@link appPathAncestorLevels}) become trusted service roots only when they
   * contain the `pnpm-workspace.yaml` monorepo marker, so packaged installs
   * (whose ancestors are arbitrary directories) resolve nothing and degrade to
   * `runtime-unavailable`.
   */
  appPath?: string
  fetchImpl?: typeof fetch
  fileExists?: (path: string) => boolean
  gracefulStopTimeoutMs?: number
  now?: () => number
  pollIntervalMs?: number
  projectRoot?: string
  randomToken?: () => string
  runtimeFactory?: (options: LocalTransformersScreenRuntimeOptions) => LocalScreenRuntimePort
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  startupTimeoutMs?: number
  terminateProcess?: (child: ChildProcess) => Promise<void>
  wait?: (durationMs: number) => Promise<void>
  wslDistribution?: string
}

const SERVICE_RELATIVE_PATH = 'services/perception-qwen3-vl-transformers/server.py'
const SERVICE_PORT = 39273
const EMPTY_CAPABILITIES: string[] = []

export function createLocalTransformersScreenManager(
  options: LocalTransformersScreenManagerOptions = {},
): LocalTransformersScreenManager {
  const fetchImpl = options.fetchImpl ?? fetch
  const fileExists = options.fileExists ?? existsSync
  const gracefulStopTimeoutMs = options.gracefulStopTimeoutMs ?? 3_000
  const now = options.now ?? Date.now
  const pollIntervalMs = options.pollIntervalMs ?? 250
  const randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
  const runtimeFactory = options.runtimeFactory ?? (runtimeOptions => new LocalTransformersScreenRuntime(runtimeOptions))
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions))
  const startupTimeoutMs = options.startupTimeoutMs ?? 30_000
  const terminateProcess = options.terminateProcess ?? defaultTerminateProcess
  const wait = options.wait ?? (durationMs => new Promise(resolveWait => setTimeout(resolveWait, durationMs)))
  const wslDistribution = options.wslDistribution ?? 'Ubuntu'

  let active: ActiveRuntime | undefined
  let lastStatus = stoppedStatus('idle', 1)
  let validateOperation: { sessionId: string, generation: number, promise: Promise<LocalScreenGatewayStatus> } | undefined
  let stopping = false

  async function validate(request: LocalScreenGatewayValidateRequest, signal?: AbortSignal): Promise<LocalScreenGatewayStatus> {
    if (stopping)
      throw new LocalScreenGatewayError('runtime-stopped')
    if (validateOperation) {
      if (validateOperation.sessionId === request.sessionId && validateOperation.generation === request.generation)
        return await validateOperation.promise
      await validateOperation.promise.catch(() => undefined)
      return await validate(request, signal)
    }

    const promise = validateOnce(request, signal).finally(() => {
      if (validateOperation?.promise === promise)
        validateOperation = undefined
    })
    validateOperation = { sessionId: request.sessionId, generation: request.generation, promise }
    return await promise
  }

  async function validateOnce(request: LocalScreenGatewayValidateRequest, signal?: AbortSignal): Promise<LocalScreenGatewayStatus> {
    if (active?.sessionId === request.sessionId && active.generation === request.generation && lastStatus.state === 'ready')
      return cloneStatus(lastStatus)
    if (active)
      await stopActive()

    const servicePath = resolveServicePath(fileExists, options.projectRoot, options.appPath)
    if (!servicePath) {
      lastStatus = failedStatus(request, 'runtime-unavailable')
      throw new LocalScreenGatewayError('runtime-unavailable')
    }

    const token = randomToken()
    if (token.length < 32 || token.length > 256) {
      lastStatus = failedStatus(request, 'runtime-validation-failed')
      throw new LocalScreenGatewayError('runtime-validation-failed')
    }
    lastStatus = statusFor(request, 'starting')

    let child: ChildProcess
    try {
      child = spawnProcess('wsl.exe', [
        '-d',
        wslDistribution,
        '--',
        'bash',
        '-lc',
        'exec "$HOME/.local/share/airi/perception/qwen3-vl-transformers/.venv/bin/python" "$AIRI_PERCEPTION_SERVICE_PATH"',
      ], {
        env: createWorkerEnvironment(servicePath, token),
        stdio: 'ignore',
        windowsHide: true,
      })
    }
    catch {
      lastStatus = failedStatus(request, 'runtime-unavailable')
      throw new LocalScreenGatewayError('runtime-unavailable')
    }

    const current: ActiveRuntime = {
      sessionId: request.sessionId,
      generation: request.generation,
      child,
      token,
    }
    active = current
    // Node delivers asynchronous spawn failures via 'error', and an
    // EventEmitter 'error' without a listener throws an uncaught exception that
    // would crash the main process. `wsl.exe` is absent on any machine without
    // WSL, so this path is routinely reachable. Attach synchronously, before
    // any await, so no delivery timing can leave the event unhandled.
    child.once('error', () => {
      if (active !== current)
        return
      active = undefined
      if (!stopping && lastStatus.state !== 'stopping' && lastStatus.state !== 'stopped')
        lastStatus = failedStatus(request, 'runtime-unavailable')
    })
    child.once('exit', () => {
      if (active !== current)
        return
      active = undefined
      if (!stopping && lastStatus.state !== 'stopping' && lastStatus.state !== 'stopped')
        lastStatus = failedStatus(request, 'runtime-unavailable')
    })

    try {
      await waitForWorkerHealth(current, signal)
      if (active !== current)
        throw new LocalScreenGatewayError('runtime-stopped')
      lastStatus = statusFor(request, 'validating')
      const runtime = runtimeFactory({
        token,
        sessionId: request.sessionId,
        generation: request.generation,
        deviceClass: 'nvidia-blackwell-laptop-8gb',
        requestTimeoutMs: 60_000,
        validationTimeoutMs: 90_000,
        fetch: fetchImpl,
      })
      current.runtime = runtime
      const validation = await runtime.validate(signal)
      if (active !== current)
        throw new LocalScreenGatewayError('runtime-stopped')
      lastStatus = {
        ...statusFor(request, 'ready'),
        capabilities: [...validation.profile.capabilities],
        loadDurationMs: validation.loadDurationMs,
      }
      return cloneStatus(lastStatus)
    }
    catch (error) {
      const code = mapError(error)
      lastStatus = failedStatus(request, code)
      await stopActive()
      throw new LocalScreenGatewayError(code)
    }
  }

  async function waitForWorkerHealth(current: ActiveRuntime, signal?: AbortSignal): Promise<void> {
    const deadline = now() + startupTimeoutMs
    while (now() < deadline) {
      if (signal?.aborted)
        throw new LocalScreenGatewayError('runtime-cancelled')
      if (current.child.exitCode !== null)
        throw new LocalScreenGatewayError('runtime-unavailable')
      try {
        const response = await fetchImpl(`http://127.0.0.1:${SERVICE_PORT}/health`, {
          headers: { 'x-airi-perception-token': current.token },
          signal: AbortSignal.timeout(2_000),
        })
        if (response.ok) {
          const value = await response.json() as unknown
          if (isExpectedHealth(value))
            return
        }
      }
      catch {
        // The loopback listener may not have bound yet; retry within the fixed startup budget.
      }
      await wait(pollIntervalMs)
    }
    throw new LocalScreenGatewayError('runtime-timeout')
  }

  async function analyze(request: LocalTransformersScreenAnalysisRequest): Promise<LocalScreenAnalyzeResponse> {
    const current = active
    if (!current?.runtime || lastStatus.state !== 'ready')
      throw new LocalScreenGatewayError('runtime-stopped')
    if (request.envelope.sessionId !== current.sessionId || request.envelope.generation !== current.generation)
      throw new LocalScreenGatewayError('stale-generation')
    try {
      const result = await current.runtime.analyze(request)
      return {
        contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
        sessionId: request.envelope.sessionId,
        generation: request.envelope.generation,
        observationId: request.envelope.observationId,
        events: result.events,
        totalDurationMs: result.totalDurationMs,
        outputTokenCount: result.outputTokenCount,
      }
    }
    catch (error) {
      throw new LocalScreenGatewayError(mapError(error))
    }
  }

  async function stop(request: LocalScreenGatewayStopRequest): Promise<LocalScreenGatewayStatus> {
    if (active && (active.sessionId !== request.sessionId || active.generation !== request.generation))
      throw new LocalScreenGatewayError('stale-generation')
    lastStatus = statusFor(request, 'stopping')
    await stopActive()
    lastStatus = stoppedStatus(request.sessionId, request.generation)
    return cloneStatus(lastStatus)
  }

  function status(request: LocalScreenGatewayStatusRequest): LocalScreenGatewayStatus {
    if (active && (active.sessionId !== request.sessionId || active.generation !== request.generation))
      throw new LocalScreenGatewayError('stale-generation')
    if (!active && (lastStatus.sessionId !== request.sessionId || lastStatus.generation !== request.generation))
      return stoppedStatus(request.sessionId, request.generation)
    return cloneStatus(lastStatus)
  }

  async function stopActive(): Promise<void> {
    const current = active
    active = undefined
    if (!current)
      return
    await current.runtime?.stop().catch(() => undefined)
    if (current.child.exitCode === null)
      await waitForProcessExit(current.child, gracefulStopTimeoutMs)
    if (current.child.exitCode === null)
      await terminateProcess(current.child).catch(() => undefined)
  }

  async function stopAll(): Promise<void> {
    if (stopping)
      return
    stopping = true
    const current = active
    const sessionId = current?.sessionId ?? lastStatus.sessionId
    const generation = current?.generation ?? lastStatus.generation
    lastStatus = statusFor({ sessionId, generation }, 'stopping')
    await stopActive()
    lastStatus = stoppedStatus(sessionId, generation)
  }

  return { validate, analyze, stop, status, stopAll }
}

export function setupLocalTransformersScreenManager(options: LocalTransformersScreenManagerOptions = {}) {
  const manager = createLocalTransformersScreenManager(options)
  onAppBeforeQuit(() => manager.stopAll())
  return manager
}

/**
 * Marker file identifying the AIRI monorepo root. appPath-derived candidate
 * roots are trusted only when this marker is present, so packaged installs
 * (whose ancestors are arbitrary directories) never resolve a service script
 * there.
 */
const workspaceRootMarker = 'pnpm-workspace.yaml'

// NOTICE:
// In dev the Electron appPath sits 2 levels below the monorepo root
// (apps/stage-tamagotchi); 4 levels leaves headroom for build output
// directories without scanning far up the filesystem.
// Removal condition: appPath-relative service resolution is replaced by an
// explicit configured root.
const appPathAncestorLevels = 4

/**
 * Collects directories trusted to contain the local perception service script.
 *
 * Trust model:
 * - `explicitRoot` (options.projectRoot) and the `AIRI_PROJECT_ROOT`
 *   environment variable are deliberate user configuration, trusted as-is.
 * - `appPath` and up to {@link appPathAncestorLevels} ancestors are trusted
 *   only when they carry {@link workspaceRootMarker} (a dev checkout).
 * - `process.cwd()` is never trusted: walking cwd ancestors would hand a
 *   third-party `server.py` at the same relative path to the WSL python
 *   interpreter whenever the app is launched from an untrusted directory.
 */
function candidateProjectRoots(
  fileExists: (path: string) => boolean,
  explicitRoot?: string,
  appPath?: string,
): string[] {
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

function resolveServicePath(fileExists: (path: string) => boolean, explicitRoot?: string, appPath?: string): string | undefined {
  for (const root of candidateProjectRoots(fileExists, explicitRoot, appPath)) {
    const candidate = resolve(root, SERVICE_RELATIVE_PATH)
    if (fileExists(candidate))
      return candidate
  }
}

function createWorkerEnvironment(servicePath: string, token: string): NodeJS.ProcessEnv {
  const forwarded = [
    'AIRI_PERCEPTION_TOKEN/u',
    'AIRI_PERCEPTION_PORT/u',
    'AIRI_PERCEPTION_IDLE_SECONDS/u',
    'AIRI_PERCEPTION_SERVICE_PATH/pu',
  ]
  const existing = (process.env.WSLENV ?? '').split(':').filter(Boolean)
  return {
    ...process.env,
    AIRI_PERCEPTION_TOKEN: token,
    AIRI_PERCEPTION_PORT: String(SERVICE_PORT),
    AIRI_PERCEPTION_IDLE_SECONDS: '120',
    AIRI_PERCEPTION_SERVICE_PATH: servicePath,
    WSLENV: [...new Set([...existing, ...forwarded])].join(':'),
  }
}

async function defaultTerminateProcess(child: ChildProcess): Promise<void> {
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

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || timeoutMs <= 0)
    return
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(done, timeoutMs)
    child.once('exit', done)
    function done() {
      clearTimeout(timeout)
      child.removeListener('exit', done)
      resolveExit()
    }
  })
}

function isExpectedHealth(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['serviceVersion', 'state', 'modelId', 'revision', 'quantizationId'])
    && value.serviceVersion === LOCAL_TRANSFORMERS_SERVICE_VERSION
    && ['stopped', 'ready'].includes(String(value.state))
    && value.modelId === LOCAL_SCREEN_MODEL_ID
    && value.revision === LOCAL_SCREEN_MODEL_REVISION
    && value.quantizationId === LOCAL_SCREEN_QUANTIZATION_ID
}

function statusFor(
  correlation: Pick<LocalScreenGatewayStatusRequest, 'sessionId' | 'generation'>,
  state: LocalScreenGatewayStatus['state'],
): LocalScreenGatewayStatus {
  return {
    contractVersion: LOCAL_SCREEN_GATEWAY_VERSION,
    sessionId: correlation.sessionId,
    generation: correlation.generation,
    profileId: LOCAL_SCREEN_PROFILE_ID,
    state,
    modelId: LOCAL_SCREEN_MODEL_ID,
    revision: LOCAL_SCREEN_MODEL_REVISION,
    quantizationId: LOCAL_SCREEN_QUANTIZATION_ID,
    capabilities: [...EMPTY_CAPABILITIES],
  }
}

function stoppedStatus(sessionId: string, generation: number): LocalScreenGatewayStatus {
  return statusFor({ sessionId, generation }, 'stopped')
}

function failedStatus(
  correlation: Pick<LocalScreenGatewayStatusRequest, 'sessionId' | 'generation'>,
  errorCode: import('../../../../shared/eventa/perception-local-screen').LocalScreenGatewayErrorCode,
): LocalScreenGatewayStatus {
  return { ...statusFor(correlation, 'failed'), errorCode }
}

function cloneStatus(status: LocalScreenGatewayStatus): LocalScreenGatewayStatus {
  return { ...status, capabilities: [...status.capabilities] }
}

function mapError(error: unknown): import('../../../../shared/eventa/perception-local-screen').LocalScreenGatewayErrorCode {
  if (error instanceof LocalScreenGatewayError)
    return error.code
  if (error instanceof LocalTransformersScreenError) {
    switch (error.code) {
      case 'screen-runtime-busy':
        return 'runtime-busy'
      case 'runtime-validation-cancelled':
      case 'screen-inference-cancelled':
        return 'runtime-cancelled'
      case 'runtime-validation-timeout':
      case 'screen-inference-timeout':
        return 'runtime-timeout'
      case 'runtime-response-invalid':
      case 'screen-output-invalid':
        return 'runtime-output-invalid'
      case 'model-identity-mismatch':
      case 'runtime-service-mismatch':
      case 'model-not-installed':
        return 'runtime-validation-failed'
      default:
        return 'runtime-unavailable'
    }
  }
  return 'runtime-unavailable'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index])
}
