import type { CameraYoloEvidence } from '../../domains/perception'

import { isCameraAllowlistedObjectLabel } from '../../domains/perception'

export interface YoloXOutput {
  data: Float32Array
  dimensions: readonly number[]
}

export interface YoloXPostprocessOptions {
  confidenceThreshold?: number
  nmsThreshold?: number
}

interface Detection {
  label: string
  score: number
  x1: number
  y1: number
  x2: number
  y2: number
}

const cocoLabels = [
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'airplane',
  'bus',
  'train',
  'truck',
  'boat',
  'traffic-light',
  'fire-hydrant',
  'stop-sign',
  'parking-meter',
  'bench',
  'bird',
  'cat',
  'dog',
  'horse',
  'sheep',
  'cow',
  'elephant',
  'bear',
  'zebra',
  'giraffe',
  'backpack',
  'umbrella',
  'handbag',
  'tie',
  'suitcase',
  'frisbee',
  'skis',
  'snowboard',
  'sports-ball',
  'kite',
  'baseball-bat',
  'baseball-glove',
  'skateboard',
  'surfboard',
  'tennis-racket',
  'bottle',
  'wine-glass',
  'cup',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot-dog',
  'pizza',
  'donut',
  'cake',
  'chair',
  'couch',
  'potted-plant',
  'bed',
  'dining-table',
  'toilet',
  'tv',
  'laptop',
  'mouse',
  'remote',
  'keyboard',
  'cell-phone',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'refrigerator',
  'book',
  'clock',
  'vase',
  'scissors',
  'teddy-bear',
  'hair-drier',
  'toothbrush',
] as const

/** Narrows decoded YOLOX rows to counts and allowlisted labels; boxes are temporary. */
export function postprocessYoloXNano(
  output: YoloXOutput,
  observedAt: number,
  options: YoloXPostprocessOptions = {},
): CameraYoloEvidence {
  const confidenceThreshold = options.confidenceThreshold ?? 0.35
  const nmsThreshold = options.nmsThreshold ?? 0.45
  if (output.dimensions.length !== 3 || output.dimensions[2] !== 85 || output.data.length % 85 !== 0)
    throw new Error('camera-yolox-invalid-output-shape')

  const detections: Detection[] = []
  for (let offset = 0; offset < output.data.length; offset += 85) {
    const objectness = output.data[offset + 4]
    if (objectness <= 0)
      continue
    let classIndex = 0
    let classScore = output.data[offset + 5]
    for (let index = 1; index < 80; index++) {
      const score = output.data[offset + 5 + index]
      if (score > classScore) {
        classIndex = index
        classScore = score
      }
    }
    const score = objectness * classScore
    const label = cocoLabels[classIndex]
    if (score < confidenceThreshold || !isCameraAllowlistedObjectLabel(label))
      continue
    const centerX = output.data[offset]
    const centerY = output.data[offset + 1]
    const width = Math.max(0, output.data[offset + 2])
    const height = Math.max(0, output.data[offset + 3])
    detections.push({
      label,
      score,
      x1: centerX - width / 2,
      y1: centerY - height / 2,
      x2: centerX + width / 2,
      y2: centerY + height / 2,
    })
  }

  const kept = nonMaximumSuppression(detections, nmsThreshold)
  const persons = kept.filter(detection => detection.label === 'person')
  const objectScores = new Map<string, number>()
  for (const detection of kept) {
    if (detection.label !== 'person')
      objectScores.set(detection.label, Math.max(objectScores.get(detection.label) ?? 0, detection.score))
  }

  return {
    analyzerId: 'yolox-nano:coco',
    observedAt,
    personCount: {
      value: Math.min(persons.length, 16),
      confidence: persons.length > 0 ? Math.min(...persons.map(person => person.score)) : 0.8,
    },
    objects: [...objectScores.entries()].map(([label, confidence]) => ({ label, confidence })),
  }
}

function nonMaximumSuppression(detections: Detection[], threshold: number): Detection[] {
  const remaining = [...detections].sort((left, right) => right.score - left.score)
  const kept: Detection[] = []
  while (remaining.length > 0) {
    const current = remaining.shift()!
    kept.push(current)
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (remaining[index].label === current.label && intersectionOverUnion(current, remaining[index]) > threshold)
        remaining.splice(index, 1)
    }
  }
  return kept
}

function intersectionOverUnion(left: Detection, right: Detection): number {
  const intersectionWidth = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1))
  const intersectionHeight = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1))
  const intersection = intersectionWidth * intersectionHeight
  const leftArea = Math.max(0, left.x2 - left.x1) * Math.max(0, left.y2 - left.y1)
  const rightArea = Math.max(0, right.x2 - right.x1) * Math.max(0, right.y2 - right.y1)
  const union = leftArea + rightArea - intersection
  return union > 0 ? intersection / union : 0
}
