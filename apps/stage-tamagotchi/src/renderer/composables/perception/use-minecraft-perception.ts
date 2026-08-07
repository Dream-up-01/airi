import type { PerceptionContextProjection, PerceptionOwnerHandle } from '@proj-airi/stage-ui/domains/perception'
import type { ComputedRef, InjectionKey } from 'vue'

import type { PerceptionRuntimeState, PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'
import type { MinecraftPerceptionControlRequestHandler } from '../../services/perception/perception-minecraft-control-sync'

import { provideMinecraftPerceptionControl } from '@proj-airi/stage-ui/composables/minecraftPerceptionControl'
import { createPerceptionContextMessage } from '@proj-airi/stage-ui/stores/chat/context-providers'
import { MINECRAFT_CONTEXT_ID } from '@proj-airi/stage-ui/stores/chat/context-providers/minecraft'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useMinecraftStore } from '@proj-airi/stage-ui/stores/modules/gaming-minecraft'
import { useTimeoutFn } from '@vueuse/core'
import { computed, inject, onScopeDispose, provide, shallowRef, watch } from 'vue'

import { createPerceptionContextProjectionPeer } from '../../services/perception/perception-context-projection-sync'
import { createMinecraftPerceptionControlPeer } from '../../services/perception/perception-minecraft-control-sync'
import { createPerceptionRuntimeStatusPeer } from '../../services/perception/perception-runtime-status-sync'
import { productionPerceptionOwnerProvider } from '../../services/perception/production-perception-owner'

export interface MinecraftPerceptionOptions {
  ownerEligible?: boolean
}

export interface MinecraftPerceptionContext {
  store: ReturnType<typeof useMinecraftStore>
  state: ComputedRef<'off' | 'waiting' | 'running' | 'paused' | 'failed'>
  remoteStatuses: ComputedRef<readonly PerceptionRuntimeStatusWire[]>
  hasRemoteOwner: ComputedRef<boolean>
  lastControlErrorCode: ComputedRef<string | undefined>
  start: (consentConfirmed: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
}

const minecraftPerceptionKey: InjectionKey<MinecraftPerceptionContext> = Symbol('minecraft-perception')

export function provideMinecraftPerception(options: MinecraftPerceptionOptions = {}): MinecraftPerceptionContext {
  const ownerEligible = options.ownerEligible ?? true
  const store = useMinecraftStore()
  const chatContext = useChatContextStore()
  const remoteStatuses = shallowRef<readonly PerceptionRuntimeStatusWire[]>([])
  const lastControlErrorCode = shallowRef<string>()
  const projectionDelay = shallowRef(0)
  const projectionExpiry = useTimeoutFn(() => chatContext.retractContextSource(MINECRAFT_CONTEXT_ID), projectionDelay, { immediate: false })
  let ownerHandle: PerceptionOwnerHandle | undefined
  let operation: Promise<void> | undefined

  store.initialize()

  const runtimeStatusPeer = createPerceptionRuntimeStatusPeer({
    sourceKind: 'minecraft',
    initialState: 'idle',
    initialGeneration: store.generation,
    onRemoteStatuses: next => remoteStatuses.value = next,
  })
  const projectionPeer = createPerceptionContextProjectionPeer({
    sourceKind: 'minecraft',
    onRemoteProjection: syncProjection,
  })
  const controlPeer = createMinecraftPerceptionControlPeer({
    onRequest: ownerEligible ? handleControlRequest : undefined,
  })

  const remoteMinecraftStatuses = computed(() => remoteStatuses.value.filter(status => status.sourceKind === 'minecraft'))

  const state = computed<'off' | 'waiting' | 'running' | 'paused' | 'failed'>(() => {
    if (store.perceptionEnabled) {
      if (lastControlErrorCode.value)
        return 'failed'
      if (store.perceptionPaused)
        return 'paused'
      return store.serviceConnected ? 'running' : 'waiting'
    }
    const remoteState = remoteMinecraftStatuses.value[0]?.state
    if (remoteState === 'paused')
      return 'paused'
    if (remoteState === 'starting' || remoteState === 'running')
      return 'running'
    if (lastControlErrorCode.value)
      return 'failed'
    return 'off'
  })

  watch([
    () => store.perceptionEnabled,
    () => store.perceptionPaused,
    () => store.generation,
    () => store.perceptionObservability,
  ], () => {
    if (store.perceptionEnabled && !store.perceptionPaused && !ownerHandle && !operation) {
      store.disablePerception()
      lastControlErrorCode.value = 'owner-required'
      return
    }
    if (!store.perceptionEnabled && ownerHandle && !operation)
      void releaseOwner()

    runtimeStatusPeer.publish(runtimeState(), store.generation)
    if (!ownerHandle) {
      projectionPeer.publish(null, store.generation)
      return
    }
    const projection = store.perceptionPaused ? null : store.getContextProjection()
    projectionPeer.publish(projection, store.generation)
    syncProjection(projection)
  }, { immediate: true })

  async function start(consentConfirmed: boolean): Promise<void> {
    if (!consentConfirmed) {
      lastControlErrorCode.value = 'permission-denied'
      return
    }
    if (!ownerEligible) {
      await requestRemoteControl('start', true)
      return
    }
    await runExclusive(async () => {
      if (remoteStatuses.value.length > 0) {
        lastControlErrorCode.value = 'owner-unavailable'
        return
      }
      ownerHandle = await productionPerceptionOwnerProvider.acquire('renderer:main')
      if (!ownerHandle) {
        lastControlErrorCode.value = 'owner-unavailable'
        return
      }
      lastControlErrorCode.value = undefined
      store.enablePerception()
    })
  }

  async function pause(): Promise<void> {
    if (!ownerEligible) {
      await requestRemoteControl('pause', false)
      return
    }
    await runExclusive(async () => {
      if (!ownerHandle || !store.perceptionEnabled || store.perceptionPaused)
        return
      store.pausePerception()
      projectionPeer.publish(null, store.generation)
      syncProjection(null)
      await releaseOwner()
    })
  }

  async function resume(): Promise<void> {
    if (!ownerEligible) {
      await requestRemoteControl('resume', false)
      return
    }
    await runExclusive(async () => {
      if (!store.perceptionEnabled || !store.perceptionPaused || remoteStatuses.value.length > 0)
        return
      ownerHandle = await productionPerceptionOwnerProvider.acquire('renderer:main')
      if (!ownerHandle) {
        lastControlErrorCode.value = 'owner-unavailable'
        return
      }
      lastControlErrorCode.value = undefined
      store.resumePerception()
    })
  }

  async function stop(): Promise<void> {
    if (!ownerEligible) {
      await requestRemoteControl('stop', false)
      return
    }
    await runExclusive(async () => {
      if (store.perceptionEnabled)
        store.disablePerception()
      projectionPeer.publish(null, store.generation)
      syncProjection(null)
      await releaseOwner()
      lastControlErrorCode.value = undefined
    })
  }

  function syncProjection(projection: PerceptionContextProjection | null): void {
    projectionExpiry.stop()
    if (!projection) {
      chatContext.retractContextSource(MINECRAFT_CONTEXT_ID)
      return
    }
    chatContext.ingestContextMessage(createPerceptionContextMessage(projection, MINECRAFT_CONTEXT_ID))
    projectionDelay.value = Math.max(0, projection.expiresAt - Date.now())
    projectionExpiry.start()
  }

  function runtimeState(): PerceptionRuntimeState {
    if (store.perceptionPaused)
      return 'paused'
    if (store.perceptionEnabled)
      return 'running'
    if (lastControlErrorCode.value)
      return 'failed'
    return 'idle'
  }

  async function releaseOwner(): Promise<void> {
    const handle = ownerHandle
    ownerHandle = undefined
    await handle?.release()
  }

  async function runExclusive(task: () => Promise<void>): Promise<void> {
    if (operation)
      return operation
    operation = task().finally(() => operation = undefined)
    return operation
  }

  async function requestRemoteControl(command: 'start' | 'pause' | 'resume' | 'stop', consentConfirmed: boolean): Promise<void> {
    try {
      const result = await controlPeer.request(command, consentConfirmed)
      lastControlErrorCode.value = result.errorCode
    }
    catch {
      lastControlErrorCode.value = 'owner-unavailable'
    }
  }

  async function handleControlRequest(
    request: Parameters<MinecraftPerceptionControlRequestHandler>[0],
    respond: Parameters<MinecraftPerceptionControlRequestHandler>[1],
  ): Promise<void> {
    if (!ownerEligible)
      return
    if (request.command === 'start' && !request.consentConfirmed) {
      respond({ state: 'failed', generation: store.generation, errorCode: 'permission-denied' })
      return
    }

    try {
      if (request.command === 'start')
        await start(true)
      else if (request.command === 'pause')
        await pause()
      else if (request.command === 'resume')
        await resume()
      else
        await stop()
      respond({ state: runtimeState(), generation: store.generation, ...(lastControlErrorCode.value ? { errorCode: lastControlErrorCode.value } : {}) })
    }
    catch {
      respond({ state: 'failed', generation: store.generation, errorCode: 'control-failed' })
    }
  }

  const context: MinecraftPerceptionContext = {
    store,
    state,
    remoteStatuses: computed(() => remoteStatuses.value),
    hasRemoteOwner: computed(() => remoteMinecraftStatuses.value.length > 0),
    lastControlErrorCode: computed(() => lastControlErrorCode.value),
    start,
    pause,
    resume,
    stop,
  }
  provide(minecraftPerceptionKey, context)
  provideMinecraftPerceptionControl({ start, pause, resume, stop })

  onScopeDispose(() => {
    projectionExpiry.stop()
    if (store.perceptionEnabled)
      store.disablePerception()
    projectionPeer.publish(null, store.generation)
    projectionPeer.dispose()
    controlPeer.dispose()
    runtimeStatusPeer.publish('stopped', store.generation)
    runtimeStatusPeer.dispose()
    chatContext.retractContextSource(MINECRAFT_CONTEXT_ID)
    store.dispose()
    void releaseOwner()
  })

  return context
}

export function useMinecraftPerception(): MinecraftPerceptionContext {
  const context = inject(minecraftPerceptionKey)
  if (!context)
    throw new Error('minecraft_perception_not_provided')
  return context
}
