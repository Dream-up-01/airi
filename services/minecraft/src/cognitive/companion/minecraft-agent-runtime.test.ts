import type {
  MinecraftActionExecutionContext,
  MinecraftActionResult,
  MinecraftAgentAction,
  MinecraftAgentExecutorAdapter,
  MinecraftConsentGrant,
  MinecraftServerProfile,
} from '@proj-airi/stage-ui/domains/minecraft-companion'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMinecraftServerProfileFromRuntimeConfig, MinecraftAgentRuntime } from './minecraft-agent-runtime'

const serverProfile: MinecraftServerProfile = {
  contractVersion: 'minecraft-companion/v1',
  serverProfileId: 'server-profile-1',
  host: 'localhost',
  port: 25_565,
  minecraftVersion: '1.20.1',
  runtime: 'unknown',
  authMode: 'offline',
  serverKind: 'private',
  accountProfileId: 'account-profile-1',
  allowVirtualPlayerJoin: true,
}

function createGrant(allowedActionKinds: MinecraftAgentAction['kind'][]): MinecraftConsentGrant {
  return {
    contractVersion: 'minecraft-agent-control/v1',
    grantId: 'grant-1',
    serverProfileId: serverProfile.serverProfileId,
    allowVirtualPlayerJoin: true,
    allowedActionKinds,
    grantedAt: 900,
    showPersistentIndicator: true,
  }
}

function createExecutor() {
  const execute = vi.fn(async (_action: MinecraftAgentAction, context: MinecraftActionExecutionContext): Promise<MinecraftActionResult> => ({
    contractVersion: 'minecraft-agent-control/v1',
    intentId: context.intentId,
    goalId: context.goalId,
    sessionId: context.sessionId,
    generation: context.generation,
    state: 'completed',
    completedAt: 1_001,
  }))
  const cancel = vi.fn(async () => {})
  const executor: MinecraftAgentExecutorAdapter = {
    adapterId: 'fake-executor',
    supports: () => true,
    execute,
    cancel,
  }
  return { executor, execute, cancel }
}

describe('minecraft agent runtime', () => {
  let nextId = 0

  beforeEach(() => {
    nextId = 0
  })

  function createRuntime(executor: MinecraftAgentExecutorAdapter, consent?: MinecraftConsentGrant) {
    return new MinecraftAgentRuntime({
      sessionId: 'session-1',
      generation: 1,
      serverProfile,
      executor,
      consent,
      now: () => 1_000,
      idFactory: prefix => `${prefix}-${++nextId}`,
    })
  }

  it('creates a stable non-official server profile from the selected bot connection', () => {
    const input = {
      host: 'mc.example.test',
      port: 25_565,
      username: 'airi_bot',
      version: '1.20.1',
      auth: 'offline' as const,
    }

    expect(createMinecraftServerProfileFromRuntimeConfig(input)).toEqual(createMinecraftServerProfileFromRuntimeConfig(input))
    expect(createMinecraftServerProfileFromRuntimeConfig(input)).toMatchObject({
      host: input.host,
      port: input.port,
      minecraftVersion: input.version,
      authMode: 'offline',
      serverKind: 'unknown',
      runtime: 'unknown',
      allowVirtualPlayerJoin: true,
    })
  })

  it('does not execute without a matching join and action grant', async () => {
    const { executor, execute } = createExecutor()
    const runtime = createRuntime(executor)

    await expect(runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'consent-required',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reports a revoked grant without executing', async () => {
    const { executor, execute } = createExecutor()
    const runtime = createRuntime(executor, { ...createGrant(['jump']), revokedAt: 950 })

    await expect(runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'consent-revoked',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('executes an auto-approved low-risk action', async () => {
    const { executor, execute } = createExecutor()
    const runtime = createRuntime(executor, createGrant(['jump']))

    await expect(runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })).resolves.toMatchObject({
      ok: true,
      state: 'completed',
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('keeps high-risk actions awaiting approval until explicitly approved', async () => {
    const { executor, execute } = createExecutor()
    const runtime = createRuntime(executor, createGrant(['attack']))

    const proposed = await runtime.handleAction({ kind: 'attack', targetId: 'zombie-1' }, { commandId: 'cmd-1' })
    expect(proposed).toMatchObject({ ok: true, state: 'awaiting-approval' })
    expect(execute).not.toHaveBeenCalled()

    if (!proposed.ok)
      throw new Error('Expected an awaiting-approval intent')

    await expect(runtime.approve(proposed.intentId)).resolves.toMatchObject({ ok: true, state: 'completed' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('cancels an awaiting-approval intent without executing it', async () => {
    const { executor, execute } = createExecutor()
    const runtime = createRuntime(executor, createGrant(['attack']))
    const proposed = await runtime.handleAction({ kind: 'attack', targetId: 'zombie-1' }, { commandId: 'cmd-1' })
    if (!proposed.ok)
      throw new Error('Expected an awaiting-approval intent')

    await expect(runtime.cancel(proposed.intentId)).resolves.toMatchObject({ ok: true, state: 'cancelled' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('invalidates pending work and cancels in-flight execution on generation change', async () => {
    let finishCancel: (() => void) | undefined
    const execute = vi.fn((_action: MinecraftAgentAction, context: MinecraftActionExecutionContext) => new Promise<MinecraftActionResult>((resolve) => {
      context.signal.addEventListener('abort', () => {
        resolve({
          contractVersion: 'minecraft-agent-control/v1',
          intentId: context.intentId,
          goalId: context.goalId,
          sessionId: context.sessionId,
          generation: context.generation,
          state: 'cancelled',
          completedAt: 1_001,
          errorCode: 'action-cancelled',
        })
      }, { once: true })
    }))
    const cancel = vi.fn(() => new Promise<void>((resolve) => {
      finishCancel = resolve
    }))
    const executor: MinecraftAgentExecutorAdapter = { adapterId: 'fake-executor', supports: () => true, execute, cancel }
    const runtime = createRuntime(executor, createGrant(['jump']))

    const handling = runtime.handleAction({ kind: 'jump' }, { commandId: 'cmd-1' })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    const advancing = runtime.advanceGeneration()
    expect(runtime.generation).toBe(1)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    finishCancel?.()
    await expect(advancing).resolves.toBe(2)

    await expect(handling).resolves.toMatchObject({ ok: true, state: 'cancelled' })
    expect(runtime.generation).toBe(2)
  })
})
