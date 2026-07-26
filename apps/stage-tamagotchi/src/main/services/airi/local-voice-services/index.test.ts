import type { ChildProcess } from 'node:child_process'

import { EventEmitter } from 'node:events'

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
})
