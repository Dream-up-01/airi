import type { CameraMediaPipeEvidence } from '../../domains/perception'

export interface NarrowLandmark {
  x: number
  y: number
  visibility?: number
  presence?: number
}

export interface NarrowMediaPipeResult {
  pose?: { landmarks2d?: NarrowLandmark[] }
  hands?: Array<{ landmarks2d: NarrowLandmark[], score?: number }>
  face?: { hasFace?: boolean, landmarks2d?: NarrowLandmark[] }
}

export interface CameraMediaPipeEvidenceNarrower {
  narrow: (result: NarrowMediaPipeResult, observedAt: number) => CameraMediaPipeEvidence[]
  reset: () => void
}

/** Stores only four wrist coordinates; complete landmarks never leave this call. */
export function createCameraMediaPipeEvidenceNarrower(): CameraMediaPipeEvidenceNarrower {
  const wristSamples: Array<{ x: number, at: number }> = []

  function reset() {
    wristSamples.length = 0
  }

  function narrow(result: NarrowMediaPipeResult, observedAt: number): CameraMediaPipeEvidence[] {
    const evidence: CameraMediaPipeEvidence[] = []
    const pose = result.pose?.landmarks2d ?? []
    const shouldersVisible = visible(pose[11]) && visible(pose[12])
    const personPresent = pose.length >= 25 && shouldersVisible

    const poseEvidence: CameraMediaPipeEvidence = {
      analyzerId: 'mediapipe:pose',
      observedAt,
      personPresence: { value: personPresent, confidence: personPresent ? 0.92 : 0.8 },
    }
    if (personPresent)
      poseEvidence.pose = inferPose(pose)
    evidence.push(poseEvidence)

    const hands = result.hands ?? []
    if (hands.length > 0) {
      const gesture = inferGesture(hands, pose, observedAt, wristSamples)
      evidence.push({
        analyzerId: 'mediapipe:hands',
        observedAt,
        gesture,
      })
    }
    else {
      wristSamples.length = 0
    }

    const face = result.face
    if (face?.hasFace && (face.landmarks2d?.length ?? 0) > 0) {
      const cue = inferFaceCue(face.landmarks2d!)
      if (cue) {
        evidence.push({
          analyzerId: 'mediapipe:face',
          observedAt,
          observableCue: cue,
        })
      }
    }

    return evidence
  }

  return { narrow, reset }
}

function inferPose(landmarks: NarrowLandmark[]): NonNullable<CameraMediaPipeEvidence['pose']> {
  const nose = landmarks[0]
  const leftShoulder = landmarks[11]
  const rightShoulder = landmarks[12]
  const leftHip = landmarks[23]
  const rightHip = landmarks[24]
  const shoulderY = average(leftShoulder.y, rightShoulder.y)
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y)

  if (visible(nose) && nose.y > shoulderY - 0.1)
    return { value: 'head-down', confidence: 0.76 }
  if (shoulderTilt > 0.11)
    return { value: 'leaning', confidence: 0.72 }
  if (visible(leftHip) && visible(rightHip)) {
    const torsoHeight = Math.abs(average(leftHip.y, rightHip.y) - shoulderY)
    if (torsoHeight < 0.18)
      return { value: 'seated', confidence: 0.67 }
    return { value: 'upright', confidence: 0.75 }
  }
  return { value: 'unknown', confidence: 0.65 }
}

function inferGesture(
  hands: NonNullable<NarrowMediaPipeResult['hands']>,
  pose: NarrowLandmark[],
  observedAt: number,
  wristSamples: Array<{ x: number, at: number }>,
): NonNullable<CameraMediaPipeEvidence['gesture']> {
  const best = hands.reduce((current, hand) => (hand.score ?? 0) > (current.score ?? 0) ? hand : current)
  const wrist = best.landmarks2d[0]
  const shoulderY = visible(pose[11]) && visible(pose[12]) ? average(pose[11].y, pose[12].y) : 0.45
  const raised = visible(wrist) && wrist.y < shoulderY

  if (raised) {
    wristSamples.push({ x: wrist.x, at: observedAt })
    while (wristSamples.length > 4 || wristSamples[0]?.at < observedAt - 1_200)
      wristSamples.shift()
    if (hasDirectionChange(wristSamples))
      return { value: 'waving', confidence: 0.78 }
    return { value: 'hand-raised', confidence: 0.82 }
  }

  wristSamples.length = 0
  if (isThumbUp(best.landmarks2d))
    return { value: 'thumbs-up', confidence: 0.74 }
  return { value: 'hands-visible', confidence: 0.7 }
}

function inferFaceCue(landmarks: NarrowLandmark[]): NonNullable<CameraMediaPipeEvidence['observableCue']> | undefined {
  const leftEye = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144])
  const rightEye = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380])
  if (leftEye !== undefined && rightEye !== undefined && (leftEye + rightEye) / 2 < 0.17)
    return { value: 'eyes-closed', confidence: 0.7 }
}

function eyeAspectRatio(landmarks: NarrowLandmark[], indices: [number, number, number, number, number, number]): number | undefined {
  const points = indices.map(index => landmarks[index])
  if (points.some(point => !visible(point)))
    return undefined
  const horizontal = distance(points[0], points[3])
  if (horizontal <= 0.001)
    return undefined
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal)
}

function isThumbUp(landmarks: NarrowLandmark[]): boolean {
  const thumbTip = landmarks[4]
  const thumbMcp = landmarks[2]
  const otherTips = [8, 12, 16, 20].map(index => landmarks[index])
  const otherPips = [6, 10, 14, 18].map(index => landmarks[index])
  return visible(thumbTip)
    && visible(thumbMcp)
    && thumbTip.y < thumbMcp.y
    && otherTips.every((tip, index) => visible(tip) && visible(otherPips[index]) && tip.y > otherPips[index].y)
}

function hasDirectionChange(samples: Array<{ x: number }>): boolean {
  if (samples.length < 4)
    return false
  const deltas = samples.slice(1).map((sample, index) => sample.x - samples[index].x).filter(delta => Math.abs(delta) >= 0.035)
  return deltas.some((delta, index) => index > 0 && Math.sign(delta) !== Math.sign(deltas[index - 1]))
}

function visible(point: NarrowLandmark | undefined): point is NarrowLandmark {
  return Boolean(point) && (point!.visibility ?? 1) >= 0.5 && (point!.presence ?? 1) >= 0.5
}

function average(left: number, right: number): number {
  return (left + right) / 2
}

function distance(left: NarrowLandmark, right: NarrowLandmark): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}
