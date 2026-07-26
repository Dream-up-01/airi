import type { CameraYoloEvidence } from '@proj-airi/stage-ui/domains/perception'

import { postprocessYoloXNano } from '@proj-airi/stage-ui/services/perception'

import * as ort from 'onnxruntime-web/webgpu'

const MODEL_SIZE = 416

export class CameraYoloXRuntime {
  #session?: ort.InferenceSession
  #loading?: Promise<ort.InferenceSession>

  async analyze(imageData: ImageData, observedAt: number, signal: AbortSignal): Promise<CameraYoloEvidence> {
    const session = await this.#load()
    if (signal.aborted)
      throw new Error('camera-yolox-cancelled')
    const tensor = new ort.Tensor('float32', preprocessYoloX(imageData), [1, 3, MODEL_SIZE, MODEL_SIZE])
    const results = await session.run({ [session.inputNames[0]]: tensor })
    if (signal.aborted)
      throw new Error('camera-yolox-cancelled')
    const output = results[session.outputNames[0]]
    if (!output || !(output.data instanceof Float32Array))
      throw new Error('camera-yolox-invalid-output')
    return postprocessYoloXNano({ data: output.data, dimensions: output.dims }, observedAt)
  }

  async dispose(): Promise<void> {
    const session = this.#session
    this.#session = undefined
    this.#loading = undefined
    await session?.release()
  }

  async #load(): Promise<ort.InferenceSession> {
    if (this.#session)
      return this.#session
    if (this.#loading)
      return await this.#loading
    if (!navigator.gpu)
      throw new Error('camera-yolox-webgpu-unavailable')
    this.#loading = (async () => {
      const modelUrl = new URL('assets/perception/camera-local/yolox-nano-0.1.1rc0.onnx', document.baseURI)
      const response = await fetch(modelUrl)
      if (!response.ok)
        throw new Error('camera-yolox-model-unavailable')
      const model = new Uint8Array(await response.arrayBuffer())
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      })
      this.#session = session
      return session
    })().finally(() => {
      this.#loading = undefined
    })
    return await this.#loading
  }
}

export function preprocessYoloX(imageData: ImageData): Float32Array {
  const output = new Float32Array(3 * MODEL_SIZE * MODEL_SIZE)
  output.fill(114)
  const scale = Math.min(MODEL_SIZE / imageData.width, MODEL_SIZE / imageData.height)
  const scaledWidth = Math.max(1, Math.round(imageData.width * scale))
  const scaledHeight = Math.max(1, Math.round(imageData.height * scale))
  const planeSize = MODEL_SIZE * MODEL_SIZE
  for (let y = 0; y < scaledHeight; y++) {
    const sourceY = Math.min(imageData.height - 1, Math.floor(y / scale))
    for (let x = 0; x < scaledWidth; x++) {
      const sourceX = Math.min(imageData.width - 1, Math.floor(x / scale))
      const sourceOffset = (sourceY * imageData.width + sourceX) * 4
      const targetOffset = y * MODEL_SIZE + x
      output[targetOffset] = imageData.data[sourceOffset]
      output[planeSize + targetOffset] = imageData.data[sourceOffset + 1]
      output[2 * planeSize + targetOffset] = imageData.data[sourceOffset + 2]
    }
  }
  return output
}
