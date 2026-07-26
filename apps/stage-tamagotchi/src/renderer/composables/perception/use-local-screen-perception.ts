import type { PerceptionContextProjection, PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'
import type { ComputedRef, InjectionKey } from 'vue'

import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'
import type {
  LocalScreenPerceptionStatus,
} from '../../services/perception/local-screen-perception-coordinator'
import type { ProductionScreenSource } from '../../services/perception/production-screen-capture'

import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { createPerceptionContextMessage, PERCEPTION_CONTEXT_SOURCE_ID } from '@proj-airi/stage-ui/stores/chat/context-providers'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { computed, inject, onScopeDispose, provide, shallowRef } from 'vue'

import { LocalScreenConsentClient } from '../../services/perception/local-screen-consent-client'
import { LocalScreenPerceptionCoordinator } from '../../services/perception/local-screen-perception-coordinator'
import { createPerceptionContextProjectionPeer } from '../../services/perception/perception-context-projection-sync'
import { createPerceptionRuntimeStatusPeer } from '../../services/perception/perception-runtime-status-sync'
import { productionPerceptionOwnerProvider } from '../../services/perception/production-perception-owner'
import { ProductionScreenCapture } from '../../services/perception/production-screen-capture'

export interface LocalScreenPerceptionContext {
  status: ComputedRef<LocalScreenPerceptionStatus>
  sources: ComputedRef<readonly ProductionScreenSource[]>
  isRefreshingSources: ComputedRef<boolean>
  uiErrorCode: ComputedRef<string | undefined>
  isCollecting: ComputedRef<boolean>
  remoteStatuses: ComputedRef<readonly PerceptionRuntimeStatusWire[]>
  hasRemoteOwner: ComputedRef<boolean>
  observability: ComputedRef<PerceptionObservabilitySnapshot | null>
  refreshSources: () => Promise<void>
  start: (sourceId: string, consentConfirmed: boolean) => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  setSensitiveSurfacePaused: (paused: boolean) => void
  confirmFact: (factId: string) => void
  retractFact: (factId: string) => void
  clearFacts: () => void
}

const localScreenPerceptionKey: InjectionKey<LocalScreenPerceptionContext> = Symbol('local-screen-perception')

export function provideLocalScreenPerception(): LocalScreenPerceptionContext {
  const chatContext = useChatContextStore()
  const speaking = useSpeakingStore()
  const voiceConversation = useVoiceConversationStore()
  const status = shallowRef<LocalScreenPerceptionStatus>({
    state: 'idle',
    generation: 0,
    acceptedFactCount: 0,
    captureAttemptCount: 0,
    acceptedFrameCount: 0,
    gateDroppedFrameCount: 0,
    analyzerReplacedFrameCount: 0,
    inferenceFactCount: 0,
    sensitiveSurfacePaused: false,
  })
  const sources = shallowRef<ProductionScreenSource[]>([])
  const isRefreshingSources = shallowRef(false)
  const uiErrorCode = shallowRef<string>()
  const observability = shallowRef<PerceptionObservabilitySnapshot | null>(null)
  const remoteStatuses = shallowRef<readonly PerceptionRuntimeStatusWire[]>([])
  let projectionExpiryTimer: ReturnType<typeof setTimeout> | undefined

  const runtimeStatusPeer = createPerceptionRuntimeStatusPeer({
    sourceKind: 'screen',
    initialState: status.value.state,
    initialGeneration: status.value.generation,
    onRemoteStatuses: next => remoteStatuses.value = next,
  })
  const projectionPeer = createPerceptionContextProjectionPeer({
    sourceKind: 'screen',
    onRemoteProjection: syncProjection,
  })

  function syncProjection(projection: PerceptionContextProjection | null): void {
    if (projectionExpiryTimer)
      clearTimeout(projectionExpiryTimer)
    projectionExpiryTimer = undefined

    if (!projection) {
      chatContext.retractContextSource(PERCEPTION_CONTEXT_SOURCE_ID)
      return
    }

    chatContext.ingestContextMessage(createPerceptionContextMessage(projection))
    projectionExpiryTimer = setTimeout(() => {
      chatContext.retractContextSource(PERCEPTION_CONTEXT_SOURCE_ID)
      projectionExpiryTimer = undefined
    }, Math.max(0, projection.expiresAt - Date.now()))
  }

  const coordinator = new LocalScreenPerceptionCoordinator({
    capture: new ProductionScreenCapture(),
    consent: new LocalScreenConsentClient(),
    ownerProvider: productionPerceptionOwnerProvider,
    isResourceConstrained: () => speaking.nowSpeaking || voiceConversation.isActive,
    onStatus: (next) => {
      status.value = next
      runtimeStatusPeer.publish(next.state, next.generation)
      if (next.lastErrorCode)
        uiErrorCode.value = next.lastErrorCode
    },
    onProjection: (projection) => {
      projectionPeer.publish(projection, status.value.generation)
      syncProjection(projection)
    },
    onObservability: next => observability.value = next,
  })
  const readonlyStatus = computed(() => status.value)
  const readonlySources = computed(() => sources.value as readonly ProductionScreenSource[])
  const readonlyRefreshingSources = computed(() => isRefreshingSources.value)
  const readonlyUiErrorCode = computed(() => uiErrorCode.value)
  const isCollecting = computed(() => status.value.state === 'starting' || status.value.state === 'running')
  const readonlyRemoteStatuses = computed(() => remoteStatuses.value)
  const readonlyObservability = computed(() => observability.value)

  async function refreshSources(): Promise<void> {
    if (isRefreshingSources.value)
      return
    isRefreshingSources.value = true
    uiErrorCode.value = undefined
    try {
      sources.value = await coordinator.listSources()
    }
    catch {
      uiErrorCode.value = 'source-list-failed'
      sources.value = []
    }
    finally {
      isRefreshingSources.value = false
    }
  }

  async function start(sourceId: string, consentConfirmed: boolean): Promise<void> {
    uiErrorCode.value = undefined
    const next = await coordinator.start({ sourceId, consentConfirmed })
    if (next.state === 'failed')
      uiErrorCode.value = next.lastErrorCode ?? 'screen-perception-failed'
  }

  async function pause(): Promise<void> {
    uiErrorCode.value = undefined
    await coordinator.pause()
  }

  async function stop(): Promise<void> {
    uiErrorCode.value = undefined
    await coordinator.stop()
  }

  function setSensitiveSurfacePaused(paused: boolean): void {
    coordinator.setSensitiveSurfacePaused(paused)
  }

  const context: LocalScreenPerceptionContext = {
    status: readonlyStatus,
    sources: readonlySources,
    isRefreshingSources: readonlyRefreshingSources,
    uiErrorCode: readonlyUiErrorCode,
    isCollecting,
    remoteStatuses: readonlyRemoteStatuses,
    hasRemoteOwner: computed(() => remoteStatuses.value.length > 0),
    observability: readonlyObservability,
    refreshSources,
    start,
    pause,
    stop,
    setSensitiveSurfacePaused,
    confirmFact: factId => coordinator.confirmFact(factId),
    retractFact: factId => coordinator.retractFact(factId),
    clearFacts: () => coordinator.clearFacts(),
  }
  provide(localScreenPerceptionKey, context)
  onScopeDispose(() => {
    if (projectionExpiryTimer)
      clearTimeout(projectionExpiryTimer)
    projectionPeer.dispose()
    runtimeStatusPeer.dispose()
    chatContext.retractContextSource(PERCEPTION_CONTEXT_SOURCE_ID)
    void coordinator.dispose()
  })
  return context
}

export function useLocalScreenPerception(): LocalScreenPerceptionContext {
  const context = inject(localScreenPerceptionKey)
  if (!context)
    throw new Error('local_screen_perception_not_provided')
  return context
}
