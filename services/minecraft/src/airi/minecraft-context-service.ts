import type { ContextUpdate, MinecraftPerceptionWireEvent, ModuleAnnouncedEvent } from '@proj-airi/server-sdk'

import type { MineflayerWithAgents } from '../cognitive/types'
import type { AiriBridge } from './airi-bridge'

import {
  ContextUpdateStrategy,
  MINECRAFT_PERCEPTION_LANE,
  MINECRAFT_PERCEPTION_SCHEMA_VERSION,
} from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

interface MinecraftStatusSnapshot {
  connection: 'connected'
  playerStatus: 'safe' | 'injured' | 'low-health' | 'hungry' | 'underwater'
  taskState: 'idle' | 'in-progress' | 'blocked'
  nearbyThreat: 'none' | 'low' | 'medium' | 'high'
}

const STATUS_REFRESH_INTERVAL_MS = 5_000
const STATUS_TTL_MS = 15_000

function collectFrontendDestinations(event: ModuleAnnouncedEvent) {
  const instanceId = event.identity?.id
  return instanceId ? [`instance:${instanceId}`] : []
}

function playerStatus(bot: MineflayerWithAgents): MinecraftStatusSnapshot['playerStatus'] {
  const entity = bot.bot.entity as unknown as { isInWater?: boolean } | undefined
  if (entity?.isInWater)
    return 'underwater'
  if ((bot.bot.health ?? 20) <= 6)
    return 'low-health'
  if ((bot.bot.health ?? 20) < 20)
    return 'injured'
  if ((bot.bot.food ?? 20) <= 6)
    return 'hungry'
  return 'safe'
}

function taskState(bot: MineflayerWithAgents): MinecraftStatusSnapshot['taskState'] {
  const mode = bot.reflexManager.getMode()
  if (mode === 'work' || mode === 'wander')
    return 'in-progress'
  if (mode === 'alert')
    return 'blocked'
  return 'idle'
}

function threatLevel(bot: MineflayerWithAgents): MinecraftStatusSnapshot['nearbyThreat'] {
  const score = bot.reflexManager.getContextSnapshot().threat.threatScore
  if (score >= 3)
    return 'high'
  if (score >= 2)
    return 'medium'
  if (score > 0)
    return 'low'
  return 'none'
}

export class MinecraftContextService {
  private runtimeBot: MineflayerWithAgents | null = null
  private currentSnapshot: MinecraftStatusSnapshot | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private unsubscribeModuleAnnounced: (() => void) | null = null
  private sequence = 0

  constructor(private readonly deps: {
    airiBridge: Pick<AiriBridge, 'onModuleAnnounced' | 'sendContextUpdate'>
    serverHost: string
    serverPort: number
    masterUsername?: string
    refreshIntervalMs?: number
  }) {}

  init() {
    if (this.unsubscribeModuleAnnounced)
      return

    this.unsubscribeModuleAnnounced = this.deps.airiBridge.onModuleAnnounced((event) => {
      const destinations = collectFrontendDestinations(event)
      if (destinations.length > 0)
        this.publishStatus({ destinations })
    })
  }

  bindBot(bot: MineflayerWithAgents) {
    this.runtimeBot = bot
    this.publishStatus()
    if (this.refreshTimer)
      clearInterval(this.refreshTimer)
    this.refreshTimer = setInterval(() => this.publishStatus(), this.deps.refreshIntervalMs ?? STATUS_REFRESH_INTERVAL_MS)
  }

  unbindBot() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.currentSnapshot)
      this.publishSnapshot(this.currentSnapshot, { phase: 'ended' })
    this.runtimeBot = null
    this.currentSnapshot = null
  }

  publishStatus(options: { destinations?: string[] } = {}) {
    const snapshot = this.refreshStatusSnapshot()
    if (snapshot)
      this.publishSnapshot(snapshot, { phase: 'observed', destinations: options.destinations })
  }

  getStatusSnapshot() {
    return this.currentSnapshot ? { ...this.currentSnapshot } : null
  }

  destroy() {
    this.unbindBot()
    this.unsubscribeModuleAnnounced?.()
    this.unsubscribeModuleAnnounced = null
  }

  private publishSnapshot(snapshot: MinecraftStatusSnapshot, options: {
    phase: MinecraftPerceptionWireEvent['phase']
    destinations?: string[]
  }) {
    const observedAt = Date.now()
    const signals: Array<Pick<MinecraftPerceptionWireEvent, 'eventType' | 'value' | 'confidence'>> = [
      { eventType: 'connection-health', value: options.phase === 'ended' ? 'disconnected' : snapshot.connection, confidence: 1 },
      { eventType: 'player-status', value: snapshot.playerStatus, confidence: 1 },
      { eventType: 'task-state', value: snapshot.taskState, confidence: 1 },
      { eventType: 'nearby-threat', value: snapshot.nearbyThreat, confidence: 0.95 },
    ]

    for (const signal of signals) {
      this.sequence += 1
      const content: MinecraftPerceptionWireEvent = {
        schemaVersion: MINECRAFT_PERCEPTION_SCHEMA_VERSION,
        eventId: nanoid(),
        sequence: this.sequence,
        observedAt,
        ttlMs: STATUS_TTL_MS,
        eventType: signal.eventType,
        phase: options.phase,
        value: signal.value,
        confidence: signal.confidence,
      }
      const update: ContextUpdate<Record<string, unknown>, MinecraftPerceptionWireEvent> = {
        id: nanoid(),
        contextId: `minecraft:perception:${signal.eventType}`,
        lane: MINECRAFT_PERCEPTION_LANE,
        text: 'Structured Minecraft perception event.',
        content,
        strategy: ContextUpdateStrategy.ReplaceSelf,
      }
      if (options.destinations?.length)
        update.destinations = options.destinations
      this.deps.airiBridge.sendContextUpdate(update)
    }
  }

  private refreshStatusSnapshot() {
    if (!this.runtimeBot)
      return this.currentSnapshot
    this.runtimeBot.reflexManager.refreshFromBotState()
    this.currentSnapshot = {
      connection: 'connected',
      playerStatus: playerStatus(this.runtimeBot),
      taskState: taskState(this.runtimeBot),
      nearbyThreat: threatLevel(this.runtimeBot),
    }
    return this.currentSnapshot
  }
}
