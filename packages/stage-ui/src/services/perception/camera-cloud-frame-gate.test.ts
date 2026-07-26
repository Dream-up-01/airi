import { describe, expect, it, vi } from 'vitest'

import {
  CAMERA_CLOUD_MAX_JPEG_BYTES,
  CameraCloudFrameGate,
} from './camera-cloud-frame-gate'

function candidate(overrides: Partial<Parameters<CameraCloudFrameGate['evaluate']>[0]> = {}) {
  const release = vi.fn()
  const jpegBytes = new Uint8Array([0xFF, 0xD8, 0x00, 0xFF, 0xD9])
  return {
    value: {
      frameId: 'frame:camera-cloud',
      generation: 2,
      capturedAt: 1_000,
      monotonicTimestamp: 1_000,
      width: 640,
      height: 360,
      jpegBytes,
      significantVisualChange: true,
      personPresent: true,
      foreground: true,
      privacyMode: false,
      busy: false,
      release,
      ...overrides,
    },
    release,
  }
}

describe('camera cloud frame gate', () => {
  it('accepts only the selected resolution and bounded JPEG/base64 payload', () => {
    const gate = new CameraCloudFrameGate({ generation: 2 })
    const accepted = candidate()
    expect(gate.evaluate(accepted.value)).toEqual({ accepted: true, encodedBase64Bytes: 8, nextEligibleAt: 2_000 })
    expect(accepted.release).not.toHaveBeenCalled()

    const wrongResolution = candidate({ width: 960, height: 540, monotonicTimestamp: 2_000 })
    expect(gate.evaluate(wrongResolution.value)).toMatchObject({ accepted: false, reason: 'invalid-frame' })
    expect(wrongResolution.release).toHaveBeenCalledWith('invalid-frame')

    const oversizedBytes = new Uint8Array(CAMERA_CLOUD_MAX_JPEG_BYTES + 1)
    oversizedBytes.set([0xFF, 0xD8])
    oversizedBytes.set([0xFF, 0xD9], oversizedBytes.length - 2)
    const oversized = candidate({ jpegBytes: oversizedBytes, monotonicTimestamp: 2_000 })
    expect(gate.evaluate(oversized.value)).toMatchObject({ accepted: false, reason: 'payload-too-large' })
    expect(oversized.release).toHaveBeenCalledWith('payload-too-large')
  })

  it('drops frames while private, background, still, person-absent or busy', () => {
    const cases = [
      ['privacy-blocked', { privacyMode: true }],
      ['background', { foreground: false }],
      ['no-person', { personPresent: false }],
      ['unchanged', { significantVisualChange: false }],
      ['busy', { busy: true }],
    ] as const

    for (const [reason, overrides] of cases) {
      const gate = new CameraCloudFrameGate({ generation: 2 })
      const value = candidate(overrides)
      expect(gate.evaluate(value.value)).toMatchObject({ accepted: false, reason })
      expect(value.release).toHaveBeenCalledWith(reason)
    }
  })

  it('enforces at most one accepted frame per second and rejects an old generation', () => {
    const gate = new CameraCloudFrameGate({ generation: 2 })
    expect(gate.evaluate(candidate({ monotonicTimestamp: 0 }).value).accepted).toBe(true)

    const early = candidate({ monotonicTimestamp: 999 })
    expect(gate.evaluate(early.value)).toMatchObject({ accepted: false, reason: 'cadence-limited', nextEligibleAt: 1_000 })
    expect(gate.evaluate(candidate({ monotonicTimestamp: 1_000 }).value).accepted).toBe(true)

    const stale = candidate({ generation: 1, monotonicTimestamp: 2_000 })
    expect(gate.evaluate(stale.value)).toMatchObject({ accepted: false, reason: 'stale-generation' })
    expect(stale.release).toHaveBeenCalledWith('stale-generation')
  })
})
