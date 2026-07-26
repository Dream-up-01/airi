import { describe, expect, it } from 'vitest'

import { createCameraLocalObjectiveEvents, isCameraAllowlistedObjectLabel } from './camera'
import { parseObjectivePerceptionEvent } from './schemas'

const baseInput = {
  sessionId: 'session:camera',
  generation: 3,
  sourceId: 'camera:default',
  observationId: 'observation:camera-1',
}

describe('camera local objective fusion', () => {
  it('emits only schema-valid bounded objective events without raw evidence', () => {
    let id = 0
    const events = createCameraLocalObjectiveEvents({
      ...baseInput,
      mediaPipe: [{
        analyzerId: 'mediapipe:pose',
        observedAt: 1_000,
        personPresence: { value: true, confidence: 0.93 },
        pose: { value: 'head-down', confidence: 0.78 },
      }],
      openCv: {
        analyzerId: 'opencv:quality-motion',
        observedAt: 1_000,
        lighting: { value: 'dim', confidence: 0.81 },
        activityLike: { value: 'moving', confidence: 0.72 },
        captureHealth: { value: 'healthy', confidence: 1 },
      },
      yolo: {
        analyzerId: 'yolox-nano:coco',
        observedAt: 1_000,
        personCount: { value: 2, confidence: 0.84 },
        objects: [
          { label: 'laptop', confidence: 0.91 },
          { label: 'cup', confidence: 0.77 },
        ],
      },
    }, { createId: () => String(++id) })

    expect(events.map(event => event.eventType)).toEqual([
      'person.presence.changed',
      'person.pose.observed',
      'environment.lighting.observed',
      'person.activity-like.observed',
      'camera.capture-health.changed',
      'person.count.observed',
      'object.presence.changed',
      'object.presence.changed',
    ])
    expect(events.every(event => parseObjectivePerceptionEvent(event).ok)).toBe(true)
    expect(Object.keys(events[0])).not.toEqual(expect.arrayContaining([
      'rawFrame',
      'landmarks',
      'boundingBoxes',
      'trajectory',
      'embedding',
      'instruction',
    ]))
  })

  it('drops unknown YOLO labels and never emits person as an object identity', () => {
    const events = createCameraLocalObjectiveEvents({
      ...baseInput,
      yolo: {
        analyzerId: 'yolox-nano:coco',
        observedAt: 1_000,
        personCount: { value: 99, confidence: 2 },
        objects: [
          { label: 'person', confidence: 0.9 },
          { label: 'password', confidence: 0.99 },
          { label: 'book', confidence: 0.8 },
        ],
      },
    }, { createId: () => 'fixed' })

    expect(events).toHaveLength(2)
    expect(events[0].value).toEqual({ kind: 'number', value: 16 })
    expect(events[0].confidence).toBe(1)
    expect(events[1].value).toEqual({ kind: 'enum', value: 'book' })
    expect(isCameraAllowlistedObjectLabel('password')).toBe(false)
  })

  it('carries generation and short TTL on every event', () => {
    const events = createCameraLocalObjectiveEvents({
      ...baseInput,
      mediaPipe: [{
        analyzerId: 'mediapipe:hands',
        observedAt: 10_000,
        gesture: { value: 'waving', confidence: 0.85 },
      }],
    }, { createId: () => '1' })

    expect(events[0]).toMatchObject({ generation: 3, observedAt: 10_000, expiresAt: 14_000 })
  })
})
