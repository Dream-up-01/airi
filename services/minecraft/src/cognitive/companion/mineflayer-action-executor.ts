import type {
  MinecraftActionExecutionContext,
  MinecraftActionResult,
  MinecraftAgentAction,
  MinecraftAgentExecutorAdapter,
  MinecraftStableErrorCode,
} from '@proj-airi/stage-ui/domains/minecraft-companion'

import type { Mineflayer } from '../../libs/mineflayer/core'
import type { TaskExecutor } from '../action/task-executor'

const JUMP_DURATION_MS = 250
const supportedActionKinds = new Set<MinecraftAgentAction['kind']>([
  'look-at',
  'move-to-player',
  'follow-player',
  'jump',
  'send-chat',
  'select-hotbar',
  'use-held-item',
])

type TaskExecutorPort = Pick<TaskExecutor, 'executeActionWithResult'>
type LookTarget = Parameters<Mineflayer['bot']['lookAt']>[0]

interface MineflayerBotPort {
  players: Record<string, { entity?: { position: LookTarget } } | undefined>
  lookAt: Mineflayer['bot']['lookAt']
  setControlState: Mineflayer['bot']['setControlState']
  setQuickBarSlot: Mineflayer['bot']['setQuickBarSlot']
  activateItem: Mineflayer['bot']['activateItem']
}

interface MineflayerPort {
  bot: MineflayerBotPort
  interrupt: (reason?: string) => void
}

export interface MineflayerActionExecutorOptions {
  taskExecutor: TaskExecutorPort
  mineflayer: MineflayerPort
  now?: () => number
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>
}

function sleepWithAbort(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('action-cancelled'))
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('action-cancelled'))
    }
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isExplicitFailure(result: unknown): boolean {
  return typeof result === 'object'
    && result !== null
    && Reflect.get(result, 'ok') === false
}

export class MineflayerActionExecutor implements MinecraftAgentExecutorAdapter {
  readonly adapterId = 'mineflayer-bounded-actions/v1'
  readonly #taskExecutor: TaskExecutorPort
  readonly #mineflayer: MineflayerPort
  readonly #now: () => number
  readonly #sleep: (durationMs: number, signal: AbortSignal) => Promise<void>

  constructor(options: MineflayerActionExecutorOptions) {
    this.#taskExecutor = options.taskExecutor
    this.#mineflayer = options.mineflayer
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? sleepWithAbort
  }

  supports(action: MinecraftAgentAction): boolean {
    return supportedActionKinds.has(action.kind)
  }

  async execute(action: MinecraftAgentAction, context: MinecraftActionExecutionContext): Promise<MinecraftActionResult> {
    if (context.signal.aborted)
      return this.#result(context, 'cancelled', 'action-cancelled')
    if (!this.supports(action))
      return this.#result(context, 'failed', 'control-denied')

    try {
      switch (action.kind) {
        case 'move-to-player': {
          const result = await this.#taskExecutor.executeActionWithResult({
            tool: 'goToPlayer',
            params: { player_name: action.playerId, closeness: action.radius },
          })
          if (isExplicitFailure(result))
            return this.#result(context, 'failed', 'unknown')
          break
        }
        case 'follow-player': {
          const result = await this.#taskExecutor.executeActionWithResult({
            tool: 'followPlayer',
            params: { player_name: action.playerId, follow_dist: action.radius },
          })
          if (isExplicitFailure(result))
            return this.#result(context, 'failed', 'unknown')
          break
        }
        case 'send-chat':
          await this.#taskExecutor.executeActionWithResult({
            tool: 'chat',
            params: { message: action.message, feedback: false },
          })
          break
        case 'look-at': {
          const player = this.#mineflayer.bot.players[action.playerId]?.entity
          if (!player)
            return this.#result(context, 'failed', 'control-denied')
          await this.#mineflayer.bot.lookAt(player.position, true)
          break
        }
        case 'jump':
          this.#mineflayer.bot.setControlState('jump', true)
          try {
            await this.#sleep(JUMP_DURATION_MS, context.signal)
          }
          finally {
            this.#mineflayer.bot.setControlState('jump', false)
          }
          break
        case 'select-hotbar':
          this.#mineflayer.bot.setQuickBarSlot(action.slot)
          break
        case 'use-held-item':
          this.#mineflayer.bot.activateItem()
          break
        default:
          return this.#result(context, 'failed', 'control-denied')
      }

      return this.#result(context, 'completed')
    }
    catch {
      return context.signal.aborted
        ? this.#result(context, 'cancelled', 'action-cancelled')
        : this.#result(context, 'failed', 'unknown')
    }
  }

  async cancel(intentId: string, _context: MinecraftActionExecutionContext): Promise<void> {
    this.#mineflayer.interrupt(`minecraft-agent:${intentId}:cancelled`)
  }

  #result(
    context: MinecraftActionExecutionContext,
    state: MinecraftActionResult['state'],
    errorCode?: MinecraftStableErrorCode,
  ): MinecraftActionResult {
    return {
      contractVersion: 'minecraft-agent-control/v1',
      intentId: context.intentId,
      goalId: context.goalId,
      sessionId: context.sessionId,
      generation: context.generation,
      state,
      completedAt: this.#now(),
      ...(errorCode ? { errorCode } : {}),
    }
  }
}
