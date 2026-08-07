import type { MinecraftConsentGrant } from '@proj-airi/stage-ui/domains/minecraft-companion'

import type { AiriBridge, SparkCommandDirective } from '../../airi/airi-bridge'
import type { Mineflayer } from '../../libs/mineflayer/core'
import type { TaskExecutor } from '../action/task-executor'
import type { MinecraftAgentRuntimeOptions, MinecraftRuntimeServerConfig } from './minecraft-agent-runtime'

import { randomUUID } from 'node:crypto'

import { minecraftLowRiskActionKinds } from '@proj-airi/stage-ui/domains/minecraft-companion'

import { routeMinecraftCommand } from './goal-router'
import { createMinecraftServerProfileFromRuntimeConfig, MinecraftAgentRuntime } from './minecraft-agent-runtime'
import { MineflayerActionExecutor } from './mineflayer-action-executor'

interface MinecraftAgentRuntimePort {
  readonly generation: number
  advanceGeneration: MinecraftAgentRuntime['advanceGeneration']
  handleAction: MinecraftAgentRuntime['handleAction']
  stop: MinecraftAgentRuntime['stop']
}

export interface MinecraftAgentCompanionOptions {
  airiBridge: AiriBridge
  taskExecutor: Pick<TaskExecutor, 'executeActionWithResult'>
  runtimeConfig: MinecraftRuntimeServerConfig
  runtimeFactory?: (options: MinecraftAgentRuntimeOptions) => MinecraftAgentRuntimePort
  controlEnabled?: boolean
  now?: () => number
  grantIdFactory?: () => string
}

export class MinecraftAgentCompanion {
  readonly #airiBridge: AiriBridge
  readonly #taskExecutor: Pick<TaskExecutor, 'executeActionWithResult'>
  readonly #runtimeConfig: MinecraftRuntimeServerConfig
  readonly #runtimeFactory: (options: MinecraftAgentRuntimeOptions) => MinecraftAgentRuntimePort
  readonly #controlEnabled: boolean
  readonly #now: () => number
  readonly #grantIdFactory: () => string
  #state: 'idle' | 'running' | 'stopping' | 'stopped' = 'idle'
  #runtime?: MinecraftAgentRuntimePort
  #unsubscribeSparkCommand?: () => void
  #destroyPromise?: Promise<number>

  constructor(options: MinecraftAgentCompanionOptions) {
    this.#airiBridge = options.airiBridge
    this.#taskExecutor = options.taskExecutor
    this.#runtimeConfig = options.runtimeConfig
    this.#runtimeFactory = options.runtimeFactory ?? (runtimeOptions => new MinecraftAgentRuntime(runtimeOptions))
    this.#controlEnabled = options.controlEnabled === true
    this.#now = options.now ?? Date.now
    this.#grantIdFactory = options.grantIdFactory ?? (() => `grant-${randomUUID()}`)
  }

  init(mineflayer: Mineflayer): void {
    if (this.#state !== 'idle')
      return

    const executor = new MineflayerActionExecutor({
      taskExecutor: this.#taskExecutor,
      mineflayer,
    })
    const serverProfile = createMinecraftServerProfileFromRuntimeConfig(this.#runtimeConfig)
    const consent: MinecraftConsentGrant | undefined = this.#controlEnabled
      ? {
          contractVersion: 'minecraft-agent-control/v1',
          grantId: this.#grantIdFactory(),
          serverProfileId: serverProfile.serverProfileId,
          allowVirtualPlayerJoin: true,
          allowedActionKinds: [...minecraftLowRiskActionKinds],
          autoApproveActionKinds: [...minecraftLowRiskActionKinds],
          grantedAt: this.#now(),
          showPersistentIndicator: true,
        }
      : undefined
    this.#runtime = this.#runtimeFactory({
      sessionId: `minecraft-${randomUUID()}`,
      generation: 1,
      serverProfile,
      executor,
      consent,
    })
    this.#unsubscribeSparkCommand = this.#airiBridge.onSparkCommand(directive => this.#handleDirective(directive))
    this.#state = 'running'
  }

  destroy(): Promise<number> {
    if (this.#destroyPromise)
      return this.#destroyPromise

    this.#state = 'stopping'
    this.#destroyPromise = (async () => {
      const generation = await (this.#runtime?.stop() ?? Promise.resolve(0))
      this.#unsubscribeSparkCommand?.()
      this.#unsubscribeSparkCommand = undefined
      this.#runtime = undefined
      this.#state = 'stopped'
      return generation
    })()
    return this.#destroyPromise
  }

  async #handleDirective(directive: SparkCommandDirective): Promise<boolean> {
    if (this.#state === 'stopping') {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'source-disconnected')
      return true
    }

    const route = routeMinecraftCommand(directive.message)
    if (route.kind === 'fallback') {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'control-denied')
      return true
    }
    if (route.kind === 'blocked') {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', route.errorCode)
      return true
    }
    if (directive.intent !== 'action') {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'control-denied')
      return true
    }

    const runtime = this.#runtime
    if (!runtime) {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'source-disconnected')
      return true
    }

    try {
      if (directive.interrupt === 'force') {
        await runtime.advanceGeneration()
        if (this.#state !== 'running' || this.#runtime !== runtime) {
          this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'source-disconnected')
          return true
        }
      }
      this.#airiBridge.sendEmit(directive.commandId, 'working', 'minecraft-action-admitted')
      const result = await runtime.handleAction(route.action, { commandId: directive.commandId })
      if (!result.ok) {
        this.#airiBridge.sendEmit(directive.commandId, 'dropped', result.errorCode)
        return true
      }

      if (result.state === 'completed')
        this.#airiBridge.sendEmit(directive.commandId, 'done', 'minecraft-action-completed')
      else
        this.#airiBridge.sendEmit(directive.commandId, 'working', 'approval-required')
      return true
    }
    catch {
      this.#airiBridge.sendEmit(directive.commandId, 'dropped', 'unknown')
      return true
    }
  }
}

export * from './goal-router'
export * from './minecraft-agent-runtime'
export * from './mineflayer-action-executor'
