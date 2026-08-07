import type {
  MinecraftPerceptionControlCommand,
  MinecraftPerceptionControlRequestWire,
  MinecraftPerceptionControlResultWire,
} from '../../../shared/eventa/perception-minecraft-control'
import type { PerceptionRuntimeState } from '../../../shared/eventa/perception-runtime-status'

import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

import {
  parseMinecraftPerceptionControlRequest,
  parseMinecraftPerceptionControlResult,
  PERCEPTION_MINECRAFT_CONTROL_VERSION,
  perceptionMinecraftControlRequested,
  perceptionMinecraftControlResult,
} from '../../../shared/eventa/perception-minecraft-control'

const CHANNEL_NAME = 'airi:perception:minecraft-control:v0.1'
const REQUEST_TIMEOUT_MS = 2_000
const publisherId = `renderer:${crypto.randomUUID()}`

let channel: BroadcastChannel | undefined
let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined
let peerCount = 0

function getContext() {
  channel ??= new BroadcastChannel(CHANNEL_NAME)
  context ??= createBroadcastChannelContext(channel).context
  return context
}

export interface MinecraftPerceptionControlRequestHandler {
  (request: MinecraftPerceptionControlRequestWire, respond: (result: MinecraftPerceptionControlResultInput) => void): void | Promise<void>
}

export interface MinecraftPerceptionControlResultInput {
  state: PerceptionRuntimeState
  generation: number
  errorCode?: string
}

export interface MinecraftPerceptionControlPeerOptions {
  onRequest?: MinecraftPerceptionControlRequestHandler
  now?: () => number
  requestTimeoutMs?: number
}

export interface MinecraftPerceptionControlPeer {
  request: (command: MinecraftPerceptionControlCommand, consentConfirmed: boolean) => Promise<MinecraftPerceptionControlResultWire>
  dispose: () => void
}

/** Coordinates consented Minecraft controls between the settings and main renderers. */
export function createMinecraftPerceptionControlPeer(options: MinecraftPerceptionControlPeerOptions = {}): MinecraftPerceptionControlPeer {
  peerCount += 1
  const now = options.now ?? Date.now
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const pending = new Map<string, { resolve: (result: MinecraftPerceptionControlResultWire) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  let disposed = false

  const stopRequestSubscription = getContext().on(perceptionMinecraftControlRequested, (event) => {
    const request = parseMinecraftPerceptionControlRequest(event?.body)
    if (!request || request.requesterId === publisherId || !options.onRequest || disposed)
      return

    const respond = (result: MinecraftPerceptionControlResultInput): void => {
      if (disposed)
        return
      const response: MinecraftPerceptionControlResultWire = {
        contractVersion: PERCEPTION_MINECRAFT_CONTROL_VERSION,
        requesterId: request.requesterId,
        responderId: publisherId,
        requestId: request.requestId,
        state: result.state,
        generation: result.generation,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        respondedAt: now(),
      }
      getContext().emit(perceptionMinecraftControlResult, response)
    }

    void options.onRequest(request, respond)
  })

  const stopResultSubscription = getContext().on(perceptionMinecraftControlResult, (event) => {
    const result = parseMinecraftPerceptionControlResult(event?.body)
    if (!result || result.requesterId !== publisherId || disposed)
      return
    const entry = pending.get(result.requestId)
    if (!entry)
      return
    pending.delete(result.requestId)
    clearTimeout(entry.timer)
    entry.resolve(result)
  })

  return {
    request(command, consentConfirmed) {
      if (disposed)
        return Promise.reject(new Error('minecraft_control_peer_disposed'))

      const requestId = `minecraft-control:${crypto.randomUUID()}`
      const request: MinecraftPerceptionControlRequestWire = {
        contractVersion: PERCEPTION_MINECRAFT_CONTROL_VERSION,
        requesterId: publisherId,
        requestId,
        command,
        consentConfirmed,
        requestedAt: now(),
      }

      return new Promise<MinecraftPerceptionControlResultWire>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error('minecraft_control_owner_timeout'))
        }, requestTimeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        getContext().emit(perceptionMinecraftControlRequested, request)
      })
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      stopRequestSubscription()
      stopResultSubscription()
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('minecraft_control_peer_disposed'))
      }
      pending.clear()
      peerCount -= 1
      if (peerCount === 0) {
        const closingChannel = channel
        channel = undefined
        context = undefined
        closingChannel?.close()
      }
    },
  }
}
