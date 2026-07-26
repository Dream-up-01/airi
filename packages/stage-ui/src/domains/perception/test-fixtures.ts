import type { ObjectivePerceptionEvent, PerceptionConsentGrant } from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'

export function createPerceptionEvent(overrides: Partial<ObjectivePerceptionEvent> = {}): ObjectivePerceptionEvent {
  return {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    eventId: 'event:1',
    observationId: 'observation:1',
    sessionId: 'session:1',
    generation: 1,
    sourceKind: 'camera-local',
    sourceId: 'camera:default',
    analyzers: ['mediapipe:pose'],
    eventType: 'person.presence.changed',
    phase: 'observed',
    subject: 'primary-user',
    value: { kind: 'boolean', value: true },
    confidence: 0.9,
    observedAt: 1_000,
    expiresAt: 4_000,
    verification: 'direct-signal',
    sensitivity: 'personal',
    provenance: { analyzerId: 'mediapipe:pose', processing: 'local', adapterId: 'camera:mediapipe' },
    ...overrides,
  }
}

export function createConsentGrant(overrides: Partial<PerceptionConsentGrant> = {}): PerceptionConsentGrant {
  return {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    grantId: 'grant:1',
    sourceKind: 'camera',
    sourceId: 'camera:default',
    processingMode: 'local-only',
    allowedModalities: ['camera-frames'],
    allowedFactCategories: ['person.presence', 'person.gesture', 'person.pose', 'camera.health'],
    grantedAt: 900,
    showPersistentIndicator: true,
    ...overrides,
  }
}
