import { describe, expect, it, vi } from 'vitest'

import { createLatestCameraAnalyzer } from './camera-latest-analyzer'
import { createCameraMediaPipeEvidenceNarrower } from './camera-mediapipe-evidence'
import { analyzeOpenCvCameraMetrics } from './camera-opencv-evidence'
import { postprocessYoloXNano } from './camera-yolox-postprocess'

describe('camera MediaPipe evidence narrowing', () => {
  it('detects presence and a head-down observable pose without retaining landmarks', () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))
    landmarks[0].y = 0.38
    landmarks[11] = { x: 0.4, y: 0.42, visibility: 1 }
    landmarks[12] = { x: 0.6, y: 0.42, visibility: 1 }
    landmarks[23] = { x: 0.45, y: 0.68, visibility: 1 }
    landmarks[24] = { x: 0.55, y: 0.68, visibility: 1 }
    const narrower = createCameraMediaPipeEvidenceNarrower()
    const result = narrower.narrow({ pose: { landmarks2d: landmarks } }, 1_000)
    expect(result[0]).toMatchObject({
      personPresence: { value: true },
      pose: { value: 'head-down' },
    })
    expect(JSON.stringify(result)).not.toContain('landmarks2d')
  })

  it('requires a derived direction change before reporting waving', () => {
    const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))
    pose[11].y = 0.45
    pose[12].y = 0.45
    const narrower = createCameraMediaPipeEvidenceNarrower()
    const gestures = [0.25, 0.36, 0.24, 0.38].map((x, index) => {
      const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, visibility: 1 }))
      hand[0] = { x, y: 0.3, visibility: 1 }
      return narrower.narrow({ pose: { landmarks2d: pose }, hands: [{ landmarks2d: hand, score: 0.9 }] }, 1_000 + index * 200)[1]?.gesture?.value
    })
    expect(gestures.slice(0, 3)).toEqual(['hand-raised', 'hand-raised', 'hand-raised'])
    expect(gestures[3]).toBe('waving')
  })
})

describe('camera OpenCV metric narrowing', () => {
  it.each([
    [20, 40, 0.01, 1, 'dark', 'clear'],
    [55, 5, 0.01, 1, 'dim', 'blurred'],
    [120, 40, 0.01, 0.1, 'normal', 'occluded'],
    [120, 40, 0.2, 1, 'normal', 'clear'],
  ] as const)('classifies lighting, blur, occlusion and motion', (mean, variance, motion, visible, lighting, quality) => {
    const result = analyzeOpenCvCameraMetrics({
      observedAt: 1_000,
      meanLuminance: mean,
      laplacianVariance: variance,
      motionRatio: motion,
      visiblePixelRatio: visible,
    })
    expect(result.evidence.lighting?.value).toBe(lighting)
    expect(result.quality).toBe(quality)
    if (motion >= 0.2)
      expect(result.evidence.activityLike?.value).toBe('moving')
  })
})

describe('yOLOX output narrowing', () => {
  it('counts multiple people, applies NMS and drops unknown COCO labels', () => {
    const data = new Float32Array(4 * 85)
    setRow(data, 0, [100, 100, 80, 120, 0.9], 0, 0.9)
    setRow(data, 1, [102, 100, 80, 120, 0.8], 0, 0.9)
    setRow(data, 2, [300, 100, 70, 110, 0.9], 0, 0.85)
    setRow(data, 3, [200, 200, 50, 50, 0.99], 2, 0.99)
    const result = postprocessYoloXNano({ data, dimensions: [1, 4, 85] }, 1_000)
    expect(result.personCount?.value).toBe(2)
    expect(result.objects).toEqual([])
  })

  it('returns only an allowlisted object label and no box', () => {
    const data = new Float32Array(85)
    setRow(data, 0, [100, 100, 20, 30, 0.9], 63, 0.9)
    const result = postprocessYoloXNano({ data, dimensions: [1, 1, 85] }, 1_000)
    expect(result.objects).toEqual([{ label: 'laptop', confidence: expect.closeTo(0.81, 5) }])
    expect(JSON.stringify(result)).not.toMatch(/x1|x2|y1|y2|bbox/iu)
  })
})

describe('latest camera analyzer', () => {
  it('keeps one in-flight job, replaces the latest slot and releases dropped frames', async () => {
    let resolveFirst: ((value: number) => void) | undefined
    const releases = [vi.fn(), vi.fn(), vi.fn()]
    const results: string[] = []
    const analyzer = createLatestCameraAnalyzer<number, number>({
      timeoutMs: 1_000,
      analyze: value => value === 1 ? new Promise((resolve) => { resolveFirst = resolve }) : Promise.resolve(value),
      onResult: result => results.push(result.status),
    })
    analyzer.submit({ frame: 1, capturedAt: 1, release: releases[0] })
    analyzer.submit({ frame: 2, capturedAt: 2, release: releases[1] })
    analyzer.submit({ frame: 3, capturedAt: 3, release: releases[2] })
    expect(releases[1]).toHaveBeenCalledOnce()
    resolveFirst?.(1)
    await vi.waitFor(() => expect(results).toEqual(['dropped', 'completed', 'completed']))
    expect(releases[0]).toHaveBeenCalledOnce()
    expect(releases[2]).toHaveBeenCalledOnce()
  })
})

function setRow(data: Float32Array, row: number, box: [number, number, number, number, number], classIndex: number, classScore: number) {
  const offset = row * 85
  data.set(box, offset)
  data[offset + 5 + classIndex] = classScore
}
