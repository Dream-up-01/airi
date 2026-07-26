import type {
  PerceptionRuntimeSourceKind,
  PerceptionRuntimeState,
  PerceptionRuntimeStatusWire,
} from '../../../shared/eventa/perception-runtime-status'

import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

import {
  parsePerceptionRuntimeStatusRequestWire,
  parsePerceptionRuntimeStatusWire,
  PERCEPTION_RUNTIME_STATUS_VERSION,
  perceptionRuntimeStatusChanged,
  perceptionRuntimeStatusRequested,
} from '../../../shared/eventa/perception-runtime-status'

const CHANNEL_NAME = 'airi:perception:runtime-status:v0.3'
const HEARTBEAT_INTERVAL_MS = 1000
const REMOTE_STATUS_TTL_MS = 3500
const MAX_FUTURE_SKEW_MS = 5000
const ACTIVE_STATES = new Set<PerceptionRuntimeState>(['starting', 'running', 'paused', 'stopping'])
const publisherId = `renderer:${crypto.randomUUID()}`

let channel: BroadcastChannel | undefined
let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined
let peerCount = 0

function getContext() {
  channel ??= new BroadcastChannel(CHANNEL_NAME)
  context ??= createBroadcastChannelContext(channel).context
  return context
}

export interface PerceptionRuntimeStatusPeerOptions {
  sourceKind: PerceptionRuntimeSourceKind
  initialState: PerceptionRuntimeState
  initialGeneration: number
  onRemoteStatuses: (statuses: readonly PerceptionRuntimeStatusWire[]) => void
  now?: () => number
}

export interface PerceptionRuntimeStatusPeer {
  publish: (state: PerceptionRuntimeState, generation: number) => void
  dispose: () => void
}

/**
 * Mirrors only bounded control-plane state between Electron renderers.
 * Raw media, source ids, facts, observations and provider output are never
 * accepted by this contract.
 */
export function createPerceptionRuntimeStatusPeer(options: PerceptionRuntimeStatusPeerOptions): PerceptionRuntimeStatusPeer {
  peerCount += 1
  const now = options.now ?? Date.now
  const remoteStatuses = new Map<string, PerceptionRuntimeStatusWire>()
  let localState = options.initialState
  let localGeneration = options.initialGeneration
  let disposed = false

  const stopStatusSubscription = getContext().on(perceptionRuntimeStatusChanged, (event) => {
    const status = parsePerceptionRuntimeStatusWire(event?.body)
    if (!status || status.publisherId === publisherId)
      return
    if (status.updatedAt > now() + MAX_FUTURE_SKEW_MS)
      return

    const key = `${status.publisherId}:${status.sourceKind}`
    if (!ACTIVE_STATES.has(status.state) || now() - status.updatedAt > REMOTE_STATUS_TTL_MS)
      remoteStatuses.delete(key)
    else
      remoteStatuses.set(key, status)
    publishRemoteSnapshot()
  })
  const stopRequestSubscription = getContext().on(perceptionRuntimeStatusRequested, (event) => {
    const request = parsePerceptionRuntimeStatusRequestWire(event?.body)
    if (!request || request.requesterId === publisherId)
      return
    publishLocal()
  })
  const maintenanceTimer = setInterval(() => {
    if (ACTIVE_STATES.has(localState))
      publishLocal()
    pruneRemoteStatuses()
  }, HEARTBEAT_INTERVAL_MS)

  publishLocal()
  getContext().emit(perceptionRuntimeStatusRequested, {
    contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
    requesterId: publisherId,
    requestedAt: now(),
  })

  return {
    publish(state, generation) {
      if (disposed)
        return
      localState = state
      localGeneration = generation
      publishLocal()
    },
    dispose() {
      if (disposed)
        return
      if (ACTIVE_STATES.has(localState)) {
        localState = 'stopped'
        publishLocal()
      }
      disposed = true
      clearInterval(maintenanceTimer)
      stopStatusSubscription()
      stopRequestSubscription()
      remoteStatuses.clear()
      options.onRemoteStatuses([])
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
    getContext().emit(perceptionRuntimeStatusChanged, {
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId,
      sourceKind: options.sourceKind,
      state: localState,
      generation: localGeneration,
      updatedAt: now(),
    })
  }

  function pruneRemoteStatuses(): void {
    const currentTime = now()
    let changed = false
    for (const [key, status] of remoteStatuses) {
      if (currentTime - status.updatedAt <= REMOTE_STATUS_TTL_MS)
        continue
      remoteStatuses.delete(key)
      changed = true
    }
    if (changed)
      publishRemoteSnapshot()
  }

  function publishRemoteSnapshot(): void {
    options.onRemoteStatuses(
      [...remoteStatuses.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    )
  }
}
