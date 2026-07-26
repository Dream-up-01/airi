import { describe, expect, it } from 'vitest'

import { PerceptionReactionPolicy } from '../../domains/perception/reaction-actuation'
import { PerceptionStateManager } from '../../domains/perception/state-manager'
import { createConsentGrant, createPerceptionEvent } from '../../domains/perception/test-fixtures'
import { PerceptionDownstreamPolicyController } from './downstream-policy-controller'

describe('perceptionDownstreamPolicyController', () => {
  it('publishes context-only candidate IDs by default and no actuation intent', () => {
    const manager = new PerceptionStateManager({ sessionId: 'session:1', generation: 1, clock: { now: () => 1_000 } })
    manager.ingest(createPerceptionEvent({
      eventType: 'person.presence.changed',
      sourceKind: 'camera-local',
      sourceId: 'camera:default',
      value: { kind: 'boolean', value: true },
      confidence: 0.9,
      observedAt: 900,
      expiresAt: 4_900,
    }), {
      consentGrant: createConsentGrant({ sourceKind: 'camera', sourceId: 'camera:default', allowedModalities: ['camera-frames'], allowedFactCategories: ['person.presence'] }),
      sourceHealthy: true,
    })
    const controller = new PerceptionDownstreamPolicyController({
      reaction: new PerceptionReactionPolicy({ now: () => 1_000, id: () => 'reaction:1' }),
    })
    const snapshot = controller.evaluate(manager)
    expect(snapshot).toMatchObject({ reactionsEnabled: false, candidates: [{ mode: 'context-only' }], actuationIntents: [] })
    expect(manager.snapshot()).toMatchObject({ reactionCandidateIds: ['reaction:1'], stageActuationCandidateIds: [] })
    controller.cancelAll(manager)
    expect(manager.snapshot()).toMatchObject({ reactionCandidateIds: [], stageActuationCandidateIds: [] })
  })
})
