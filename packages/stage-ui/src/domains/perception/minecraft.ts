import type { MinecraftPerceptionWireEvent } from '@proj-airi/server-sdk'

import type { ObjectivePerceptionEvent, PerceptionEventType } from './contracts'

import { MINECRAFT_PERCEPTION_LANE, MINECRAFT_PERCEPTION_SCHEMA_VERSION } from '@proj-airi/server-sdk'
import {
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  picklist,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
} from 'valibot'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'
import { allowedPerceptionEnumValuesByCategory } from './policy'

export { MINECRAFT_PERCEPTION_LANE, MINECRAFT_PERCEPTION_SCHEMA_VERSION }
export type { MinecraftPerceptionWireEvent }
export const MINECRAFT_PERCEPTION_ADAPTER_ID = 'minecraft-structured-v1' as const

export interface MinecraftSourceIdentity {
  moduleId: string
  pluginId: string
  pluginVersion?: string
}

export interface MinecraftPerceptionAdapterOptions {
  sessionId: string
  generation: number
  sourceId: string
  expectedIdentity: MinecraftSourceIdentity
  now?: () => number
  maxPayloadBytes?: number
  maxPastSkewMs?: number
  maxFutureSkewMs?: number
  maxEventsPerSecond?: number
}

export type MinecraftPerceptionRejectionCode
  = | 'identity-mismatch'
    | 'invalid-schema'
    | 'payload-too-large'
    | 'timestamp-skew'
    | 'replay'
    | 'rate-limited'

export type MinecraftPerceptionAdapterResult
  = | { ok: true, event: ObjectivePerceptionEvent }
    | { ok: false, code: MinecraftPerceptionRejectionCode }

// NOTICE:
// Why: the replay guard below must stay bounded. The adapter is long lived (see
//   `bindRuntime` in `packages/stage-ui/src/stores/modules/gaming-minecraft.ts`, which
//   keeps the instance while the module identity is unchanged) and the provider emits
//   four fresh `nanoid()` ids every 5s
//   (`services/minecraft/src/airi/minecraft-context-service.ts`,
//   STATUS_REFRESH_INTERVAL_MS and the four signals in `publishSnapshot`).
// Root cause: `#seenEventIds` was append-only, so an idle Minecraft session grew the
//   set by ~69k strings per day inside the renderer process with no upper bound.
// Source: value and eviction policy mirror `MAX_SEEN_EVENT_IDS` in
//   `packages/stage-ui/src/domains/perception/state-manager.ts`, so both perception
//   replay guards keep the same window.
// Removal condition: drop once the wire protocol carries a provider-side replay window
//   that makes a receiver-side id set unnecessary.
const MAX_SEEN_EVENT_IDS = 1_024

const identifier = pipe(string(), minLength(1), maxLength(64), regex(/^[a-z0-9][\w.:-]*$/iu))
const wireEventSchema = strictObject({
  schemaVersion: literal(MINECRAFT_PERCEPTION_SCHEMA_VERSION),
  eventId: identifier,
  sequence: pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER)),
  observedAt: pipe(number(), integer(), minValue(0)),
  ttlMs: pipe(number(), integer(), minValue(5_000), maxValue(30_000)),
  eventType: picklist(['connection-health', 'player-status', 'task-state', 'nearby-threat']),
  phase: picklist(['started', 'updated', 'ended', 'observed']),
  value: pipe(string(), minLength(1), maxLength(32), regex(/^[a-z][a-z0-9-]*$/u)),
  confidence: pipe(number(), minValue(0), maxValue(1)),
})

const eventMapping: Readonly<Record<MinecraftPerceptionWireEvent['eventType'], {
  category: string
  eventType: PerceptionEventType
}>> = {
  'connection-health': { category: 'minecraft.health', eventType: 'minecraft.connection-health.changed' },
  'player-status': { category: 'minecraft.player', eventType: 'minecraft.player-status.observed' },
  'task-state': { category: 'minecraft.task', eventType: 'minecraft.task-state.observed' },
  'nearby-threat': { category: 'minecraft.threat', eventType: 'minecraft.nearby-threat.observed' },
}

/**
 * Strict boundary from an authenticated Minecraft module to objective events.
 * The adapter never forwards free text, commands, tools, or the original payload.
 */
export class MinecraftPerceptionAdapter {
  readonly #sessionId: string
  readonly #generation: number
  readonly #sourceId: string
  readonly #expectedIdentity: MinecraftSourceIdentity
  readonly #now: () => number
  readonly #maxPayloadBytes: number
  readonly #maxPastSkewMs: number
  readonly #maxFutureSkewMs: number
  readonly #maxEventsPerSecond: number
  readonly #seenEventIds = new Set<string>()
  #lastSequence = -1
  #acceptedAt: number[] = []

  constructor(options: MinecraftPerceptionAdapterOptions) {
    this.#sessionId = options.sessionId
    this.#generation = options.generation
    this.#sourceId = options.sourceId
    this.#expectedIdentity = { ...options.expectedIdentity }
    this.#now = options.now ?? (() => Date.now())
    this.#maxPayloadBytes = options.maxPayloadBytes ?? 4_096
    this.#maxPastSkewMs = options.maxPastSkewMs ?? 30_000
    this.#maxFutureSkewMs = options.maxFutureSkewMs ?? 5_000
    this.#maxEventsPerSecond = options.maxEventsPerSecond ?? 10
  }

  accept(identityInput: unknown, payloadInput: unknown): MinecraftPerceptionAdapterResult {
    const identity = normalizeMinecraftSourceIdentity(identityInput)
    if (!identity || !sameMinecraftIdentity(identity, this.#expectedIdentity))
      return { ok: false, code: 'identity-mismatch' }

    const payloadBytes = serializedByteLength(payloadInput)
    if (payloadBytes === undefined)
      return { ok: false, code: 'invalid-schema' }
    if (payloadBytes > this.#maxPayloadBytes)
      return { ok: false, code: 'payload-too-large' }

    const parsed = safeParse(wireEventSchema, payloadInput)
    if (!parsed.success)
      return { ok: false, code: 'invalid-schema' }

    const wire = parsed.output as MinecraftPerceptionWireEvent
    const mapping = eventMapping[wire.eventType]
    if (!allowedPerceptionEnumValuesByCategory[mapping.category]?.includes(wire.value))
      return { ok: false, code: 'invalid-schema' }

    const now = this.#now()
    if (now - wire.observedAt > this.#maxPastSkewMs || wire.observedAt - now > this.#maxFutureSkewMs)
      return { ok: false, code: 'timestamp-skew' }
    if (this.#seenEventIds.has(wire.eventId) || wire.sequence <= this.#lastSequence)
      return { ok: false, code: 'replay' }

    const cutoff = now - 1_000
    this.#acceptedAt = this.#acceptedAt.filter(timestamp => timestamp > cutoff)
    if (this.#acceptedAt.length >= this.#maxEventsPerSecond)
      return { ok: false, code: 'rate-limited' }

    this.#seenEventIds.add(wire.eventId)
    // FIFO eviction over the insertion-ordered set. Trade-off: an id older than the
    // most recent MAX_SEEN_EVENT_IDS accepted ids stops being recognised as a replay.
    // That is acceptable because `#lastSequence` still rejects every event whose
    // sequence is not strictly newer, so a genuine re-delivery of an old event is
    // caught regardless; only a forged reuse of an evicted id carrying a fresh
    // sequence can pass, and that carries no stale payload.
    while (this.#seenEventIds.size > MAX_SEEN_EVENT_IDS)
      this.#seenEventIds.delete(this.#seenEventIds.values().next().value!)
    this.#lastSequence = wire.sequence
    this.#acceptedAt.push(now)

    return {
      ok: true,
      event: {
        contractVersion: PERCEPTION_CONTRACT_VERSION,
        eventId: wire.eventId,
        observationId: `minecraft-observation:${wire.eventId}`,
        sessionId: this.#sessionId,
        generation: this.#generation,
        sourceKind: 'minecraft',
        sourceId: this.#sourceId,
        analyzers: [MINECRAFT_PERCEPTION_ADAPTER_ID],
        eventType: mapping.eventType,
        phase: wire.phase,
        subject: 'game-session',
        value: { kind: 'enum', value: wire.value },
        confidence: wire.confidence,
        observedAt: wire.observedAt,
        expiresAt: wire.observedAt + wire.ttlMs,
        verification: 'direct-signal',
        sensitivity: 'personal',
        provenance: {
          analyzerId: MINECRAFT_PERCEPTION_ADAPTER_ID,
          processing: 'local',
          adapterId: MINECRAFT_PERCEPTION_ADAPTER_ID,
        },
      },
    }
  }
}

export function normalizeMinecraftSourceIdentity(input: unknown): MinecraftSourceIdentity | undefined {
  if (!isRecord(input) || typeof input.id !== 'string' || !isIdentifier(input.id))
    return undefined

  const owner = input.kind === 'plugin' ? input.plugin : input.extension
  if (!isRecord(owner) || typeof owner.id !== 'string' || !isIdentifier(owner.id))
    return undefined
  if (owner.version !== undefined && (typeof owner.version !== 'string' || owner.version.length > 64))
    return undefined

  return {
    moduleId: input.id,
    pluginId: owner.id,
    pluginVersion: owner.version,
  }
}

function sameMinecraftIdentity(left: MinecraftSourceIdentity, right: MinecraftSourceIdentity): boolean {
  return left.moduleId === right.moduleId
    && left.pluginId === right.pluginId
    && left.pluginVersion === right.pluginVersion
}

function serializedByteLength(input: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(input)
    if (serialized === undefined)
      return undefined
    return new TextEncoder().encode(serialized).byteLength
  }
  catch {
    return undefined
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isIdentifier(input: string): boolean {
  return input.length > 0 && input.length <= 64 && /^[a-z0-9][\w.:-]*$/iu.test(input)
}
