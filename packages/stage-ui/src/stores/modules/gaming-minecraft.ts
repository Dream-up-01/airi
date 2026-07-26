import type { MetadataEventSource, WebSocketBaseEvent, WebSocketEvents } from '@proj-airi/server-sdk'

import type {
  MinecraftPerceptionRejectionCode,
  MinecraftSourceIdentity,
  PerceptionConsentGrant,
  PerceptionContextProjection,
  PerceptionObservabilitySnapshot,
} from '../../domains/perception'

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import {
  createPerceptionContextProjection,
  createPerceptionObservabilitySnapshot,
  MINECRAFT_PERCEPTION_LANE,
  MinecraftPerceptionAdapter,
  normalizeMinecraftSourceIdentity,
  PERCEPTION_CONTRACT_VERSION,
  PerceptionStateManager,
} from '../../domains/perception'
import { PerceptionDownstreamPolicyController } from '../../services/perception/downstream-policy-controller'
import { getMetadataSourceLabel } from '../../utils/event-source'
import { useModsServerChannelStore } from '../mods/api/channel-server'

export interface MinecraftTrafficEntry {
  id: string
  type: 'context:update' | 'spark:command'
  summary: string
  source: string
  receivedAt: number
  outcome: 'accepted' | 'rejected' | 'ignored'
}

const RUNTIME_CONTEXT_TICK_MS = 1_000
const MAX_TRAFFIC_ENTRIES = 50
const MINECRAFT_SERVICE_NAME = 'minecraft-bot'
const MINECRAFT_SESSION_ID = 'minecraft-session'
const MINECRAFT_FACT_CATEGORIES = [
  'minecraft.health',
  'minecraft.player',
  'minecraft.task',
  'minecraft.threat',
]

function getEventSourceLabel(event: { metadata?: { source?: MetadataEventSource } }) {
  return getMetadataSourceLabel(event.metadata?.source) ?? 'unknown'
}

function isMinecraftModuleEntry(value: { name?: string, identity?: MetadataEventSource }) {
  return value.name === MINECRAFT_SERVICE_NAME && normalizeMinecraftSourceIdentity(value.identity) !== undefined
}

function sameIdentity(left: MinecraftSourceIdentity | undefined, right: MinecraftSourceIdentity | undefined) {
  return left?.moduleId === right?.moduleId
    && left?.pluginId === right?.pluginId
    && left?.pluginVersion === right?.pluginVersion
}

export const useMinecraftStore = defineStore('minecraft', () => {
  const serverChannelStore = useModsServerChannelStore()

  const lastRuntimeContextAt = ref(0)
  const trafficEntries = ref<MinecraftTrafficEntry[]>([])
  const initialized = ref(false)
  const now = ref(Date.now())
  const servicePresent = ref(false)
  const serviceHealthy = ref(false)
  const providerConflict = ref(false)
  const perceptionEnabled = ref(false)
  const perceptionPaused = ref(false)
  const generation = ref(0)
  const rejectedEventCount = ref(0)
  const suppressedEventCount = ref(0)
  const lastRejectionCode = ref<MinecraftPerceptionRejectionCode | 'perception-disabled' | 'perception-paused' | 'source-unhealthy' | 'minecraft-provider-conflict'>()
  const perceptionObservability = shallowRef<PerceptionObservabilitySnapshot | null>(null)
  const activeProjection = shallowRef<PerceptionContextProjection | null>(null)

  const stateManager = new PerceptionStateManager({
    sessionId: MINECRAFT_SESSION_ID,
    generation: generation.value,
    maxEventsPerSourcePerSecond: 10,
  })
  const downstreamPolicy = new PerceptionDownstreamPolicyController()

  let registeredIdentity: MetadataEventSource | undefined
  let normalizedIdentity: MinecraftSourceIdentity | undefined
  let activeSourceId: string | undefined
  let adapter: MinecraftPerceptionAdapter | undefined
  let consentGrant: PerceptionConsentGrant | undefined
  let disposeContextUpdate: (() => void) | null = null
  let disposeSparkCommand: (() => void) | null = null
  let disposeRegistrySync: (() => void) | null = null
  let disposeRegistryHealthy: (() => void) | null = null
  let disposeRegistryUnhealthy: (() => void) | null = null
  let disposeModuleDeAnnounced: (() => void) | null = null
  let runtimeTickTimer: ReturnType<typeof setInterval> | null = null
  let trafficSequence = 0

  const serviceConnected = computed(() => servicePresent.value && serviceHealthy.value)
  const hasObservedRuntime = computed(() => servicePresent.value || lastRuntimeContextAt.value > 0)
  const runtimeContextAgeMs = computed(() => lastRuntimeContextAt.value ? Math.max(0, now.value - lastRuntimeContextAt.value) : 0)
  const configured = computed(() => hasObservedRuntime.value)
  const acceptedFactCount = computed(() => perceptionObservability.value?.counts.accepted ?? 0)

  function pushTrafficEntry(entry: Omit<MinecraftTrafficEntry, 'id'>) {
    trafficSequence += 1
    trafficEntries.value.push({ id: String(trafficSequence), ...entry })
    if (trafficEntries.value.length > MAX_TRAFFIC_ENTRIES)
      trafficEntries.value.splice(0, trafficEntries.value.length - MAX_TRAFFIC_ENTRIES)
  }

  function advanceGeneration() {
    generation.value += 1
    stateManager.setGeneration(MINECRAFT_SESSION_ID, generation.value)
    downstreamPolicy.cancelAll(stateManager)
  }

  function createGrant(sourceId: string): PerceptionConsentGrant {
    return {
      contractVersion: PERCEPTION_CONTRACT_VERSION,
      grantId: `grant:${sourceId}:${generation.value}`,
      sourceKind: 'minecraft',
      sourceId,
      processingMode: 'local-only',
      allowedModalities: ['game-events'],
      allowedFactCategories: [...MINECRAFT_FACT_CATEGORIES],
      grantedAt: Date.now(),
      showPersistentIndicator: true,
    }
  }

  function refreshSafeState() {
    downstreamPolicy.evaluate(stateManager)
    const snapshot = stateManager.snapshot('until-expiry')
    const facts = stateManager.listFacts()
    perceptionObservability.value = createPerceptionObservabilitySnapshot({ snapshot, facts })
    activeProjection.value = perceptionEnabled.value
      ? createPerceptionContextProjection({ facts, snapshot, now: now.value })
      : null
  }

  function bindRuntime(identity: MetadataEventSource, force = false) {
    const normalized = normalizeMinecraftSourceIdentity(identity)
    if (!normalized)
      return

    const changed = !sameIdentity(normalizedIdentity, normalized)
    registeredIdentity = identity
    normalizedIdentity = normalized
    if (!perceptionEnabled.value || perceptionPaused.value || (!changed && adapter && !force))
      return

    advanceGeneration()
    activeSourceId = `minecraft:${normalized.moduleId}`
    consentGrant = createGrant(activeSourceId)
    adapter = new MinecraftPerceptionAdapter({
      sessionId: MINECRAFT_SESSION_ID,
      generation: generation.value,
      sourceId: activeSourceId,
      expectedIdentity: normalized,
    })
    stateManager.setSourceHealth({
      sourceId: activeSourceId,
      sourceKind: 'minecraft',
      status: serviceHealthy.value ? 'healthy' : 'degraded',
      updatedAt: Date.now(),
    })
    refreshSafeState()
  }

  function deactivateRuntime(status: 'failed' | 'stopped') {
    const hadActiveRuntime = !!adapter || !!consentGrant || !!activeSourceId
    if (activeSourceId) {
      stateManager.setSourceHealth({
        sourceId: activeSourceId,
        sourceKind: 'minecraft',
        status,
        updatedAt: Date.now(),
      })
    }
    if (perceptionEnabled.value && hadActiveRuntime)
      advanceGeneration()
    adapter = undefined
    consentGrant = undefined
    activeSourceId = undefined
    activeProjection.value = null
    refreshSafeState()
  }

  function enablePerception() {
    if (perceptionEnabled.value)
      return
    perceptionEnabled.value = true
    perceptionPaused.value = false
    lastRejectionCode.value = undefined
    if (registeredIdentity)
      bindRuntime(registeredIdentity, true)
    else
      refreshSafeState()
  }

  function disablePerception() {
    if (!perceptionEnabled.value)
      return
    perceptionEnabled.value = false
    perceptionPaused.value = false
    advanceGeneration()
    adapter = undefined
    consentGrant = undefined
    activeSourceId = undefined
    activeProjection.value = null
    refreshSafeState()
  }

  function pausePerception() {
    if (!perceptionEnabled.value || perceptionPaused.value)
      return

    perceptionPaused.value = true
    advanceGeneration()
    if (activeSourceId) {
      stateManager.setSourceHealth({
        sourceId: activeSourceId,
        sourceKind: 'minecraft',
        status: 'stopped',
        updatedAt: Date.now(),
      })
    }
    adapter = undefined
    consentGrant = undefined
    activeSourceId = undefined
    activeProjection.value = null
    refreshSafeState()
  }

  function resumePerception() {
    if (!perceptionEnabled.value || !perceptionPaused.value)
      return

    perceptionPaused.value = false
    lastRejectionCode.value = undefined
    if (registeredIdentity)
      bindRuntime(registeredIdentity, true)
    else
      refreshSafeState()
  }

  function confirmFact(factId: string) {
    if (!stateManager.confirmFact(factId))
      return
    refreshSafeState()
  }

  function retractFact(factId: string) {
    if (!stateManager.retractFact(factId))
      return
    refreshSafeState()
  }

  function clearFacts() {
    stateManager.revokeAll('user-retracted')
    refreshSafeState()
  }

  function handleRuntimeContextUpdate(event: WebSocketBaseEvent<'context:update', WebSocketEvents['context:update']>) {
    if (event.data.lane !== MINECRAFT_PERCEPTION_LANE) {
      if (sameIdentity(normalizeMinecraftSourceIdentity(event.metadata?.source), normalizedIdentity)) {
        pushTrafficEntry({
          type: 'context:update',
          summary: 'unstructured-context-ignored',
          source: getEventSourceLabel(event),
          receivedAt: Date.now(),
          outcome: 'ignored',
        })
      }
      return
    }

    if (providerConflict.value) {
      rejectedEventCount.value += 1
      lastRejectionCode.value = 'minecraft-provider-conflict'
      return
    }

    if (perceptionPaused.value) {
      rejectedEventCount.value += 1
      lastRejectionCode.value = 'perception-paused'
      return
    }
    if (!perceptionEnabled.value || !adapter || !consentGrant) {
      rejectedEventCount.value += 1
      lastRejectionCode.value = 'perception-disabled'
      return
    }
    if (!serviceHealthy.value) {
      rejectedEventCount.value += 1
      lastRejectionCode.value = 'source-unhealthy'
      return
    }

    const result = adapter.accept(event.metadata?.source, event.data.content)
    if (!result.ok) {
      rejectedEventCount.value += 1
      lastRejectionCode.value = result.code
      pushTrafficEntry({
        type: 'context:update',
        summary: `rejected:${result.code}`,
        source: getEventSourceLabel(event),
        receivedAt: Date.now(),
        outcome: 'rejected',
      })
      return
    }

    const ingest = stateManager.ingest(result.event, { consentGrant, sourceHealthy: true })
    lastRuntimeContextAt.value = Date.now()
    if (!ingest.ok) {
      suppressedEventCount.value += 1
      pushTrafficEntry({
        type: 'context:update',
        summary: `suppressed:${ingest.reason}`,
        source: getEventSourceLabel(event),
        receivedAt: Date.now(),
        outcome: 'rejected',
      })
    }
    else {
      pushTrafficEntry({
        type: 'context:update',
        summary: `${result.event.eventType}:${ingest.outcome}`,
        source: getEventSourceLabel(event),
        receivedAt: Date.now(),
        outcome: 'accepted',
      })
    }
    refreshSafeState()
  }

  function handleRegistrySync(event: WebSocketBaseEvent<'registry:modules:sync', WebSocketEvents['registry:modules:sync']>) {
    const moduleEntries = event.data.modules.filter(isMinecraftModuleEntry)
    const moduleEntry = moduleEntries[0]
    servicePresent.value = moduleEntries.length > 0
    if (moduleEntries.length > 1) {
      providerConflict.value = true
      serviceHealthy.value = false
      registeredIdentity = undefined
      normalizedIdentity = undefined
      deactivateRuntime('failed')
      lastRejectionCode.value = 'minecraft-provider-conflict'
      return
    }

    providerConflict.value = false
    if (lastRejectionCode.value === 'minecraft-provider-conflict')
      lastRejectionCode.value = undefined
    if (!moduleEntry) {
      serviceHealthy.value = false
      registeredIdentity = undefined
      normalizedIdentity = undefined
      deactivateRuntime('stopped')
      return
    }

    serviceHealthy.value = true
    bindRuntime(moduleEntry.identity)
  }

  function handleRegistryHealthy(event: WebSocketBaseEvent<'registry:modules:health:healthy', WebSocketEvents['registry:modules:health:healthy']>) {
    if (providerConflict.value || !isMinecraftModuleEntry(event.data))
      return
    servicePresent.value = true
    serviceHealthy.value = true
    bindRuntime(event.data.identity)
  }

  function handleRegistryUnhealthy(event: WebSocketBaseEvent<'registry:modules:health:unhealthy', WebSocketEvents['registry:modules:health:unhealthy']>) {
    if (providerConflict.value || !isMinecraftModuleEntry(event.data) || !sameIdentity(normalizeMinecraftSourceIdentity(event.data.identity), normalizedIdentity))
      return
    servicePresent.value = true
    serviceHealthy.value = false
    deactivateRuntime('failed')
  }

  function handleModuleDeAnnounced(event: WebSocketBaseEvent<'module:de-announced', WebSocketEvents['module:de-announced']>) {
    if (!isMinecraftModuleEntry(event.data) || !sameIdentity(normalizeMinecraftSourceIdentity(event.data.identity), normalizedIdentity))
      return
    servicePresent.value = false
    serviceHealthy.value = false
    registeredIdentity = undefined
    normalizedIdentity = undefined
    deactivateRuntime('stopped')
  }

  function handleSparkCommand(event: WebSocketBaseEvent<'spark:command', WebSocketEvents['spark:command']>) {
    const destinations = Array.isArray(event.data.destinations) ? event.data.destinations : []
    if (!destinations.includes(MINECRAFT_SERVICE_NAME))
      return
    pushTrafficEntry({
      type: 'spark:command',
      summary: `command:${event.data.intent}`,
      source: getEventSourceLabel(event),
      receivedAt: Date.now(),
      outcome: 'ignored',
    })
  }

  function initialize() {
    if (initialized.value)
      return
    initialized.value = true
    disposeContextUpdate = serverChannelStore.onContextUpdate(handleRuntimeContextUpdate as any)
    disposeSparkCommand = serverChannelStore.onEvent('spark:command', handleSparkCommand as any)
    disposeRegistrySync = serverChannelStore.onEvent('registry:modules:sync', handleRegistrySync as any)
    disposeRegistryHealthy = serverChannelStore.onEvent('registry:modules:health:healthy', handleRegistryHealthy as any)
    disposeRegistryUnhealthy = serverChannelStore.onEvent('registry:modules:health:unhealthy', handleRegistryUnhealthy as any)
    disposeModuleDeAnnounced = serverChannelStore.onEvent('module:de-announced', handleModuleDeAnnounced as any)
    runtimeTickTimer = setInterval(() => {
      now.value = Date.now()
      refreshSafeState()
    }, RUNTIME_CONTEXT_TICK_MS)
  }

  function dispose() {
    disposeContextUpdate?.()
    disposeSparkCommand?.()
    disposeRegistrySync?.()
    disposeRegistryHealthy?.()
    disposeRegistryUnhealthy?.()
    disposeModuleDeAnnounced?.()
    disposeContextUpdate = null
    disposeSparkCommand = null
    disposeRegistrySync = null
    disposeRegistryHealthy = null
    disposeRegistryUnhealthy = null
    disposeModuleDeAnnounced = null
    if (runtimeTickTimer) {
      clearInterval(runtimeTickTimer)
      runtimeTickTimer = null
    }
    disablePerception()
    initialized.value = false
  }

  function resetState() {
    disablePerception()
    lastRuntimeContextAt.value = 0
    servicePresent.value = false
    serviceHealthy.value = false
    providerConflict.value = false
    registeredIdentity = undefined
    normalizedIdentity = undefined
    trafficEntries.value = []
    trafficSequence = 0
    rejectedEventCount.value = 0
    suppressedEventCount.value = 0
    lastRejectionCode.value = undefined
    refreshSafeState()
  }

  function getContextProjection() {
    now.value = Date.now()
    refreshSafeState()
    return activeProjection.value ? { ...activeProjection.value, factIds: [...activeProjection.value.factIds], statements: [...activeProjection.value.statements] } : null
  }

  return {
    lastRuntimeContextAt,
    trafficEntries,
    configured,
    serviceConnected,
    providerConflict,
    runtimeContextAgeMs,
    perceptionEnabled,
    perceptionPaused,
    generation,
    perceptionObservability,
    acceptedFactCount,
    rejectedEventCount,
    suppressedEventCount,
    lastRejectionCode,

    initialize,
    dispose,
    resetState,
    enablePerception,
    disablePerception,
    pausePerception,
    resumePerception,
    confirmFact,
    retractFact,
    clearFacts,
    getContextProjection,

    _handleRuntimeContextUpdate: handleRuntimeContextUpdate,
  }
})
