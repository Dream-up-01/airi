import type { Client, ContextUpdate, ModuleAnnouncedEvent, WebSocketEvents } from '@proj-airi/server-sdk'

import type { EventBus } from '../cognitive/event-bus'

import { useLogg } from '@guiiai/logg'
import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export type SparkCommandData = Pick<
  WebSocketEvents['spark:command'],
  'id' | 'commandId' | 'intent' | 'interrupt' | 'priority' | 'guidance'
>

export interface SparkCommandDirective {
  deliveryId: string
  commandId: string
  intent: SparkCommandData['intent']
  interrupt?: SparkCommandData['interrupt']
  message: string
  priority?: SparkCommandData['priority']
}

export interface SparkCommandListener {
  (directive: SparkCommandDirective): boolean | Promise<boolean>
}

const MAX_SPARK_COMMAND_TEXT_LENGTH = 512
const MAX_SPARK_COMMAND_OPTIONS = 8
const MAX_SPARK_COMMAND_STEPS = 16
const MAX_SPARK_COMMAND_DESTINATIONS = 16
const MAX_SPARK_COMMAND_PERSONA_TRAITS = 16
const MAX_SPARK_COMMAND_CONTEXTS = 8
const MAX_SPARK_COMMAND_CONTEXT_TEXT_LENGTH = 4096
const MAX_SPARK_COMMAND_METADATA_ENTRIES = 16
const DEFAULT_SPARK_REPLAY_CAPACITY = 2048
const DEFAULT_SPARK_REPLAY_TTL_MS = 30 * 60 * 1000

export interface AiriBridgeOptions {
  now?: () => number
  replayCapacity?: number
  replayTtlMs?: number
}

type SparkCommandParseResult
  = | { ok: true, value: SparkCommandData }
    | { ok: false, deliveryId: string }

export class AiriBridge {
  private readonly logger = useLogg('airi-bridge').useGlobalConfig()
  private commandHandler: ((event: { data: unknown }) => Promise<void>) | null = null
  private contextUpdateHandler: ((event: { data: ContextUpdate }) => void) | null = null
  private moduleAnnouncedHandler: ((event: { data: ModuleAnnouncedEvent }) => void) | null = null
  private readonly moduleAnnouncedListeners = new Set<(event: ModuleAnnouncedEvent) => void>()
  private readonly activeSparkCommandIds = new Map<string, { fingerprint: string, token: symbol }>()
  private readonly seenSparkCommandIds = new Map<string, { seenAt: number, fingerprint: string }>()
  private readonly sparkCommandListeners = new Set<SparkCommandListener>()
  private readonly now: () => number
  private readonly replayCapacity: number
  private readonly replayTtlMs: number

  constructor(
    private readonly client: Client,
    private readonly eventBus: EventBus,
    options: AiriBridgeOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.replayCapacity = positiveIntegerOr(options.replayCapacity, DEFAULT_SPARK_REPLAY_CAPACITY)
    this.replayTtlMs = positiveIntegerOr(options.replayTtlMs, DEFAULT_SPARK_REPLAY_TTL_MS)
  }

  init(): void {
    this.commandHandler = async (event) => {
      const parsed = parseSparkCommandData(event.data)
      if (!parsed.ok) {
        this.sendEmit(parsed.deliveryId, 'dropped', 'invalid-contract')
        return
      }

      const cmd = parsed.value
      const directive = this.toSparkCommandDirective(cmd)
      const fingerprint = sparkDirectiveFingerprint(directive)
      const receivedAt = this.now()
      this.pruneSparkCommandReplays(receivedAt)
      const activeCommand = this.activeSparkCommandIds.get(cmd.commandId)
      if (activeCommand) {
        this.sendEmit(cmd.id, 'dropped', activeCommand.fingerprint === fingerprint ? 'duplicate-command' : 'invalid-contract')
        return
      }
      const previous = this.seenSparkCommandIds.get(cmd.commandId)
      if (previous) {
        this.seenSparkCommandIds.delete(cmd.commandId)
        this.seenSparkCommandIds.set(cmd.commandId, { seenAt: receivedAt, fingerprint: previous.fingerprint })
        this.sendEmit(cmd.id, 'dropped', previous.fingerprint === fingerprint ? 'duplicate-command' : 'invalid-contract')
        return
      }
      if (this.activeSparkCommandIds.size >= this.replayCapacity) {
        this.sendEmit(cmd.id, 'dropped', 'control-denied')
        return
      }
      const executionToken = Symbol(cmd.commandId)
      this.activeSparkCommandIds.set(cmd.commandId, { fingerprint, token: executionToken })

      try {
        this.logger.log('Received spark:command', { intent: cmd.intent, commandId: cmd.commandId })

        // Acknowledge receipt
        this.client.send({
          type: 'spark:emit',
          data: {
            id: nanoid(),
            eventId: cmd.commandId,
            state: 'queued',
            note: 'Command received',
          },
        } as Parameters<typeof this.client.send>[0])

        // A spark:command is high-level guidance from the AIRI server. It must carry enough weight to
        // trigger a fresh decision (Conscious) cycle, never be silently filed into history — so we
        // always route it through handleActionIntent (→ signal:airi_command → enqueueEvent → decision cycle).
        //
        // We intentionally do not special-case `intent === 'context'`: that branch used to emit
        // signal:airi_context which Brain pushes to conversationHistory WITHOUT waking the loop, so a
        // command that mislabels its intent as "context" would be silently dropped from action. True
        // passive context still has its own dedicated channel — `context:update` (see
        // contextUpdateHandler) — which remains history-only and is unaffected by this routing.
        for (const listener of this.sparkCommandListeners) {
          try {
            if (await listener(directive))
              return
          }
          catch (error) {
            this.logger.errorWithError('Spark command listener failed', error as Error)
            this.sendEmit(cmd.commandId, 'dropped', 'unknown')
            return
          }
        }

        this.handleActionIntent(cmd)
      }
      finally {
        if (this.activeSparkCommandIds.get(cmd.commandId)?.token === executionToken) {
          this.activeSparkCommandIds.delete(cmd.commandId)
          this.pruneSparkCommandReplays(this.now())
          while (this.seenSparkCommandIds.size >= this.replayCapacity) {
            const oldestCommandId = this.seenSparkCommandIds.keys().next().value
            if (oldestCommandId === undefined)
              break
            this.seenSparkCommandIds.delete(oldestCommandId)
          }
          this.seenSparkCommandIds.set(cmd.commandId, { seenAt: this.now(), fingerprint })
        }
      }
    }

    this.contextUpdateHandler = (event) => {
      const ctx = event.data
      this.logger.log('Received context:update', { lane: ctx.lane })

      this.eventBus.emit({
        type: 'signal:airi_context',
        payload: Object.freeze({
          type: 'airi_context' as const,
          description: ctx.text,
          sourceId: 'airi',
          confidence: 1.0,
          timestamp: Date.now(),
          metadata: {
            source: 'airi',
            contextId: ctx.contextId,
            lane: ctx.lane ?? 'general',
            hints: ctx.hints ?? [],
          },
        }),
        source: { component: 'airi', id: 'bridge' },
      })
    }

    this.moduleAnnouncedHandler = (event) => {
      const moduleAnnouncement = event.data
      this.logger.log('Received module:announced', { name: moduleAnnouncement.name, pluginId: moduleAnnouncement.identity?.plugin?.id })
      for (const listener of this.moduleAnnouncedListeners) {
        listener(moduleAnnouncement)
      }
    }

    this.client.onEvent('spark:command', this.commandHandler as Parameters<typeof this.client.onEvent<'spark:command'>>[1])
    this.client.onEvent('context:update', this.contextUpdateHandler as Parameters<typeof this.client.onEvent<'context:update'>>[1])
    this.client.onEvent('module:announced', this.moduleAnnouncedHandler as Parameters<typeof this.client.onEvent<'module:announced'>>[1])
    this.logger.log('AiriBridge initialized, listening for spark:command, context:update, and module:announced')
  }

  destroy(): void {
    if (this.commandHandler) {
      this.client.offEvent('spark:command', this.commandHandler as Parameters<typeof this.client.offEvent<'spark:command'>>[1])
      this.commandHandler = null
    }
    if (this.contextUpdateHandler) {
      this.client.offEvent('context:update', this.contextUpdateHandler as Parameters<typeof this.client.offEvent<'context:update'>>[1])
      this.contextUpdateHandler = null
    }
    if (this.moduleAnnouncedHandler) {
      this.client.offEvent('module:announced', this.moduleAnnouncedHandler as Parameters<typeof this.client.offEvent<'module:announced'>>[1])
      this.moduleAnnouncedHandler = null
    }
    this.moduleAnnouncedListeners.clear()
    this.activeSparkCommandIds.clear()
    this.seenSparkCommandIds.clear()
    this.sparkCommandListeners.clear()
    this.logger.log('AiriBridge destroyed')
  }

  sendNotify(headline: string, note?: string, urgency: 'immediate' | 'soon' | 'later' = 'soon'): void {
    this.client.send({
      type: 'spark:notify',
      data: {
        id: nanoid(),
        eventId: nanoid(),
        kind: 'ping',
        urgency,
        headline,
        note,
        destinations: ['proj-airi:stage-*'],
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent spark:notify', { headline, urgency })
  }

  sendContextUpdate(text: string, hints?: string[], lane?: string): void
  sendContextUpdate(update: ContextUpdate<Record<string, unknown>, unknown>): void
  sendContextUpdate(textOrUpdate: string | Omit<ContextUpdate<Record<string, unknown>, unknown>, 'strategy' | 'id' | 'contextId'> & { contextId?: string }, hints?: string[], lane = 'game'): void {
    const update = typeof textOrUpdate === 'string'
      ? {
        text: textOrUpdate,
        hints,
        lane,
        strategy: ContextUpdateStrategy.AppendSelf,
      } satisfies Omit<ContextUpdate, 'id' | 'contextId'> & { contextId?: string }
      : {
          strategy: ContextUpdateStrategy.AppendSelf,
          ...textOrUpdate,
        }

    const contextId = update.contextId ?? nanoid()
    this.client.send({
      type: 'context:update',
      data: {
        id: nanoid(),
        contextId,
        lane: update.lane,
        text: update.text,
        content: update.content,
        hints: update.hints,
        strategy: update.strategy,
        destinations: update.destinations,
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent context:update', { lane: update.lane, contextId })
  }

  sendEmit(eventId: string, state: 'queued' | 'working' | 'done' | 'dropped', note?: string): void {
    this.client.send({
      type: 'spark:emit',
      data: {
        id: nanoid(),
        eventId,
        state,
        note,
      },
    } as Parameters<typeof this.client.send>[0])
    this.logger.log('Sent spark:emit', { eventId, state })
  }

  onModuleAnnounced(listener: (event: ModuleAnnouncedEvent) => void) {
    this.moduleAnnouncedListeners.add(listener)

    return () => {
      this.moduleAnnouncedListeners.delete(listener)
    }
  }

  onSparkCommand(listener: SparkCommandListener) {
    this.sparkCommandListeners.add(listener)

    return () => {
      this.sparkCommandListeners.delete(listener)
    }
  }

  private pruneSparkCommandReplays(now: number): void {
    for (const [commandId, entry] of this.seenSparkCommandIds) {
      if (now - entry.seenAt <= this.replayTtlMs)
        continue
      this.seenSparkCommandIds.delete(commandId)
    }
  }

  private toSparkCommandDirective(cmd: SparkCommandData): SparkCommandDirective {
    const firstOption = cmd.guidance?.options?.[0]
    const rawLabel = firstOption?.label
    const steps = firstOption?.steps ?? []
    const message = rawLabel && rawLabel.trim().length > 0
      ? rawLabel
      : (steps.length > 0 ? steps.join(' / ') : `${cmd.intent} command received`)

    return {
      deliveryId: cmd.id,
      commandId: cmd.commandId,
      intent: cmd.intent,
      interrupt: cmd.interrupt,
      message,
      priority: cmd.priority,
    }
  }

  private handleActionIntent(cmd: SparkCommandData): void {
    // A spark:command is high-level guidance from the AIRI server. Route it through the explicit
    // `airi_command` signal so the brain runs a fresh decision cycle
    // (resetNoActionFollowupBudget('airi_command'), normal Conscious wake-up) instead of silently
    // filing it into history. The directive is attributed to the AIRI server as a neutral source,
    // not to any specific in-game player. Binding a relayed command to the master's in-game identity
    // is desktop-relay policy and lives in the desktop Minecraft adapter, not in this bot service.
    const firstOption = cmd.guidance?.options?.[0]
    const label = firstOption?.label?.trim()
    const steps = firstOption?.steps ?? []
    // Prefer the short label (closest to the original instruction). Fall back to joined steps so the
    // brain still has detail when label is missing.
    const message = label && label.length > 0
      ? label
      : (steps.length > 0 ? steps.join(' / ') : `${cmd.intent} command received`)

    const sourceId = 'airi'

    this.logger.log('Routing spark:command as an AIRI directive', {
      commandId: cmd.commandId,
      intent: cmd.intent,
    })

    this.eventBus.emit({
      type: 'signal:airi_command',
      payload: Object.freeze({
        type: 'airi_command' as const,
        description: `Directive from AIRI: "${message}"`,
        sourceId,
        confidence: 1.0,
        timestamp: Date.now(),
        metadata: {
          message,
          // Keep the spark provenance for debugging; the brain sees a typed AIRI directive.
          sparkCommandId: cmd.commandId,
          sparkIntent: cmd.intent,
        },
      }),
      source: { component: 'airi', id: 'bridge' },
    })
  }
}

function parseSparkCommandData(input: unknown): SparkCommandParseResult {
  const deliveryId = isRecord(input) && isIdentifier(input.id) ? input.id : nanoid()
  if (!isRecord(input)
    || !hasExactKeys(
      input,
      ['id', 'commandId', 'intent', 'interrupt', 'priority', 'destinations'],
      ['eventId', 'parentEventId', 'ack', 'guidance', 'contexts'],
    )
    || !isIdentifier(input.id)
    || !isOptionalIdentifier(input.eventId)
    || !isOptionalIdentifier(input.parentEventId)
    || !isIdentifier(input.commandId)
    || !['plan', 'proposal', 'action', 'pause', 'resume', 'reroute', 'context'].includes(String(input.intent))
    || !['force', 'soft', false].includes(input.interrupt as never)
    || !['critical', 'high', 'normal', 'low'].includes(String(input.priority))
    || !isOptionalBoundedWireText(input.ack)
    || !isSparkDestinationList(input.destinations)
    || !isSparkGuidance(input.guidance)
    || !isSparkContexts(input.contexts)) {
    return { ok: false, deliveryId }
  }

  return {
    ok: true,
    value: {
      id: input.id,
      commandId: input.commandId,
      intent: input.intent as SparkCommandData['intent'],
      interrupt: input.interrupt as SparkCommandData['interrupt'],
      priority: input.priority as SparkCommandData['priority'],
      guidance: input.guidance as SparkCommandData['guidance'],
    },
  }
}

function isSparkGuidance(input: unknown): boolean {
  if (input === undefined)
    return true
  if (!isRecord(input)
    || !hasExactKeys(input, ['type', 'options'], ['persona'])
    || !['proposal', 'instruction', 'memory-recall'].includes(String(input.type))
    || !isSparkPersona(input.persona)) {
    return false
  }
  if (!Array.isArray(input.options) || input.options.length > MAX_SPARK_COMMAND_OPTIONS)
    return false

  let firstMessageLength = 0
  for (const [index, option] of input.options.entries()) {
    if (!isRecord(option)
      || !hasExactKeys(
        option,
        ['label', 'steps'],
        ['rationale', 'possibleOutcome', 'risk', 'fallback', 'triggers'],
      )
      || !isBoundedWireText(option.label)
      || !Array.isArray(option.steps)
      || option.steps.length > MAX_SPARK_COMMAND_STEPS
      || !option.steps.every(value => isBoundedWireText(value))
      || !isOptionalBoundedWireText(option.rationale)
      || !isOptionalBoundedWireTextList(option.possibleOutcome)
      || (option.risk !== undefined && !['high', 'medium', 'low', 'none'].includes(String(option.risk)))
      || !isOptionalBoundedWireTextList(option.fallback)
      || !isOptionalBoundedWireTextList(option.triggers)) {
      return false
    }
    if (index === 0) {
      const label = option.label.trim()
      firstMessageLength = label.length > 0
        ? option.label.length
        : option.steps.join(' / ').length
    }
  }
  return firstMessageLength <= MAX_SPARK_COMMAND_TEXT_LENGTH
}

function isSparkPersona(input: unknown): boolean {
  if (input === undefined)
    return true
  if (!isRecord(input) || Object.keys(input).length > MAX_SPARK_COMMAND_PERSONA_TRAITS)
    return false

  return Object.entries(input).every(([trait, strength]) =>
    isBoundedWireText(trait)
    && ['very-high', 'high', 'medium', 'low', 'very-low'].includes(String(strength)),
  )
}

function isSparkContexts(input: unknown): boolean {
  if (input === undefined)
    return true
  return Array.isArray(input)
    && input.length <= MAX_SPARK_COMMAND_CONTEXTS
    && input.every(isSparkContext)
}

function isSparkContext(input: unknown): boolean {
  return isRecord(input)
    && hasExactKeys(
      input,
      ['id', 'contextId', 'strategy', 'text'],
      ['lane', 'ideas', 'hints', 'content', 'destinations', 'metadata'],
    )
    && isIdentifier(input.id)
    && isIdentifier(input.contextId)
    && isOptionalBoundedWireText(input.lane)
    && isOptionalBoundedWireTextList(input.ideas)
    && isOptionalBoundedWireTextList(input.hints)
    && [ContextUpdateStrategy.ReplaceSelf, ContextUpdateStrategy.AppendSelf].includes(input.strategy as ContextUpdateStrategy)
    && isBoundedWireText(input.text, MAX_SPARK_COMMAND_CONTEXT_TEXT_LENGTH)
    && input.content === undefined
    && isOptionalSparkContextDestinations(input.destinations)
    && isOptionalSparkMetadata(input.metadata)
}

function isOptionalSparkContextDestinations(input: unknown): boolean {
  if (input === undefined)
    return true
  if (Array.isArray(input))
    return isSparkDestinationList(input)
  if (!isRecord(input))
    return false
  if (hasExactKeys(input, ['all']))
    return input.all === true
  return hasExactKeys(input, [], ['include', 'exclude'])
    && (input.include === undefined || isSparkDestinationList(input.include))
    && (input.exclude === undefined || isSparkDestinationList(input.exclude))
}

function isOptionalSparkMetadata(input: unknown): boolean {
  if (input === undefined)
    return true
  if (!isRecord(input) || Object.keys(input).length > MAX_SPARK_COMMAND_METADATA_ENTRIES)
    return false

  return Object.entries(input).every(([key, value]) =>
    isBoundedWireText(key)
    && (value === null
      || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
      || isBoundedWireText(value)),
  )
}

function isSparkDestinationList(input: unknown): input is string[] {
  return Array.isArray(input)
    && input.length <= MAX_SPARK_COMMAND_DESTINATIONS
    && input.every(value => isBoundedWireText(value) && value.length > 0)
}

function isOptionalBoundedWireText(input: unknown): input is string | undefined {
  return input === undefined || isBoundedWireText(input)
}

function isOptionalBoundedWireTextList(input: unknown): input is string[] | undefined {
  return input === undefined
    || (Array.isArray(input)
      && input.length <= MAX_SPARK_COMMAND_STEPS
      && input.every(value => isBoundedWireText(value)))
}

function isBoundedWireText(input: unknown, maxLength = MAX_SPARK_COMMAND_TEXT_LENGTH): input is string {
  return typeof input === 'string'
    && input.length <= maxLength
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input)
}

function isIdentifier(input: unknown): input is string {
  return typeof input === 'string' && /^[\w-][\w.:-]{0,159}$/u.test(input)
}

function isOptionalIdentifier(input: unknown): input is string | undefined {
  return input === undefined || isIdentifier(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype
}

function hasExactKeys(input: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => key in input) && Object.keys(input).every(key => allowed.has(key))
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function sparkDirectiveFingerprint(directive: SparkCommandDirective): string {
  return JSON.stringify([
    directive.intent,
    directive.interrupt ?? false,
    directive.priority ?? 'normal',
    directive.message,
  ])
}
