import type { ObjectivePerceptionEvent } from './contracts'

import { PERCEPTION_CONTRACT_VERSION } from './contracts'

export const cameraAllowlistedObjectLabels = [
  'person',
  'cup',
  'bottle',
  'book',
  'laptop',
  'keyboard',
  'mouse',
  'cell-phone',
  'chair',
  'cat',
  'dog',
] as const

export type CameraAllowlistedObjectLabel = typeof cameraAllowlistedObjectLabels[number]
export type CameraPose = 'upright' | 'seated' | 'standing' | 'head-down' | 'leaning' | 'unknown'
export type CameraGesture = 'hand-raised' | 'waving' | 'thumbs-up' | 'hands-visible' | 'unknown'
export type CameraObservableCue = 'smile-like' | 'eyes-closed' | 'face-occluded' | 'looking-away' | 'unknown'
export type CameraActivityLike = 'still' | 'moving' | 'typing-like' | 'speaking-like' | 'unknown'
export type CameraLighting = 'dark' | 'dim' | 'normal' | 'bright' | 'backlit' | 'unknown'
export type CameraCaptureHealth = 'healthy' | 'paused' | 'permission-denied' | 'track-ended' | 'failed' | 'stopped'

export interface CameraMediaPipeEvidence {
  analyzerId: 'mediapipe:pose' | 'mediapipe:hands' | 'mediapipe:face'
  observedAt: number
  personPresence?: { value: boolean, confidence: number }
  pose?: { value: CameraPose, confidence: number }
  gesture?: { value: CameraGesture, confidence: number }
  observableCue?: { value: CameraObservableCue, confidence: number }
}

export interface CameraOpenCvEvidence {
  analyzerId: 'opencv:quality-motion'
  observedAt: number
  lighting?: { value: CameraLighting, confidence: number }
  activityLike?: { value: CameraActivityLike, confidence: number }
  captureHealth?: { value: CameraCaptureHealth, confidence: number }
}

export interface CameraYoloEvidence {
  analyzerId: 'yolox-nano:coco'
  observedAt: number
  personCount?: { value: number, confidence: number }
  objects: Array<{ label: string, confidence: number }>
}

export interface CameraLocalFusionInput {
  sessionId: string
  generation: number
  sourceId: string
  observationId: string
  mediaPipe?: CameraMediaPipeEvidence[]
  openCv?: CameraOpenCvEvidence
  yolo?: CameraYoloEvidence
}

export interface CameraLocalFusionOptions {
  createId?: () => string
}

/**
 * Converts already-narrowed, non-raw analyzer evidence into bounded objective events.
 * Frames, landmarks, bounding boxes and tracks are deliberately absent from this API.
 */
export function createCameraLocalObjectiveEvents(
  input: CameraLocalFusionInput,
  options: CameraLocalFusionOptions = {},
): ObjectivePerceptionEvent[] {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const events: ObjectivePerceptionEvent[] = []

  for (const evidence of input.mediaPipe ?? []) {
    if (evidence.personPresence) {
      events.push(createEvent(input, evidence.analyzerId, evidence.observedAt, {
        eventType: 'person.presence.changed',
        subject: 'primary-user',
        value: { kind: 'boolean', value: evidence.personPresence.value },
        confidence: evidence.personPresence.confidence,
        verification: 'direct-signal',
        ttlMs: 3_000,
      }, createId))
    }
    if (evidence.pose) {
      events.push(createEvent(input, evidence.analyzerId, evidence.observedAt, {
        eventType: 'person.pose.observed',
        subject: 'primary-user',
        value: { kind: 'enum', value: evidence.pose.value },
        confidence: evidence.pose.confidence,
        verification: 'multi-frame-inferred',
        ttlMs: 4_000,
      }, createId))
    }
    if (evidence.gesture) {
      events.push(createEvent(input, evidence.analyzerId, evidence.observedAt, {
        eventType: 'person.gesture.observed',
        subject: 'primary-user',
        value: { kind: 'enum', value: evidence.gesture.value },
        confidence: evidence.gesture.confidence,
        verification: 'multi-frame-inferred',
        ttlMs: 4_000,
      }, createId))
    }
    if (evidence.observableCue) {
      events.push(createEvent(input, evidence.analyzerId, evidence.observedAt, {
        eventType: 'person.observable-cue.observed',
        subject: 'primary-user',
        value: { kind: 'enum', value: evidence.observableCue.value },
        confidence: evidence.observableCue.confidence,
        verification: 'multi-frame-inferred',
        ttlMs: 4_000,
      }, createId))
    }
  }

  if (input.openCv?.lighting) {
    events.push(createEvent(input, input.openCv.analyzerId, input.openCv.observedAt, {
      eventType: 'environment.lighting.observed',
      subject: 'environment',
      value: { kind: 'enum', value: input.openCv.lighting.value },
      confidence: input.openCv.lighting.confidence,
      verification: 'direct-signal',
      ttlMs: 3_000,
    }, createId))
  }
  if (input.openCv?.activityLike) {
    events.push(createEvent(input, input.openCv.analyzerId, input.openCv.observedAt, {
      eventType: 'person.activity-like.observed',
      subject: 'primary-user',
      value: { kind: 'enum', value: input.openCv.activityLike.value },
      confidence: input.openCv.activityLike.confidence,
      verification: 'multi-frame-inferred',
      ttlMs: 4_000,
    }, createId))
  }
  if (input.openCv?.captureHealth) {
    events.push(createEvent(input, input.openCv.analyzerId, input.openCv.observedAt, {
      eventType: 'camera.capture-health.changed',
      subject: 'environment',
      value: { kind: 'enum', value: input.openCv.captureHealth.value },
      confidence: input.openCv.captureHealth.confidence,
      verification: 'direct-signal',
      ttlMs: 3_000,
    }, createId))
  }

  if (input.yolo?.personCount) {
    events.push(createEvent(input, input.yolo.analyzerId, input.yolo.observedAt, {
      eventType: 'person.count.observed',
      subject: 'environment',
      value: { kind: 'number', value: clampInteger(input.yolo.personCount.value, 0, 16) },
      confidence: input.yolo.personCount.confidence,
      verification: 'direct-signal',
      ttlMs: 3_000,
    }, createId))
  }
  for (const object of input.yolo?.objects ?? []) {
    if (!isCameraAllowlistedObjectLabel(object.label) || object.label === 'person')
      continue
    events.push(createEvent(input, input.yolo!.analyzerId, input.yolo!.observedAt, {
      eventType: 'object.presence.changed',
      subject: 'allowlisted-object',
      value: { kind: 'enum', value: object.label },
      confidence: object.confidence,
      verification: 'multi-frame-inferred',
      ttlMs: 4_000,
    }, createId))
  }

  return events
}

export function isCameraAllowlistedObjectLabel(value: string): value is CameraAllowlistedObjectLabel {
  return (cameraAllowlistedObjectLabels as readonly string[]).includes(value)
}

interface EventFields {
  eventType: ObjectivePerceptionEvent['eventType']
  subject: ObjectivePerceptionEvent['subject']
  value: ObjectivePerceptionEvent['value']
  confidence: number
  verification: ObjectivePerceptionEvent['verification']
  ttlMs: number
}

function createEvent(
  input: CameraLocalFusionInput,
  analyzerId: string,
  observedAt: number,
  fields: EventFields,
  createId: () => string,
): ObjectivePerceptionEvent {
  return {
    contractVersion: PERCEPTION_CONTRACT_VERSION,
    eventId: `camera-event:${createId()}`,
    observationId: input.observationId,
    sessionId: input.sessionId,
    generation: input.generation,
    sourceKind: 'camera-local',
    sourceId: input.sourceId,
    analyzers: [analyzerId, 'camera:local-fusion'],
    eventType: fields.eventType,
    phase: 'observed',
    subject: fields.subject,
    value: fields.value,
    confidence: clamp(fields.confidence, 0, 1),
    observedAt,
    expiresAt: observedAt + fields.ttlMs,
    verification: fields.verification,
    sensitivity: fields.eventType === 'camera.capture-health.changed' ? 'public' : 'personal',
    provenance: {
      analyzerId: 'camera:local-fusion',
      processing: 'local',
      adapterId: 'camera:local',
      modelId: analyzerId === 'yolox-nano:coco' ? 'yolox-nano-0.1.1rc0' : undefined,
    },
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum))
}
