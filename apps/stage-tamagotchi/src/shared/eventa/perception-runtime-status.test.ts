import { describe, expect, it } from 'vitest'

import {
  parsePerceptionRuntimeStatusRequestWire,
  parsePerceptionRuntimeStatusWire,
  PERCEPTION_RUNTIME_STATUS_VERSION,
} from './perception-runtime-status'

describe('perception runtime status wire contract', () => {
  it('accepts only the bounded structured status fields', () => {
    expect(parsePerceptionRuntimeStatusWire({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId: 'renderer:settings:1',
      sourceKind: 'camera',
      state: 'running',
      generation: 3,
      updatedAt: 1234,
    })).toEqual({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId: 'renderer:settings:1',
      sourceKind: 'camera',
      state: 'running',
      generation: 3,
      updatedAt: 1234,
    })

    expect(parsePerceptionRuntimeStatusWire({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId: 'renderer:settings:1',
      sourceKind: 'camera',
      state: 'running',
      generation: 3,
      updatedAt: 1234,
      frame: 'data:image/jpeg;base64,raw',
    })).toBeUndefined()

    expect(parsePerceptionRuntimeStatusWire({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId: 'renderer:main:1',
      sourceKind: 'minecraft',
      state: 'paused',
      generation: 4,
      updatedAt: 2345,
    })?.sourceKind).toBe('minecraft')
  })

  it('rejects invalid status and request values at the broadcast boundary', () => {
    expect(parsePerceptionRuntimeStatusWire({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      publisherId: 'renderer with spaces',
      sourceKind: 'microphone',
      state: 'recording',
      generation: -1,
      updatedAt: Number.NaN,
    })).toBeUndefined()

    expect(parsePerceptionRuntimeStatusRequestWire({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      requesterId: 'renderer:main:1',
      requestedAt: 4321,
    })).toEqual({
      contractVersion: PERCEPTION_RUNTIME_STATUS_VERSION,
      requesterId: 'renderer:main:1',
      requestedAt: 4321,
    })
  })
})
