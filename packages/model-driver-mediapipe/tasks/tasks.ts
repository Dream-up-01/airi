export interface VisionTaskAssets {
  pose: string
  hands: string
  face: string
}

export const visionTaskAssets: VisionTaskAssets = {
  pose: new URL('./assets/pose_landmarker_lite.task', import.meta.url).href,
  hands: new URL('./assets/hand_landmarker.task', import.meta.url).href,
  face: new URL('./assets/face_landmarker.task', import.meta.url).href,
}

// Vite cannot discover a directory-only `new URL()` reference. Keep the
// loader and binary as explicit assets so production builds contain the
// MediaPipe runtime instead of failing only when the first frame is analyzed.
export const visionTaskWasmFileset = {
  wasmLoaderPath: new URL('./assets/wasm/vision_wasm_internal.js', import.meta.url).href,
  wasmBinaryPath: new URL('./assets/wasm/vision_wasm_internal.wasm', import.meta.url).href,
}
