import type { PerceptionContextProjection, PerceptionSourceKind } from '@proj-airi/stage-ui/domains/perception'

import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

import {
  parsePerceptionContextProjectionRequestWire,
  parsePerceptionContextProjectionWire,
  PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION,
  perceptionContextProjectionChanged,
  perceptionContextProjectionRequested,
} from '../../../shared/eventa/perception-context-projection'

const CHANNEL_NAME = 'airi:perception:context-projection:v0.3'
const MAINTENANCE_INTERVAL_MS = 1_000
const MAX_FUTURE_SKEW_MS = 5_000
const publisherId = `renderer:${crypto.randomUUID()}`

let channel: BroadcastChannel | undefined
let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined
let peerCount = 0

function getContext() {
  channel ??= new BroadcastChannel(CHANNEL_NAME)
  context ??= createBroadcastChannelContext(channel).context
  return context
}

export interface PerceptionContextProjectionPeerOptions {
  sourceKind: PerceptionSourceKind
  onRemoteProjection: (projection: PerceptionContextProjection | null) => void
  now?: () => number
}

export interface PerceptionContextProjectionPeer {
  publish: (projection: PerceptionContextProjection | null, generation: number) => void
  dispose: () => void
}

/** Shares only strict, fixed-template context projections between renderers. */
export function createPerceptionContextProjectionPeer(options: PerceptionContextProjectionPeerOptions): PerceptionContextProjectionPeer {
  peerCount += 1
  const now = options.now ?? Date.now
  const remote = new Map<string, { projection: PerceptionContextProjection, updatedAt: number }>()
  let localProjection: PerceptionContextProjection | null = null
  let localGeneration = 0
  let disposed = false

  const stopProjectionSubscription = getContext().on(perceptionContextProjectionChanged, (event) => {
    const update = parsePerceptionContextProjectionWire(event?.body)
    if (!update
      || update.publisherId === publisherId
      || update.sourceKind !== options.sourceKind
      || update.updatedAt > now() + MAX_FUTURE_SKEW_MS) {
      return
    }

    if (!update.projection || update.projection.expiresAt <= now())
      remote.delete(update.publisherId)
    else
      remote.set(update.publisherId, { projection: update.projection, updatedAt: update.updatedAt })
    publishRemoteProjection()
  })

  const stopRequestSubscription = getContext().on(perceptionContextProjectionRequested, (event) => {
    const request = parsePerceptionContextProjectionRequestWire(event?.body)
    if (!request || request.requesterId === publisherId || request.sourceKind !== options.sourceKind)
      return
    publishLocal()
  })

  const maintenanceTimer = setInterval(() => {
    let changed = false
    for (const [remotePublisherId, entry] of remote) {
      if (entry.projection.expiresAt > now())
        continue
      remote.delete(remotePublisherId)
      changed = true
    }
    if (changed)
      publishRemoteProjection()
  }, MAINTENANCE_INTERVAL_MS)

  getContext().emit(perceptionContextProjectionRequested, {
    contractVersion: PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION,
    requesterId: publisherId,
    sourceKind: options.sourceKind,
    requestedAt: now(),
  })

  return {
    publish(projection, generation) {
      if (disposed)
        return
      localProjection = projection
      localGeneration = generation
      publishLocal()
    },
    dispose() {
      if (disposed)
        return
      localProjection = null
      publishLocal()
      disposed = true
      clearInterval(maintenanceTimer)
      stopProjectionSubscription()
      stopRequestSubscription()
      remote.clear()
      options.onRemoteProjection(null)
      peerCount -= 1
      if (peerCount === 0) {
        const closingChannel = channel
        channel = undefined
        context = undefined
        closingChannel?.close()
      }
    },
  }

  function publishLocal(): void {
    getContext().emit(perceptionContextProjectionChanged, {
      contractVersion: PERCEPTION_CONTEXT_PROJECTION_WIRE_VERSION,
      publisherId,
      sourceKind: options.sourceKind,
      generation: localGeneration,
      updatedAt: now(),
      projection: localProjection,
    })
  }

  function publishRemoteProjection(): void {
    const latest = [...remote.values()]
      .filter(entry => entry.projection.expiresAt > now())
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    options.onRemoteProjection(latest?.projection ?? null)
  }
}
