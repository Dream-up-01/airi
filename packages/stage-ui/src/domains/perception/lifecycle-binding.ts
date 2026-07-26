import type { PerceptionLifecycleHooks } from './session'
import type { PerceptionStateManager } from './state-manager'

/**
 * Connects lifecycle invalidation to the single fact writer without exposing
 * either object to capture adapters.
 */
export function bindPerceptionLifecycleToStateManager(manager: PerceptionStateManager): PerceptionLifecycleHooks {
  return {
    onGenerationChanged(sessionId, generation) {
      manager.setGeneration(sessionId, generation)
    },
    onSourceRevoked(_sourceKind, sourceId) {
      manager.revokeSource(sourceId)
    },
  }
}
