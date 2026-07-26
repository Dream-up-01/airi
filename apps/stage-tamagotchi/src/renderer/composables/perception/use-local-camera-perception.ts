import type { PerceptionContextProjection, PerceptionObservabilitySnapshot } from '@proj-airi/stage-ui/domains/perception'
import type { ComputedRef, InjectionKey } from 'vue'

import type { PerceptionRuntimeStatusWire } from '../../../shared/eventa/perception-runtime-status'
import type { LocalCameraPerceptionStatus } from '../../services/perception/local-camera-perception-coordinator'
import type { ProductionCameraFrame } from '../../services/perception/production-camera-capture'

import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { createPerceptionContextMessage } from '@proj-airi/stage-ui/stores/chat/context-providers'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useVoiceConversationStore } from '@proj-airi/stage-ui/stores/voiceConversation'
import { useTimeoutFn } from '@vueuse/core'
import { computed, inject, onScopeDispose, provide, shallowRef } from 'vue'

import { LocalCameraPerceptionCoordinator } from '../../services/perception/local-camera-perception-coordinator'
import { createPerceptionContextProjectionPeer } from '../../services/perception/perception-context-projection-sync'
import { createPerceptionRuntimeStatusPeer } from '../../services/perception/perception-runtime-status-sync'
import { ProductionCameraCapture } from '../../services/perception/production-camera-capture'
import { productionPerceptionOwnerProvider } from '../../services/perception/production-perception-owner'

const CAMERA_CONTEXT_SOURCE_ID = 'system:trusted-perception:camera'

export interface LocalCameraPerceptionContext {
  status: ComputedRef<LocalCameraPerceptionStatus>
  isCollecting: ComputedRef<boolean>
  remoteStatuses: ComputedRef<readonly PerceptionRuntimeStatusWire[]>
  hasRemoteOwner: ComputedRef<boolean>
  observability: ComputedRef<PerceptionObservabilitySnapshot | null>
  start: (consentConfirmed: boolean) => Promise<void>
  startMixed: (consentConfirmed: boolean) => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  confirmFact: (factId: string) => void
  retractFact: (factId: string) => void
  clearFacts: () => void
  subscribeFrames: (listener: (frame: ProductionCameraFrame) => void) => () => void
}

const localCameraPerceptionKey: InjectionKey<LocalCameraPerceptionContext> = Symbol('local-camera-perception')

export function provideLocalCameraPerception(): LocalCameraPerceptionContext {
  const chatContext = useChatContextStore()
  const speaking = useSpeakingStore()
  const voiceConversation = useVoiceConversationStore()
  const status = shallowRef<LocalCameraPerceptionStatus>({
    state: 'idle',
    generation: 0,
    acceptedFactCount: 0,
    observationCount: 0,
    droppedFrameCount: 0,
    analyzers: { mediapipe: 'stopped', opencv: 'stopped', yolo: 'stopped' },
    analyzerErrorCodes: {},
  })
  const projectionDelay = shallowRef(0)
  const observability = shallowRef<PerceptionObservabilitySnapshot | null>(null)
  const remoteStatuses = shallowRef<readonly PerceptionRuntimeStatusWire[]>([])
  const projectionExpiry = useTimeoutFn(() => {
    chatContext.retractContextSource(CAMERA_CONTEXT_SOURCE_ID)
  }, projectionDelay, { immediate: false })
  const frameSubscribers = new Set<(frame: ProductionCameraFrame) => void>()

  const runtimeStatusPeer = createPerceptionRuntimeStatusPeer({
    sourceKind: 'camera',
    initialState: status.value.state,
    initialGeneration: status.value.generation,
    onRemoteStatuses: next => remoteStatuses.value = next,
  })

  function syncProjection(projection: PerceptionContextProjection | null): void {
    projectionExpiry.stop()
    if (!projection) {
      chatContext.retractContextSource(CAMERA_CONTEXT_SOURCE_ID)
      return
    }
    chatContext.ingestContextMessage(createPerceptionContextMessage(projection, CAMERA_CONTEXT_SOURCE_ID))
    projectionDelay.value = Math.max(0, projection.expiresAt - Date.now())
    projectionExpiry.start()
  }

  const projectionPeer = createPerceptionContextProjectionPeer({
    sourceKind: 'camera',
    onRemoteProjection: syncProjection,
  })

  const coordinator = new LocalCameraPerceptionCoordinator({
    capture: new ProductionCameraCapture(),
    ownerProvider: productionPerceptionOwnerProvider,
    isResourceConstrained: () => speaking.nowSpeaking || voiceConversation.isActive,
    onStatus: (next) => {
      status.value = next
      runtimeStatusPeer.publish(next.state, next.generation)
    },
    onObservability: next => observability.value = next,
    onProjection: (projection) => {
      projectionPeer.publish(projection, status.value.generation)
      syncProjection(projection)
    },
    onFrame: frame => frameSubscribers.forEach(listener => listener(frame)),
  })

  const context: LocalCameraPerceptionContext = {
    status: computed(() => status.value),
    isCollecting: computed(() => ['starting', 'running'].includes(status.value.state)),
    remoteStatuses: computed(() => remoteStatuses.value),
    hasRemoteOwner: computed(() => remoteStatuses.value.length > 0),
    observability: computed(() => observability.value),
    async start(consentConfirmed) {
      await coordinator.start(consentConfirmed)
    },
    async startMixed(consentConfirmed) {
      await coordinator.start(consentConfirmed, 'mixed')
    },
    async pause() {
      await coordinator.pause()
    },
    async stop() {
      await coordinator.stop()
    },
    confirmFact: factId => coordinator.confirmFact(factId),
    retractFact: factId => coordinator.retractFact(factId),
    clearFacts: () => coordinator.clearFacts(),
    subscribeFrames(listener) {
      frameSubscribers.add(listener)
      return () => frameSubscribers.delete(listener)
    },
  }
  provide(localCameraPerceptionKey, context)
  onScopeDispose(() => {
    projectionExpiry.stop()
    projectionPeer.dispose()
    runtimeStatusPeer.dispose()
    chatContext.retractContextSource(CAMERA_CONTEXT_SOURCE_ID)
    frameSubscribers.clear()
    void coordinator.dispose()
  })
  return context
}

export function useLocalCameraPerception(): LocalCameraPerceptionContext {
  const context = inject(localCameraPerceptionKey)
  if (!context)
    throw new Error('local_camera_perception_not_provided')
  return context
}
