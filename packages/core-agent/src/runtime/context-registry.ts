import type { MetadataEventSource } from '@proj-airi/server-shared/types'

import type { ContextMessage } from '../types/chat'

const CONTEXT_UPDATE_REPLACE_SELF = 'replace-self'
const CONTEXT_UPDATE_APPEND_SELF = 'append-self'

interface EventSourcePayload {
  source?: string
  metadata?: { source?: MetadataEventSource }
}

/**
 * Stored context event with the registry bucket key resolved at ingest time.
 */
export interface ContextHistoryEntry extends ContextMessage {
  /** Stable source bucket key derived from metadata, source, or fallback. */
  sourceKey: string
}

/**
 * Observable result emitted when a context update mutates an active bucket.
 */
export interface ContextIngestResult {
  /** Stable source bucket key affected by the ingest. */
  sourceKey: string
  /** Registry mutation applied to the active bucket. */
  mutation: 'replace' | 'append'
  /** Number of active entries in the affected bucket after mutation. */
  entryCount: number
}

/** Result of explicitly removing one source bucket and its bounded history. */
export interface ContextRetractResult {
  sourceKey: string
  removedEntries: number
  removedHistoryEntries: number
}

/**
 * Mutable runtime registry for active context buckets and bounded ingest history.
 */
export interface ContextRegistry {
  /** Stores a context message and returns a mutation summary for known strategies. */
  ingest: (envelope: ContextMessage) => ContextIngestResult | undefined
  /** Removes one source bucket and any history retained for that source. */
  retract: (sourceKey: string) => ContextRetractResult
  /** Clears active context buckets and ingest history. */
  reset: () => void
  /** Returns a cloned active context bucket snapshot. */
  snapshot: () => Record<string, ContextMessage[]>
  /** Returns cloned active context buckets for callers that prefer explicit naming. */
  activeContexts: () => Record<string, ContextMessage[]>
  /** Returns cloned ingest history entries in chronological order. */
  contextHistory: () => ContextHistoryEntry[]
}

interface CreateContextRegistryOptions {
  /**
   * Maximum number of history records retained by the registry.
   *
   * @default 400
   */
  historyLimit?: number
  /**
   * Resolves a context message into a stable source bucket key.
   *
   * @default metadata extension/module key, then event source, then "unknown"
   */
  getSourceKey?: (event: EventSourcePayload, fallback?: string) => string
  /** Clock used to enforce optional per-message expiry before snapshots are returned. */
  now?: () => number
}

function formatMetadataSource(source?: MetadataEventSource) {
  if (!source)
    return undefined

  if ('extension' in source) {
    return `${source.extension.id}:${source.id}`
  }

  return source.id
}

function defaultGetSourceKey(event: EventSourcePayload, fallback = 'unknown') {
  return (
    formatMetadataSource(event.metadata?.source)
    ?? event.source
    ?? fallback
  )
}

/**
 * Creates a context registry that owns active buckets and bounded ingest history.
 *
 * Use when:
 * - Runtime contexts need replace-self or append-self bucket semantics.
 * - UI or transport layers need cloned snapshots without owning mutation policy.
 *
 * Expects:
 * - Context messages are structured-cloneable before they enter the registry.
 * - Unknown strategies should still be recorded in history for observability.
 *
 * Returns:
 * - A registry whose snapshots cannot mutate internal active bucket state.
 */
export function createContextRegistry(options: CreateContextRegistryOptions = {}): ContextRegistry {
  const historyLimit = options.historyLimit ?? 400
  const getSourceKey = options.getSourceKey ?? defaultGetSourceKey
  const now = options.now ?? Date.now

  let currentActiveContexts = new Map<string, ContextMessage[]>()
  let currentContextHistory: ContextHistoryEntry[] = []

  function isExpired(message: ContextMessage, timestamp: number) {
    return message.expiresAt !== undefined && message.expiresAt <= timestamp
  }

  function pruneExpired(timestamp = now()) {
    for (const [sourceKey, messages] of currentActiveContexts) {
      const fresh = messages.filter(message => !isExpired(message, timestamp))
      if (fresh.length > 0)
        currentActiveContexts.set(sourceKey, fresh)
      else if (messages.length > 0)
        currentActiveContexts.delete(sourceKey)
    }
    currentContextHistory = currentContextHistory.filter(message => !isExpired(message, timestamp))
  }

  function ingest(envelope: ContextMessage): ContextIngestResult | undefined {
    const sourceKey = getSourceKey(envelope)
    const safeEnvelopeToStore = structuredClone(envelope)
    const timestamp = now()
    pruneExpired(timestamp)
    if (isExpired(safeEnvelopeToStore, timestamp))
      return undefined

    if (!currentActiveContexts.has(sourceKey)) {
      currentActiveContexts.set(sourceKey, [])
    }

    let result: ContextIngestResult | undefined

    if (envelope.strategy === CONTEXT_UPDATE_REPLACE_SELF) {
      currentActiveContexts.set(sourceKey, [safeEnvelopeToStore])
      result = {
        sourceKey,
        mutation: 'replace',
        entryCount: currentActiveContexts.get(sourceKey)?.length ?? 0,
      }
    }
    else if (envelope.strategy === CONTEXT_UPDATE_APPEND_SELF) {
      currentActiveContexts.get(sourceKey)?.push(safeEnvelopeToStore)
      result = {
        sourceKey,
        mutation: 'append',
        entryCount: currentActiveContexts.get(sourceKey)?.length ?? 0,
      }
    }

    currentContextHistory = [
      ...currentContextHistory,
      {
        ...safeEnvelopeToStore,
        sourceKey,
      },
    ].slice(-historyLimit)

    return result
  }

  function retract(sourceKey: string): ContextRetractResult {
    const removedEntries = currentActiveContexts.get(sourceKey)?.length ?? 0
    const historyBefore = currentContextHistory.length
    currentActiveContexts.delete(sourceKey)
    currentContextHistory = currentContextHistory.filter(message => message.sourceKey !== sourceKey)
    return {
      sourceKey,
      removedEntries,
      removedHistoryEntries: historyBefore - currentContextHistory.length,
    }
  }

  function reset() {
    currentActiveContexts = new Map<string, ContextMessage[]>()
    currentContextHistory = []
  }

  function snapshot() {
    pruneExpired()
    return Object.fromEntries(
      Array.from(currentActiveContexts, ([sourceKey, messages]) => [
        sourceKey,
        structuredClone(messages),
      ]),
    )
  }

  return {
    ingest,
    retract,
    reset,
    snapshot,
    activeContexts: snapshot,
    contextHistory: () => {
      pruneExpired()
      return structuredClone(currentContextHistory)
    },
  }
}
