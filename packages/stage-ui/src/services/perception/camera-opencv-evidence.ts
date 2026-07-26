import type { CameraOpenCvEvidence } from '../../domains/perception'

export interface OpenCvCameraMetrics {
  observedAt: number
  meanLuminance: number
  laplacianVariance: number
  motionRatio: number
  visiblePixelRatio: number
}

export interface OpenCvCameraAnalysis {
  evidence: CameraOpenCvEvidence
  quality: 'clear' | 'blurred' | 'occluded'
}

/** Classifies bounded OpenCV metrics; no image or pixel buffer is retained. */
export function analyzeOpenCvCameraMetrics(metrics: OpenCvCameraMetrics): OpenCvCameraAnalysis {
  const luminance = clamp(metrics.meanLuminance, 0, 255)
  const motion = clamp(metrics.motionRatio, 0, 1)
  const visible = clamp(metrics.visiblePixelRatio, 0, 1)
  const quality = visible < 0.2
    ? 'occluded'
    : metrics.laplacianVariance < 18
      ? 'blurred'
      : 'clear'

  const evidence: CameraOpenCvEvidence = {
    analyzerId: 'opencv:quality-motion',
    observedAt: metrics.observedAt,
    captureHealth: { value: quality === 'occluded' ? 'failed' : 'healthy', confidence: quality === 'occluded' ? 0.8 : 0.95 },
    lighting: classifyLighting(luminance),
  }
  if (quality !== 'occluded') {
    evidence.activityLike = {
      value: motion >= 0.075 ? 'moving' : 'still',
      confidence: motion >= 0.075 ? Math.min(0.95, 0.65 + motion) : Math.min(0.9, 0.7 + (0.075 - motion)),
    }
  }
  return { evidence, quality }
}

function classifyLighting(luminance: number): NonNullable<CameraOpenCvEvidence['lighting']> {
  if (luminance < 35)
    return { value: 'dark', confidence: 0.9 }
  if (luminance < 75)
    return { value: 'dim', confidence: 0.82 }
  if (luminance > 225)
    return { value: 'bright', confidence: 0.85 }
  return { value: 'normal', confidence: 0.8 }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}
