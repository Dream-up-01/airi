import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'
import type { SourceOptionsWithRequest } from '@proj-airi/electron-screen-capture/renderer'
import type { ProductionScreenCaptureHandle } from '@proj-airi/stage-ui/services/perception'
import type { SourcesOptions } from 'electron'

import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { setupElectronScreenCapture } from '@proj-airi/electron-screen-capture/renderer'
import { ScreenChangeGate } from '@proj-airi/stage-ui/domains/perception'
import { createScreenPerceptualHash } from '@proj-airi/stage-ui/services/perception'

const TARGET_WIDTH = 1280
const TARGET_HEIGHT = 720
const MAX_JPEG_BYTES = 1024 * 1024
const SOURCES_OPTIONS: SourcesOptions = {
  types: ['screen', 'window'],
  fetchWindowIcons: false,
  thumbnailSize: { width: 0, height: 0 },
}
const SENSITIVE_SOURCE_PATTERN = /password|passcode|credential|authenticator|one[- ]?time|2fa|bank|payment|checkout|wallet|private|incognito|secret|密码|验证码|支付|银行|隐私|无痕|密钥/iu

export interface ProductionScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
}

export interface ProductionScreenCaptureBridge {
  getSources: (options: SourcesOptions) => Promise<SerializableDesktopCapturerSource[]>
  selectWithSource: <T>(
    select: (sources: SerializableDesktopCapturerSource[]) => string | Promise<string>,
    use: () => T | Promise<T>,
    options: SourceOptionsWithRequest,
  ) => Promise<T>
}

export interface ProductionScreenFrameRequest {
  frameId: string
  observationId: string
  sessionId: string
  sourceId: string
  generation: number
  sensitiveSurface?: boolean
}

export type ProductionScreenFrameResult
  = | {
    accepted: true
    decision: ReturnType<ScreenChangeGate['evaluate']>
    frame: {
      frameId: string
      observationId: string
      sessionId: string
      sourceId: string
      generation: number
      capturedAt: number
      byteLength: number
      jpegBytes: Uint8Array
      release: (reason: import('@proj-airi/stage-ui/services/perception').ScreenFrameReleaseReason) => void
    }
  }
  | {
    accepted: false
    decision: ReturnType<ScreenChangeGate['evaluate']>
  }

export interface ProductionScreenCaptureOptions {
  bridge?: ProductionScreenCaptureBridge
  mediaDevices?: Pick<MediaDevices, 'getDisplayMedia'>
  document?: Pick<Document, 'createElement'>
  now?: () => number
  monotonicNow?: () => number
  maxJpegBytes?: number
  unchangedRefreshIntervalMs?: number
}

interface ActiveCapture {
  source: SerializableDesktopCapturerSource
  stream: MediaStream
  video: HTMLVideoElement
  stopped: boolean
  endedListeners: Set<() => void>
  cleanupTrackListeners: Array<() => void>
}

/**
 * Main-renderer production capture owner. Raw pixels and JPEGs stay inside this
 * object until a single frame is offered to the analyzer and are never logged.
 */
export class ProductionScreenCapture {
  readonly #bridge: ProductionScreenCaptureBridge
  readonly #mediaDevices: Pick<MediaDevices, 'getDisplayMedia'>
  readonly #document: Pick<Document, 'createElement'>
  readonly #now: () => number
  readonly #monotonicNow: () => number
  readonly #gate: ScreenChangeGate
  readonly #maxJpegBytes: number
  #active?: ActiveCapture

  constructor(options: ProductionScreenCaptureOptions = {}) {
    this.#bridge = options.bridge ?? createElectronBridge()
    this.#mediaDevices = options.mediaDevices ?? navigator.mediaDevices
    this.#document = options.document ?? document
    this.#now = options.now ?? Date.now
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#maxJpegBytes = options.maxJpegBytes ?? MAX_JPEG_BYTES
    if (!Number.isInteger(this.#maxJpegBytes) || this.#maxJpegBytes < 16 * 1024 || this.#maxJpegBytes > MAX_JPEG_BYTES)
      throw new Error('screen_capture_jpeg_limit_invalid')
    this.#gate = new ScreenChangeGate({
      unchangedRefreshIntervalMs: Object.hasOwn(options, 'unchangedRefreshIntervalMs')
        ? options.unchangedRefreshIntervalMs
        : 5_000,
    })
  }

  async listSources(): Promise<ProductionScreenSource[]> {
    const sources = await this.#bridge.getSources(SOURCES_OPTIONS)
    return sources
      .filter(source => !source.ownedByCurrentApp)
      .map<ProductionScreenSource>(source => ({
        id: source.id,
        name: source.name,
        kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      }))
      .sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'screen' ? -1 : 1)
  }

  async open(sourceId: string, signal: AbortSignal): Promise<ProductionScreenCaptureHandle> {
    if (!sourceId || signal.aborted || this.#active)
      throw new Error(signal.aborted ? 'screen_capture_start_cancelled' : 'screen_capture_busy')

    const sources = await this.#bridge.getSources(SOURCES_OPTIONS)
    const source = sources.find(candidate => candidate.id === sourceId)
    if (!source || source.ownedByCurrentApp)
      throw new Error(source?.ownedByCurrentApp ? 'screen_capture_self_forbidden' : 'screen_capture_source_missing')

    const stream = await this.#bridge.selectWithSource(
      () => sourceId,
      () => this.#mediaDevices.getDisplayMedia({ video: true, audio: false }),
      { sourcesOptions: SOURCES_OPTIONS, request: { timeout: 15_000 } },
    )
    if (signal.aborted || !hasLiveVideoTrack(stream)) {
      stopMediaStream(stream)
      throw new Error(signal.aborted ? 'screen_capture_start_cancelled' : 'screen_capture_track_missing')
    }

    const video = this.#document.createElement('video') as HTMLVideoElement
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    try {
      await waitForVideo(video, signal)
    }
    catch (error) {
      video.srcObject = null
      stopMediaStream(stream)
      throw error
    }

    const active: ActiveCapture = {
      source,
      stream,
      video,
      stopped: false,
      endedListeners: new Set(),
      cleanupTrackListeners: [],
    }
    this.#active = active
    this.#gate.stop()

    for (const track of stream.getTracks()) {
      const onEnded = () => this.#handleEnded(active)
      track.addEventListener('ended', onEnded, { once: true })
      active.cleanupTrackListeners.push(() => track.removeEventListener('ended', onEnded))
    }
    signal.addEventListener('abort', () => this.#stop(active), { once: true })

    return {
      sourceId,
      stop: () => this.#stop(active),
      onEnded: (listener) => {
        active.endedListeners.add(listener)
        return () => active.endedListeners.delete(listener)
      },
    }
  }

  resetGate(sourceId: string, generation: number): void {
    if (this.#active?.source.id !== sourceId)
      throw new Error('screen_capture_source_mismatch')
    this.#gate.reset(sourceId, generation)
  }

  async captureFrame(request: ProductionScreenFrameRequest): Promise<ProductionScreenFrameResult> {
    const active = this.#active
    if (!active || active.stopped || active.source.id !== request.sourceId || !hasLiveVideoTrack(active.stream))
      throw new Error('screen_capture_not_running')

    const canvas = this.#document.createElement('canvas') as HTMLCanvasElement
    canvas.width = TARGET_WIDTH
    canvas.height = TARGET_HEIGHT
    const context = canvas.getContext('2d', { alpha: false })
    if (!context)
      throw new Error('screen_capture_canvas_unavailable')
    drawContainedFrame(context, active.video)

    const hashCanvas = this.#document.createElement('canvas') as HTMLCanvasElement
    hashCanvas.width = 8
    hashCanvas.height = 8
    const hashContext = hashCanvas.getContext('2d', { alpha: false, willReadFrequently: true })
    if (!hashContext)
      throw new Error('screen_capture_canvas_unavailable')
    hashContext.drawImage(canvas, 0, 0, 8, 8)
    const hashPixels = hashContext.getImageData(0, 0, 8, 8).data
    const capturedAt = this.#now()
    const decision = this.#gate.evaluate({
      sourceId: request.sourceId,
      generation: request.generation,
      capturedAt,
      monotonicTimestamp: this.#monotonicNow(),
      perceptualHash: createScreenPerceptualHash(hashPixels, 8, 8),
      surfaceState: active.video.readyState >= 2 ? 'visible' : 'minimized',
      ownedByCurrentApp: active.source.ownedByCurrentApp,
      sensitiveSurface: request.sensitiveSurface === true || isSensitiveScreenSourceName(active.source.name),
    })
    if (!decision.accepted)
      return { accepted: false, decision }

    const jpegBytes = await encodeBoundedJpeg(canvas, this.#maxJpegBytes)
    let released = false
    return {
      accepted: true,
      decision,
      frame: {
        frameId: request.frameId,
        observationId: request.observationId,
        sessionId: request.sessionId,
        sourceId: request.sourceId,
        generation: request.generation,
        capturedAt,
        byteLength: jpegBytes.byteLength,
        jpegBytes,
        release: () => {
          if (released)
            return
          released = true
          jpegBytes.fill(0)
        },
      },
    }
  }

  stop(): void {
    if (this.#active)
      this.#stop(this.#active)
  }

  #handleEnded(active: ActiveCapture): void {
    if (this.#active !== active || active.stopped)
      return
    const listeners = [...active.endedListeners]
    this.#stop(active)
    listeners.forEach(listener => listener())
  }

  #stop(active: ActiveCapture): void {
    if (active.stopped)
      return
    active.stopped = true
    active.cleanupTrackListeners.forEach(cleanup => cleanup())
    active.cleanupTrackListeners.length = 0
    active.endedListeners.clear()
    active.video.pause()
    active.video.srcObject = null
    stopMediaStream(active.stream)
    this.#gate.stop()
    if (this.#active === active)
      this.#active = undefined
  }
}

export function isSensitiveScreenSourceName(name: string): boolean {
  return SENSITIVE_SOURCE_PATTERN.test(name)
}

function createElectronBridge(): ProductionScreenCaptureBridge {
  const { context } = createContext(window.electron.ipcRenderer)
  return setupElectronScreenCapture(context)
}

function hasLiveVideoTrack(stream: MediaStream): boolean {
  return stream.getVideoTracks().some(track => track.readyState === 'live')
}

function stopMediaStream(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop())
}

async function waitForVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    throw new Error('screen_capture_start_cancelled')
  await video.play()
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0)
    return

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error('screen_capture_video_timeout'))), 5_000)
    const onReady = () => finish(resolve)
    const onError = () => finish(() => reject(new Error('screen_capture_video_failed')))
    const onAbort = () => finish(() => reject(new Error('screen_capture_start_cancelled')))
    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })

    function finish(done: () => void) {
      clearTimeout(timeout)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      done()
    }
  })
}

function drawContainedFrame(context: CanvasRenderingContext2D, video: HTMLVideoElement): void {
  if (video.videoWidth < 1 || video.videoHeight < 1)
    throw new Error('screen_capture_video_failed')
  context.fillStyle = '#000'
  context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)
  const scale = Math.min(TARGET_WIDTH / video.videoWidth, TARGET_HEIGHT / video.videoHeight)
  const width = Math.round(video.videoWidth * scale)
  const height = Math.round(video.videoHeight * scale)
  const x = Math.floor((TARGET_WIDTH - width) / 2)
  const y = Math.floor((TARGET_HEIGHT - height) / 2)
  context.drawImage(video, x, y, width, height)
}

async function encodeBoundedJpeg(canvas: HTMLCanvasElement, maxJpegBytes: number): Promise<Uint8Array> {
  for (const quality of [0.82, 0.72, 0.6]) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('screen_capture_encode_failed')), 'image/jpeg', quality)
    })
    if (blob.size <= maxJpegBytes)
      return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error('screen_capture_frame_too_large')
}
